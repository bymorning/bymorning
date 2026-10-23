/**
 * Recording stand-in for `@azure/keyvault-keys`, aliased in `vitest.config.ts`
 * so startup tests can build the host's Key Vault cipher backend without Azure
 * credentials or network. Each constructed client remembers its key URL or
 * vault URL, letting tests assert the key the host passed through. Only the
 * surface imported by `@bymorning/backend-azure/keyvault` is implemented.
 */

/** The version an unversioned key URL resolves to in startup tests. */
export const resolvedVersion = "0123456789abcdef0123456789abcdef"

export class CryptographyClient {
  static readonly clients: CryptographyClient[] = []

  constructor(
    readonly key: unknown,
    readonly credential: unknown,
  ) {
    CryptographyClient.clients.push(this)
  }

  static reset(): void {
    CryptographyClient.clients.length = 0
  }
}

export class KeyClient {
  static readonly clients: KeyClient[] = []

  constructor(
    readonly vaultUrl: string,
    readonly credential: unknown,
  ) {
    KeyClient.clients.push(this)
  }

  static reset(): void {
    KeyClient.clients.length = 0
  }

  getKey(name: string): Promise<{ readonly name: string; readonly id: string }> {
    return Promise.resolve({ name, id: `${this.vaultUrl}/keys/${name}/${resolvedVersion}` })
  }
}

/** Mirrors the SDK parser: vault URL, key name, and optional version segments. */
export function parseKeyVaultKeyIdentifier(id: string): {
  readonly sourceId: string
  readonly vaultUrl: string
  readonly name: string
  readonly version?: string
} {
  const url = new URL(id)
  const segments = url.pathname.split("/").filter((segment) => segment !== "")
  if (segments.length < 2 || segments.length > 3 || segments[0] !== "keys" || segments[1] === "") {
    throw new Error(`Invalid Key Vault key identifier: ${id}`)
  }
  return {
    sourceId: id,
    vaultUrl: url.origin,
    name: segments[1]!,
    ...(segments[2] === undefined ? {} : { version: segments[2] }),
  }
}
