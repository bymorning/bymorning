/**
 * Recording stand-in for `@aws-sdk/client-s3`, aliased in `vitest.config.ts`
 * so startup tests can build the host's S3 storage provider without AWS
 * credentials or network. Each constructed client remembers its configuration
 * and every command it was asked to send, letting tests assert the bucket and
 * region the host passed through. Only the surface imported by the storage
 * provider and `@aws-sdk/lib-storage` is implemented.
 */

type Input = Record<string, unknown>

export interface Sent {
  readonly name: string
  readonly input: Input
}

export class S3Client {
  static readonly clients: S3Client[] = []

  readonly sent: Sent[] = []

  constructor(readonly config: Input = {}) {
    S3Client.clients.push(this)
  }

  static reset(): void {
    S3Client.clients.length = 0
  }

  send(command: { readonly constructor: { readonly name: string }; readonly input?: Input }): Promise<Input> {
    this.sent.push({ name: command.constructor.name, input: command.input ?? {} })
    return Promise.resolve({})
  }

  destroy(): void {}
}

class Command {
  constructor(readonly input: Input = {}) {}
}

export class HeadBucketCommand extends Command {}
export class HeadObjectCommand extends Command {}
export class GetObjectCommand extends Command {}
export class DeleteObjectCommand extends Command {}
export class ListObjectsV2Command extends Command {}
export class PutObjectCommand extends Command {}
export class PutObjectTaggingCommand extends Command {}
export class CreateMultipartUploadCommand extends Command {}
export class UploadPartCommand extends Command {}
export class CompleteMultipartUploadCommand extends Command {}
export class AbortMultipartUploadCommand extends Command {}

/** Imported by `@aws-sdk/lib-storage`; never read on the startup path. */
export const ChecksumAlgorithm = {}
