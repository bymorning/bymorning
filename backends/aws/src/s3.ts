import {
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { NodeStream } from "@effect/platform-node"
import { Effect, Option, Schema, Stream } from "effect"
import { Storage } from "@bymorning/core/storage"
import { OperationError } from "@bymorning/schema/storage"
import type { Path, RangeInput, Item, SetInput } from "@bymorning/core/storage"
class S3GetError extends Schema.TaggedError<S3GetError>()("Storage.S3GetError", { cause: Schema.Defect() }) {}
/** S3 adapter construction using either a caller-owned client or an owned client configuration. */
type S3Options =
  | {
      readonly bucket: string
      readonly client: S3Client
      readonly config?: never
    }
  | {
      readonly bucket: string
      readonly client?: never
      readonly config?: S3ClientConfig
    }

/** S3 provider; internally created clients are destroyed with the acquisition scope. */
export const s3 = (options: S3Options): Storage.Provider => ({
  id: Storage.ID.make("s3"),
  name: "S3",
  open: Effect.gen(function* () {
    const bucket = options.bucket
    const client =
      options.client === undefined
        ? yield* Effect.acquireRelease(
            Effect.try({
              try: () => new S3Client(options.config ?? {}),
              catch: (cause) => operationError("init", cause),
            }),
            (client) => Effect.sync(() => client.destroy()),
          )
        : options.client

    const init = Effect.tryPromise({
      try: (signal) => client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal }),
      catch: (cause) => operationError("init", cause),
    }).pipe(Effect.asVoid, Effect.withSpan("Storage.S3.init"))

    const set = Effect.fn("Storage.S3.set")(function* (path: Path, input: SetInput) {
      const serialized = yield* serializePath(path)
      // Own the producer as well as the upload: Upload.abort alone leaves a blocked
      // ReadableStream reader (and its Effect fiber) running after interruption.
      const body = serialized.marker
        ? new Uint8Array()
        : yield* Effect.acquireRelease(NodeStream.toReadable(input.body), (body) =>
            Effect.promise(
              () =>
                new Promise<void>((resolve) => {
                  if (body.closed) return resolve()
                  body.once("close", resolve)
                  body.destroy()
                }),
            ),
          )
      const upload = yield* Effect.try({
        try: () =>
          new Upload({
            client,
            params: {
              Bucket: bucket,
              Key: serialized.key,
              Body: body,
              ContentType: input.contentType,
              ContentLength: serialized.marker ? 0 : input.contentLength,
            },
          }),
        catch: (cause) => operationError("set", cause),
      })
      yield* Effect.tryPromise({
        try: () => upload.done(),
        catch: (cause) => operationError("set", cause),
      }).pipe(Effect.onInterrupt(() => Effect.promise(() => upload.abort())))
    }, Effect.scoped)

    const get = Effect.fn("Storage.S3.get")(function* (path: Path) {
      const serialized = yield* serializePath(path)
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          client.send(new GetObjectCommand({ Bucket: bucket, Key: serialized.key }), {
            abortSignal: signal,
          }),
        catch: (cause) => new S3GetError({ cause }),
      }).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          isMissing(error.cause) ? Effect.succeed(Option.none()) : Effect.fail(operationError("get", error.cause)),
        ),
      )
      if (Option.isNone(response)) return Option.none()
      const body = response.value.Body
      if (body === undefined) {
        return yield* operationError("get", new Error("S3 returned an object without a body"))
      }
      return Option.some({
        metadata: {
          contentType: response.value.ContentType,
          contentLength: response.value.ContentLength,
          etag: response.value.ETag,
        },
        body: Stream.fromReadableStream({
          evaluate: () => body.transformToWebStream(),
          onError: (cause) => operationError("get", cause),
        }),
      })
    })

    const getRange = Effect.fn("Storage.S3.getRange")(function* (path: Path, input: RangeInput) {
      const serialized = yield* serializePath(path)
      if (!isRangeInput(input)) return yield* operationError("get", new Error("Invalid byte range"))
      const head = yield* Effect.tryPromise({
        try: (signal) =>
          client.send(new HeadObjectCommand({ Bucket: bucket, Key: serialized.key }), {
            abortSignal: signal,
          }),
        catch: (cause) => new S3GetError({ cause }),
      }).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          isMissing(error.cause) ? Effect.succeed(Option.none()) : Effect.fail(operationError("get", error.cause)),
        ),
      )
      if (Option.isNone(head)) return Option.none()
      const metadata = {
        contentType: head.value.ContentType,
        contentLength: head.value.ContentLength,
        etag: head.value.ETag,
      }
      if (input.length === 0 || input.offset >= (metadata.contentLength ?? 0)) {
        return Option.some({ metadata, body: Stream.empty })
      }
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          client.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: serialized.key,
              Range: `bytes=${input.offset}-${Math.min(metadata.contentLength ?? Number.MAX_SAFE_INTEGER, input.offset + input.length) - 1}`,
            }),
            { abortSignal: signal },
          ),
        catch: (cause) => operationError("get", cause),
      })
      if (response.Body === undefined) {
        return yield* operationError("get", new Error("S3 returned an object without a body"))
      }
      const body = response.Body
      return Option.some({
        metadata,
        body: Stream.fromReadableStream({
          evaluate: () => body.transformToWebStream(),
          onError: (cause) => operationError("get", cause),
        }),
      })
    })

    const remove = Effect.fn("Storage.S3.remove")(function* (path: Path) {
      const serialized = yield* serializePath(path)
      yield* Effect.tryPromise({
        try: (signal) =>
          client.send(new DeleteObjectCommand({ Bucket: bucket, Key: serialized.key }), {
            abortSignal: signal,
          }),
        catch: (cause) => operationError("remove", cause),
      })
    })

    const list = Effect.fn("Storage.S3.list")(function* (prefix: Path) {
      const serialized = yield* serializePath(prefix)
      return [...(yield* listObjects(client, bucket, serialized.key))].sort(compareItems)
    })

    return { init, set, get, getRange, remove, list } satisfies Storage.Driver
  }),
})

const listObjects = (
  client: S3Client,
  bucket: string,
  prefix: string,
  continuationToken?: string,
): Effect.Effect<ReadonlyArray<Item>, Storage.OperationError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
          { abortSignal: signal },
        ),
      catch: (cause) => operationError("list", cause),
    })
    const items = (response.Contents ?? []).flatMap((object) =>
      object.Key === undefined
        ? []
        : [
            {
              key: object.Key,
              metadata: { contentLength: object.Size, etag: object.ETag },
              marker: object.Key.endsWith("/"),
            },
          ],
    )
    if (!response.IsTruncated) return items
    if (response.NextContinuationToken === undefined) {
      return yield* operationError("list", new Error("S3 truncated a listing without a continuation token"))
    }
    return [...items, ...(yield* listObjects(client, bucket, prefix, response.NextContinuationToken))]
  })

const compareItems = (left: Item, right: Item) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)

const serializePath = (path: Path) => Storage.key(path).pipe(Effect.map((key) => ({ key, marker: key.endsWith("/") })))
const isRangeInput = (input: RangeInput) =>
  Number.isSafeInteger(input.offset) && input.offset >= 0 && Number.isSafeInteger(input.length) && input.length >= 0

const operationError = (operation: Storage.OperationError["operation"], cause: unknown) =>
  new OperationError({ message: `S3 storage ${operation} failed`, providerID: Storage.ID.make("s3"), operation, cause })

// Requests never carry a VersionId, so NoSuchVersion can only mean the key is
// absent; S3-compatible stores (RustFS) answer it for missing `/`-suffixed keys.
const isMissing = (cause: unknown) => {
  if (typeof cause !== "object" || cause === null) return false
  return "name" in cause && (cause.name === "NoSuchKey" || cause.name === "NoSuchVersion" || cause.name === "NotFound")
}
