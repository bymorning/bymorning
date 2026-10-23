import { createHash, createSign, generateKeyPairSync, randomBytes, type JsonWebKey, type KeyObject } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

export interface IdentityToken {
  readonly sub: string
  readonly email?: string
  readonly extra?: Record<string, unknown>
}

export interface Options {
  /** Absolute issuer, or a path resolved against the fixture's loopback origin. */
  readonly issuer?: string
  readonly tokenAuthMethods?: ReadonlyArray<"client_secret_basic" | "client_secret_post" | "private_key_jwt">
  readonly advertiseTokenAuthMethods?: boolean
  readonly advertisePKCE?: boolean
  readonly advertiseIssParameter?: boolean
}

export interface AuthorizeRequest {
  readonly params: URLSearchParams
}

export interface TokenRequest {
  readonly auth: "basic" | "post" | "none"
}

export interface Issued {
  readonly code: string
  readonly redirect: URL
}

export interface Fixture {
  readonly issuer: URL
  readonly clientID: string
  readonly clientSecret: string
  readonly authorize: (url: URL, identity: IdentityToken) => Promise<Issued>
  readonly authorizeRequests: ReadonlyArray<AuthorizeRequest>
  readonly tokenRequests: ReadonlyArray<TokenRequest>
  readonly rotateKeys: () => Promise<void>
  readonly signNextWithUnknownKey: () => void
  readonly tamperNext: (claims: Record<string, unknown>) => void
  readonly userinfoNext: (mode: "fail" | "sub-mismatch") => void
  /** Make the next discovery response invalid. */
  readonly discoveryNext: (mode: "fail" | "issuer-mismatch" | "wrong-authorization-origin") => void
  readonly close: () => Promise<void>
}

type SigningKey = { readonly privateKey: KeyObject; readonly jwk: JsonWebKey }
type Code = {
  readonly redirectURI: string
  readonly challenge: string
  readonly nonce: string
  readonly identity: IdentityToken
}

const random = () => randomBytes(32).toString("base64url")
const digest = (value: string) => createHash("sha256").update(value).digest("base64url")

const key = (): SigningKey => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const publicJwk = pair.publicKey.export({ format: "jwk" })
  return { privateKey: pair.privateKey, jwk: { ...publicJwk, kid: random(), use: "sig", alg: "RS256" } }
}

const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value))
}

const body = async (request: IncomingMessage) => {
  let value = ""
  for await (const chunk of request) value += chunk
  return new URLSearchParams(value)
}

export const start = async (options: Options = {}): Promise<Fixture> => {
  const clientID = random()
  const clientSecret = random()
  const methods = options.tokenAuthMethods ?? ["client_secret_basic", "client_secret_post"]
  const codes = new Map<string, Code>()
  const accessTokens = new Map<string, IdentityToken>()
  const requests: AuthorizeRequest[] = []
  const tokenRequests: TokenRequest[] = []
  let signingKey = key()
  let tampered: Record<string, unknown> | undefined
  let unknownKey = false
  let nextUserinfo: "fail" | "sub-mismatch" | undefined
  let nextDiscovery: "fail" | "issuer-mismatch" | "wrong-authorization-origin" | undefined
  let issuer: URL
  let origin: URL
  const endpoint = (name: string) => new URL(
    issuer.pathname.endsWith("/v2.0")
      ? `${issuer.pathname.slice(0, -5)}/oauth2/v2.0/${name}`
      : `/${name}`,
    origin,
  )

  const idToken = (code: Code) => {
    const current = unknownKey ? key() : signingKey
    unknownKey = false
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: issuer.href,
      sub: code.identity.sub,
      aud: clientID,
      exp: now + 300,
      iat: now,
      nonce: code.nonce,
      ...(code.identity.email === undefined ? {} : { email: code.identity.email }),
      ...code.identity.extra,
      ...tampered,
    }
    tampered = undefined
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: current.jwk.kid })).toString("base64url")
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
    const signature = createSign("RSA-SHA256")
      .update(`${header}.${payload}`)
      .end()
      .sign(current.privateKey)
      .toString("base64url")
    return `${header}.${payload}.${signature}`
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", origin)
      if (request.method === "GET" && url.pathname === `${issuer.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`) {
        const discovery = nextDiscovery
        nextDiscovery = undefined
        if (discovery === "fail") {
          response.writeHead(500).end()
          return
        }
        json(response, 200, {
          issuer: discovery === "issuer-mismatch" ? "https://wrong.example/" : issuer.href,
          authorization_endpoint:
            discovery === "wrong-authorization-origin"
              ? "https://wrong.example/authorize"
              : endpoint("authorize").href,
          token_endpoint: endpoint("token").href,
          jwks_uri: endpoint("jwks").href,
          userinfo_endpoint: endpoint("userinfo").href,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          ...(options.advertiseTokenAuthMethods === false ? {} : { token_endpoint_auth_methods_supported: methods }),
          ...(options.advertisePKCE === false ? {} : { code_challenge_methods_supported: ["S256"] }),
          ...(options.advertiseIssParameter ? { authorization_response_iss_parameter_supported: true } : {}),
          scopes_supported: ["openid", "email", "profile"],
        })
        return
      }
      if (request.method === "GET" && url.pathname === endpoint("jwks").pathname) {
        json(response, 200, { keys: [signingKey.jwk] })
        return
      }
      if (request.method === "GET" && url.pathname === endpoint("authorize").pathname) {
        requests.push({ params: new URLSearchParams(url.search) })
        response.writeHead(200).end("Complete authorization with fixture.authorize()")
        return
      }
      if (request.method === "POST" && url.pathname === endpoint("token").pathname) {
        if (request.headers["content-type"]?.split(";", 1)[0] !== "application/x-www-form-urlencoded") {
          json(response, 400, { error: "invalid_request" })
          return
        }
        const form = await body(request)
        const basic = request.headers.authorization?.match(/^Basic (.+)$/)
        tokenRequests.push({ auth: basic ? "basic" : form.has("client_secret") ? "post" : "none" })
        let validClient = false
        if (basic) {
          const [id, secret, ...rest] = Buffer.from(basic[1]!, "base64").toString().split(":")
          const decode = (value: string | undefined) =>
            value === undefined ? undefined : new URLSearchParams(`value=${value}`).get("value")
          validClient =
            methods.includes("client_secret_basic") &&
            rest.length === 0 &&
            decode(id) === clientID &&
            decode(secret) === clientSecret
        } else {
          validClient =
            methods.includes("client_secret_post") &&
            form.get("client_id") === clientID &&
            form.get("client_secret") === clientSecret
        }
        if (!validClient) {
          json(response, 401, { error: "invalid_client" })
          return
        }
        const codeValue = form.get("code")
        const code = codeValue === null ? undefined : codes.get(codeValue)
        if (form.get("grant_type") !== "authorization_code" || !codeValue || !code) {
          json(response, 400, { error: "invalid_grant" })
          return
        }
        codes.delete(codeValue)
        if (
          form.get("redirect_uri") !== code.redirectURI ||
          digest(form.get("code_verifier") ?? "") !== code.challenge
        ) {
          json(response, 400, { error: "invalid_grant" })
          return
        }
        const accessToken = random()
        accessTokens.set(accessToken, code.identity)
        json(response, 200, {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken(code),
        })
        return
      }
      if (request.method === "GET" && url.pathname === endpoint("userinfo").pathname) {
        const identity = accessTokens.get(request.headers.authorization?.replace(/^Bearer /, "") ?? "")
        if (!identity) {
          json(response, 401, { error: "invalid_token" })
          return
        }
        const mode = nextUserinfo
        nextUserinfo = undefined
        if (mode === "fail") {
          response.writeHead(500).end()
          return
        }
        json(response, 200, {
          sub: mode === "sub-mismatch" ? `${identity.sub}-mismatch` : identity.sub,
          ...(identity.email === undefined ? {} : { email: identity.email }),
        })
        return
      }
      response.writeHead(404).end()
    })().catch(() => response.writeHead(500).end())
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("OIDC fixture did not bind a TCP port")
  origin = new URL(`http://127.0.0.1:${address.port}`)
  issuer = new URL(options.issuer ?? origin.href, origin)

  return {
    issuer,
    clientID,
    clientSecret,
    authorize: async (url, identity) => {
      const params = new URLSearchParams(url.search)
      if (
        params.get("client_id") !== clientID ||
        !params.get("redirect_uri") ||
        params.get("response_type") !== "code" ||
        !params.get("code_challenge") ||
        params.get("code_challenge_method") !== "S256"
      ) {
        throw new Error("Invalid authorization request")
      }
      const redirectURI = params.get("redirect_uri")!
      if (!URL.canParse(redirectURI)) {
        throw new Error("Invalid redirect URI")
      }
      requests.push({ params })
      const code = random()
      codes.set(code, {
        redirectURI,
        challenge: params.get("code_challenge")!,
        nonce: params.get("nonce") ?? "",
        identity,
      })
      const redirect = new URL(redirectURI)
      redirect.searchParams.append("code", code)
      const state = params.get("state")
      if (state !== null) redirect.searchParams.append("state", state)
      if (options.advertiseIssParameter) redirect.searchParams.append("iss", issuer.href)
      return { code, redirect }
    },
    authorizeRequests: requests,
    tokenRequests,
    rotateKeys: async () => {
      signingKey = key()
    },
    signNextWithUnknownKey: () => {
      unknownKey = true
    },
    tamperNext: (claims) => {
      tampered = claims
    },
    userinfoNext: (mode) => {
      nextUserinfo = mode
    },
    discoveryNext: (mode) => {
      nextDiscovery = mode
    },
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}
