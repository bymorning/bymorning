/**
 * Azure Blob Storage provider meeting the Storage contract byte-for-byte with
 * the S3 provider: `Storage.key` object keys, zero-byte `/` marker blobs,
 * whole-object metadata with clamped range reads (Blob `getProperties` plus a
 * ranged `download`), streaming block-blob upload, stable sorted recursive
 * prefix listing with continuation, idempotent remove, and a container `init`
 * probe. An upload stages blocks and commits the block list only after the
 * source stream completes, so a failed or interrupted source never replaces an
 * existing blob; staged-but-uncommitted blocks left by an interrupted upload
 * are reclaimed by the service's uncommitted-block expiry.
 *
 * Internally constructed clients use DefaultAzureCredential (managed identity,
 * workload identity) unless a credential or connection string is supplied.
 * Azure SDK clients hold no persistent resources, so there is nothing to
 * release for either client ownership mode.
 */
import { ContainerClient } from "@azure/storage-blob"
import type { AnonymousCredential, ContainerListBlobFlatSegmentResponse, StorageSharedKeyCredential } from "@azure/storage-blob"
import { DefaultAzureCredential, type TokenCredential } from "@azure/identity"
import { NodeStream } from "@effect/platform-node"
import { Duration, Effect, Option, Schema, Stream } from "effect"
import { Storage } from "@bymorning/core/storage"
import { OperationError } from "@bymorning/schema/storage"
import type { Item, Path, RangeInput, SetInput } from "@bymorning/core/storage"

class BlobGetError extends Schema.TaggedError<BlobGetError>()("Storage.BlobGetError", { cause: Schema.Defect() }) {}

/** Owned client construction: an account URL with a credential, or a connection string. */
type BlobConfig =
  | {
      /** Blob service account URL, for example `https://<account>.blob.core.windows.net`. */
      readonly url: string
      /** Credential matching the ContainerClient constructor; defaults to DefaultAzureCredential. */
      readonly credential?: TokenCredential | StorageSharedKeyCredential | AnonymousCredential
      readonly connectionString?: never
    }
  | {
      readonly url?: never
      readonly credential?: never
      /** Storage account connection string (Azurite and connection-string deployments). */
      readonly connectionString: string
    }

/** Blob adapter construction using either a caller-owned client or an owned client configuration. */
type BlobOptions =
  | {
      readonly container: string
      readonly client: ContainerClient
      readonly config?: never
    }
  | {
      readonly container: string
      readonly client?: never
      readonly config: BlobConfig
    }

/** One listing page, mirroring the S3 page size. */
const pageSize = 1000

/** Bound on the container probe at startup, token exchange included. */
const initTimeout = Duration.seconds(60)

/** Azure Blob Storage provider on one container. */
export const blob = (options: BlobOptions): Storage.Provider => ({
  id: Storage.ID.make("azure-blob"),
  name: "Azure Blob",
  open: Effect.gen(function* () {
    const container = options.container
    const client =
      options.client ??
      (yield* Effect.try({
        try: () =>
          options.config.connectionString !== undefined
            ? new ContainerClient(options.config.connectionString, container)
            : new ContainerClient(
                `${options.config.url.replace(/\/+$/, "")}/${container}`,
                options.config.credential ?? new DefaultAzureCredential(),
              ),
        catch: (cause) => operationError("init", cause),
      }))

    // The startup probe is bounded: the SDK sets no request deadline, and an
    // account or token endpoint that never answers would hold startup forever.
    const init = Effect.tryPromise({
      try: (signal) => client.getProperties({ abortSignal: signal }),
      catch: (cause) => operationError("init", cause),
    }).pipe(
      Effect.timeoutOrElse({
        duration: initTimeout,
        orElse: () => Effect.fail(operationError("init", new Error("Azure Blob Storage did not answer within 60 seconds"))),
      }),
      Effect.asVoid,
      Effect.withSpan("Storage.AzureBlob.init"),
    )

    const set = Effect.fn("Storage.AzureBlob.set")(function* (path: Path, input: SetInput) {
      const serialized = yield* serializePath(path)
      const blob = client.getBlockBlobClient(serialized.key)
      const headers = {
        ...(input.contentType === undefined ? {} : { blobContentType: input.contentType }),
      }
      if (serialized.marker) {
        yield* Effect.tryPromise({
          try: (signal) => blob.upload(EMPTY, 0, { abortSignal: signal, blobHTTPHeaders: headers }),
          catch: (cause) => operationError("set", cause),
        })
        return
      }
      // Own the producer as well as the upload: a destroyed Readable stops the
      // SDK's stream consumption so the producer's finalizers run, while the
      // block list is never committed past an interrupted or failed source.
      const body = yield* Effect.acquireRelease(NodeStream.toReadable(input.body), (body) =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              if (body.closed) return resolve()
              body.once("close", resolve)
              body.destroy()
            }),
        ),
      )
      const controller = new AbortController()
      yield* Effect.tryPromise({
        try: () => blob.uploadStream(body, undefined, undefined, { abortSignal: controller.signal, blobHTTPHeaders: headers }),
        catch: (cause) => operationError("set", cause),
      }).pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
    }, Effect.scoped)

    const get = Effect.fn("Storage.AzureBlob.get")(function* (path: Path) {
      const serialized = yield* serializePath(path)
      const response = yield* Effect.tryPromise({
        try: (signal) => client.getBlockBlobClient(serialized.key).download(0, undefined, { abortSignal: signal }),
        catch: (cause) => new BlobGetError({ cause }),
      }).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          isMissing(error.cause) ? Effect.succeed(Option.none()) : Effect.fail(operationError("get", error.cause)),
        ),
      )
      if (Option.isNone(response)) return Option.none()
      const body = response.value.readableStreamBody
      if (body === undefined) {
        return yield* operationError("get", new Error("Azure Blob Storage returned an object without a body"))
      }
      return Option.some({
        metadata: {
          contentType: response.value.contentType,
          contentLength: response.value.contentLength,
          etag: response.value.etag,
        },
        body: NodeStream.fromReadable({
          evaluate: () => body,
          onError: (cause) => operationError("get", cause),
        }),
      })
    })

    const getRange = Effect.fn("Storage.AzureBlob.getRange")(function* (path: Path, input: RangeInput) {
      const serialized = yield* serializePath(path)
      if (!isRangeInput(input)) return yield* operationError("get", new Error("Invalid byte range"))
      const blob = client.getBlockBlobClient(serialized.key)
      const head = yield* Effect.tryPromise({
        try: (signal) => blob.getProperties({ abortSignal: signal }),
        catch: (cause) => new BlobGetError({ cause }),
      }).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          // HEAD error responses carry no body, so the SDK cannot parse an error
          // code; every 404 is a missing object, matching the S3 HeadObject rule.
          isNotFound(error.cause) ? Effect.succeed(Option.none()) : Effect.fail(operationError("get", error.cause)),
        ),
      )
      if (Option.isNone(head)) return Option.none()
      const metadata = {
        contentType: head.value.contentType,
        contentLength: head.value.contentLength,
        etag: head.value.etag,
      }
      if (input.length === 0 || input.offset >= (metadata.contentLength ?? 0)) {
        return Option.some({ metadata, body: Stream.empty })
      }
      const count = Math.min(metadata.contentLength ?? Number.MAX_SAFE_INTEGER, input.offset + input.length) - input.offset
      const response = yield* Effect.tryPromise({
        try: (signal) => blob.download(input.offset, count, { abortSignal: signal }),
        catch: (cause) => operationError("get", cause),
      })
      if (response.readableStreamBody === undefined) {
        return yield* operationError("get", new Error("Azure Blob Storage returned an object without a body"))
      }
      const body = response.readableStreamBody
      return Option.some({
        metadata,
        body: NodeStream.fromReadable({
          evaluate: () => body,
          onError: (cause) => operationError("get", cause),
        }),
      })
    })

    const remove = Effect.fn("Storage.AzureBlob.remove")(function* (path: Path) {
      const serialized = yield* serializePath(path)
      yield* Effect.tryPromise({
        try: (signal) => client.getBlockBlobClient(serialized.key).deleteIfExists({ abortSignal: signal }),
        catch: (cause) => operationError("remove", cause),
      })
    })

    const list = Effect.fn("Storage.AzureBlob.list")(function* (prefix: Path) {
      const serialized = yield* serializePath(prefix)
      return [...(yield* listBlobs(client, serialized.key))].sort(compareItems)
    })

    return { init, set, get, getRange, remove, list } satisfies Storage.Driver
  }),
})

const listBlobs = (
  client: ContainerClient,
  prefix: string,
  continuationToken?: string,
): Effect.Effect<ReadonlyArray<Item>, Storage.OperationError> =>
  Effect.gen(function* () {
    const page = yield* Effect.tryPromise({
      try: (signal) =>
        client
          .listBlobsFlat({ prefix, abortSignal: signal })
          .byPage({ maxPageSize: pageSize, continuationToken })
          .next(),
      catch: (cause) => operationError("list", cause),
    })
    const response = page.value as ContainerListBlobFlatSegmentResponse | undefined
    if (page.done || response === undefined) return []
    const items = response.segment.blobItems.map((blob) => ({
      key: blob.name,
      metadata: { contentLength: blob.properties.contentLength, etag: blob.properties.etag },
      marker: blob.name.endsWith("/"),
    }))
    const next = response.continuationToken
    if (next === undefined || next === "") return items
    return [...items, ...(yield* listBlobs(client, prefix, next))]
  })

const EMPTY = new Uint8Array()

const compareItems = (left: Item, right: Item) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)

const serializePath = (path: Path) => Storage.key(path).pipe(Effect.map((key) => ({ key, marker: key.endsWith("/") })))
const isRangeInput = (input: RangeInput) =>
  Number.isSafeInteger(input.offset) && input.offset >= 0 && Number.isSafeInteger(input.length) && input.length >= 0

const operationError = (operation: Storage.OperationError["operation"], cause: unknown) =>
  new OperationError({
    message: `Azure Blob storage ${operation} failed`,
    providerID: Storage.ID.make("azure-blob"),
    operation,
    cause,
  })

/** A missing object reports BlobNotFound; a missing container is a destination failure. */
const isMissing = (cause: unknown) => {
  if (typeof cause !== "object" || cause === null) return false
  return "code" in cause && cause.code === "BlobNotFound"
}

/** Bodiless error responses (HEAD) are missing objects on any 404. */
const isNotFound = (cause: unknown) => {
  if (typeof cause !== "object" || cause === null) return false
  return "statusCode" in cause && cause.statusCode === 404
}
