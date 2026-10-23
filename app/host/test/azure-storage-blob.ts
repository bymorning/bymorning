/**
 * Recording stand-in for `@azure/storage-blob`, aliased in `vitest.config.ts`
 * so startup tests can build the host's Blob storage provider without Azure
 * credentials or network. Each constructed client remembers the container URL
 * and credential it was given, letting tests assert the account and container
 * the host passed through. Only the surface imported by
 * `@bymorning/backend-azure/blob` is implemented.
 */

type Input = Record<string, unknown>

export class ContainerClient {
  static readonly clients: ContainerClient[] = []

  readonly calls: Array<{ readonly name: string; readonly input?: Input }> = []

  constructor(
    readonly urlOrConnectionString: string,
    readonly credentialOrContainerName?: unknown,
    readonly options?: unknown,
  ) {
    ContainerClient.clients.push(this)
  }

  static reset(): void {
    ContainerClient.clients.length = 0
  }

  getProperties(): Promise<Input> {
    this.calls.push({ name: "getProperties" })
    return Promise.resolve({})
  }

  getBlockBlobClient(name: string): BlockBlobClient {
    return new BlockBlobClient(name)
  }
}

export class BlockBlobClient {
  constructor(readonly name: string) {}
}

/** Imported as types by `@bymorning/backend-azure/blob`; never read at runtime. */
export class StorageSharedKeyCredential {}
export class AnonymousCredential {}
export type ContainerListBlobFlatSegmentResponse = Input
