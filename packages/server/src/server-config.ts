import { AuthProvider } from "@bymorning/schema/auth-provider"
import { Config, Effect, Option, Schema } from "effect"

const origin = (protocols: ReadonlyArray<string>) =>
  Schema.URL.pipe(
    Schema.check(
      Schema.makeFilter(
        (url) =>
          protocols.includes(url.protocol) &&
          url.username === "" &&
          url.password === "" &&
          url.pathname === "/" &&
          url.search === "" &&
          url.hash === "",
        { expected: `an origin using ${protocols.join(" or ")}` },
      ),
    ),
  )

const displayName = {
  google: "Google Workspace",
  okta: "Okta",
  microsoft: "Microsoft Entra",
  auth0: "Auth0",
  ping: "Ping",
  custom: "Custom",
} as const satisfies Record<AuthProvider.Kind, string>

const auth = Config.all({
  issuer: Config.string("AUTH_ISSUER"),
  clientID: Config.string("AUTH_CLIENT_ID"),
  clientSecret: Config.string("AUTH_CLIENT_SECRET"),
  kind: Config.string("AUTH_PROVIDER"),
  domains: Config.string("AUTH_EMAIL_DOMAINS"),
}).pipe(
  Config.mapOrFail((input) =>
    Schema.decodeUnknownEffect(AuthProvider.Seed)({
      issuer: input.issuer,
      clientID: input.clientID,
      clientSecret: input.clientSecret,
      kind: input.kind,
      domains: input.domains.split(","),
      displayName: displayName[input.kind as keyof typeof displayName] ?? "Custom",
    }).pipe(Effect.mapError((cause) => new Config.ConfigError(cause))),
  ),
  Config.option,
)

/** Deployment origin and optional Auth Provider seed owned by the Server composition root. */
export const serverConfig = Config.all({
  appOrigin: Config.schema(origin(["http:", "https:"]), "APP_ORIGIN"),
  auth,
}).pipe(
  Config.map(({ appOrigin, auth }): {
    readonly appOrigin: URL
    readonly auth?: AuthProvider.Seed
  } => (Option.isSome(auth) ? { appOrigin, auth: auth.value } : { appOrigin })),
)
