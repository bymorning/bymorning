/**
 * Recording stand-in for `@aws-sdk/client-kms`, aliased in `vitest.config.ts`
 * so startup tests can build the host's KMS cipher backend without AWS
 * credentials or network. Each constructed client remembers its configuration
 * and every command it was asked to send, letting tests assert the key ARN and
 * region the host passed through. Only the surface imported by
 * `@bymorning/backend-aws/kms` is implemented.
 */

type Input = Record<string, unknown>

export interface Sent {
  readonly name: string
  readonly input: Input
}

export class KMSClient {
  static readonly clients: KMSClient[] = []

  readonly sent: Sent[] = []

  constructor(readonly config: Input = {}) {
    KMSClient.clients.push(this)
  }

  static reset(): void {
    KMSClient.clients.length = 0
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

export class GenerateDataKeyCommand extends Command {}
export class DecryptCommand extends Command {}

/** Imported as a type by `@bymorning/backend-aws/kms`; never read at runtime. */
export type KMSClientConfig = Input
