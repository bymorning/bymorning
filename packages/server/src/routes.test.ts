import { NodeCrypto, NodeHttpServer } from "@effect/platform-node"
import { Account } from "@bymorning/core/account"
import { Actor } from "@bymorning/core/actor"
import { Agent } from "@bymorning/core/agent"
import { Audit } from "@bymorning/core/audit"
import { Auth } from "@bymorning/core/auth"
import { AuthProvider } from "@bymorning/core/auth-provider"
import { Budget } from "@bymorning/core/budget"
import { Cipher } from "@bymorning/core/cipher"
import { Installation } from "@bymorning/core/installation"
import { AuthSchema } from "@bymorning/schema/auth"
import { AuthProviderSchema } from "@bymorning/schema/auth-provider"
import { Application } from "./application.js"
import { User } from "@bymorning/core/user"
import { Database } from "@bymorning/core/database"
import { Provider } from "@bymorning/core/provider"
import { Model } from "@bymorning/core/model"
import { Project } from "@bymorning/core/project"
import { Storage } from "@bymorning/core/storage"
import { Session } from "@bymorning/core/session"
import { Usage } from "@bymorning/core/usage"
import { Skill } from "@bymorning/core/skill"
import { Integration } from "@bymorning/core/integration"
import { IntegrationOAuthCallback } from "@bymorning/core/integration-oauth-callback"
import { PluginSupervisor } from "@bymorning/core/plugin/supervisor"
import { Catalog } from "@bymorning/core/catalog"
import { Bus } from "@bymorning/core/bus"
import { Form } from "@bymorning/core/form"
import { Config } from "@bymorning/core/config"
import { ToolGateway } from "@bymorning/gateway/tool-gateway"
import { LLMGateway } from "@bymorning/gateway/llm-gateway"
import { OAuth } from "@bymorning/core/oauth"
import { Mcp } from "@bymorning/core/mcp"
import { Tool } from "@bymorning/core/tool"
import { ToolUsage } from "@bymorning/core/tool-usage"
import { Policy } from "@bymorning/core/policy"
import { Plugin } from "@bymorning/core/plugin"
import { ManagedPolicy } from "@bymorning/core/managed-policy"
import { Info } from "@bymorning/schema/config"
import { AccountActor, UserActor } from "@bymorning/schema/actor"
import { AccountSchema } from "@bymorning/schema/account"
import { AgentSchema } from "@bymorning/schema/agent"
import { ModelSchema } from "@bymorning/schema/model"
import { ProjectSchema } from "@bymorning/schema/project"
import { PluginSchema } from "@bymorning/schema/plugin"
import { ManagedSource } from "@bymorning/schema/policy"
import type { Info as PolicyInfo } from "@bymorning/schema/policy"
import { ProviderSchema } from "@bymorning/schema/provider"
import { SessionSchema } from "@bymorning/schema/session"
import { SkillSchema } from "@bymorning/schema/skill"
import { UserSchema } from "@bymorning/schema/user"
import { Aggregate, ID, Leaderboard, Overview, Record } from "@bymorning/schema/usage"
import type { Days } from "@bymorning/schema/usage"
import { ToolUsageSchema } from "@bymorning/schema/tool-usage"
import { Workspace } from "@bymorning/schema/workspace"
import { Credential } from "@bymorning/core/credential"
import { makeGlobalNode, makeWorkspaceNode } from "@bymorning/util/effect/app-node"
import { LayerNode } from "@bymorning/util/effect/layer-node"
import { DateTime, Deferred, Effect, Layer, ManagedRuntime, Redacted, Schema, Stream } from "effect"
import { Headers, HttpRouter, HttpServer } from "effect/unstable/http"
import { createServer, request } from "node:http"
import { describe, expect, it } from "vitest"
import { WorkspaceMap } from "./workspace-map.js"
import { WebCookie } from "./web-cookie.js"
import { WebProvider } from "./web-provider.js"

const accountID = AccountSchema.ID.create()
const workspaceID = Workspace.ID.create()
const otherWorkspaceID = Workspace.ID.create()
const account = new AccountActor({ type: "account", properties: { accountID } })
const actor = new UserActor({
  type: "user",
  properties: { accountID, userID: UserSchema.ID.create(), workspaceID, role: "member" },
})
const formSessionID = SessionSchema.ID.make("00000000-0000-4000-8000-000000000811")
const otherFormSessionID = SessionSchema.ID.make("00000000-0000-4000-8000-000000000812")
const providerRef = Schema.decodeUnknownSync(AuthProviderSchema.Ref)({
  id: AuthProviderSchema.ID.create(),
  revision: 1,
})
const attempt = WebCookie.Attempt.make({
  version: 1,
  type: "attempt",
  binding: { type: "oidc", provider: providerRef },
  state: Redacted.make("expected-state"),
  verifier: Redacted.make("verifier"),
  redirectURI: new URL("https://app.example/auth/callback"),
  expiresAt: DateTime.addDuration(DateTime.nowUnsafe(), "1 day"),
})
const loginSession = WebCookie.Session.make({
  version: 2,
  type: "session",
  id: Auth.SessionID.make("lgs_routes_test"),
  accountID,
  issuedAt: DateTime.nowUnsafe(),
  expiresAt: DateTime.addDuration(DateTime.nowUnsafe(), "1 day"),
})
const expiredAttempt = WebCookie.Attempt.make({
  ...attempt,
  expiresAt: DateTime.addDuration(DateTime.nowUnsafe(), "-1 day"),
})
let selectedWorkspace: Workspace.ID | undefined
let selectedRole = "member" as UserSchema.Role
let listedWorkspace: Workspace.ID | undefined
let invitation: { readonly workspaceID: Workspace.ID; readonly input: UserSchema.InviteInput } | undefined
let invitationFailure: "unavailable" | undefined
let boundCalls = 0
let graphAcquisitions = 0
let pluginReloads = 0
const outboundConfigs = new Map<Workspace.ID, Info>()
const outboundOverrides = new Map<string, boolean>()
let startedLogins = 0
let failDirectoryList = false
const auditRecords: Array<Audit.RecordInput> = []
let pluginFlushes = 0
let pluginActivationFailure = false
const resolvedGatewayTokens: string[] = []
let gatewayLists = 0
let budgetReserves = 0
let budgetReserve: Budget.Interface["reserve"]
budgetReserve = () => Effect.succeed({ settle: () => Effect.void })
let removedCredential: Credential.ID | undefined
let discardedIntegrations: string[] = []
let connectedMembers: Array<{ readonly userID: UserSchema.ID; readonly updated: Date }> = []
let valuesConnection: Parameters<Integration.Interface["connection"]["values"]>[0] | undefined
let updatedCredential: { id: Credential.ID; label: string } | undefined
let activatedCredential: Credential.ID | undefined
let keyConnection: Parameters<Integration.Interface["connection"]["key"]>[0] | undefined
let oauthConnection: Parameters<Integration.Interface["oauth"]["connect"]>[0] | undefined
let oauthCompletion: Parameters<Integration.Interface["oauth"]["complete"]>[0] | undefined
let integrationOAuthCallback: { readonly state?: string; readonly code?: string; readonly error?: string } | undefined
let cancelledOAuth: Parameters<Integration.Interface["oauth"]["cancel"]>[0] | undefined
let commandConnection: Parameters<Integration.Interface["command"]["connect"]>[0] | undefined
let cancelledCommand: Parameters<Integration.Interface["command"]["cancel"]>[0] | undefined
let clientPut: Parameters<Integration.Interface["client"]["put"]>[0] | undefined
let clientRemove: Parameters<Integration.Interface["client"]["remove"]>[0] | undefined
let clientConfigurationFailure:
  | { readonly operation: "put" | "remove" | "connect"; readonly kind: "invalid" | "missing" | "storage" | "unknown" }
  | undefined
let oauthFailure: "connect" | "complete" | "code" | undefined
let commandFailure = false
let activeCalls = 0
let overviewRequest: { readonly workspaceID: Workspace.ID; readonly days: Days } | undefined
let usageRecordsRequest:
  { readonly workspaceID: Workspace.ID; readonly cursor?: string; readonly limit?: number } | undefined
let toolUsageRequest:
  | {
      readonly workspaceID: Workspace.ID
      readonly cursor?: string
      readonly limit?: number
      readonly userID?: UserSchema.ID
      readonly sessionID?: SessionSchema.ID
    }
  | undefined
const activeSessions = new Map<Workspace.ID, ReadonlySet<SessionSchema.ID>>()
let oauthAttemptStatus = Integration.AttemptStatus.make({
  status: "failed",
  message: "code=oauth-code token=oauth-token answer=oauth-answer",
  time: { created: 1, expires: 2 },
})
let commandAttemptStatus = Integration.CommandAttemptStatus.make({
  status: "pending",
  message: "checking...\n  exact stderr\n",
  time: { created: 1, expires: 2 },
})
const providerInfo = ProviderSchema.Info.make({
  name: ProviderSchema.Bymorning,
  displayName: "Bymorning",
  api: ProviderSchema.API.make("https://bymorning.ai/gateway/v1"),
  format: "oa-compat",
  status: "enabled",
})
const providerDirectoryEntry = ProviderSchema.DirectoryEntry.make({
  info: providerInfo,
  integration: Integration.Info.make({
    id: Integration.ID.make(providerInfo.name),
    name: "Bymorning",
    methods: [],
    connections: [],
  }),
  active: false,
  connected: false,
  connectionCount: 0,
  modelCount: 1,
})
const provider = Provider.Service.of({
  get: () => Effect.succeed(providerInfo),
  list: Effect.sync(() => (boundCalls += 1)).pipe(Effect.as([providerInfo])),
  stream: () => Stream.die("unused"),
})
const missingProjectID = ProjectSchema.ID.create()
const managedProjectID = ProjectSchema.ID.create()
const managedProject = ProjectSchema.Info.make({
  id: managedProjectID,
  name: "Managed",
  time_created: 0,
  time_updated: 0,
})
const selectedAgent = AgentSchema.ID.make("selected")
const selectedModel = ModelSchema.Ref.make({ provider: ProviderSchema.Name.make("selected"), id: "selected" })
const unavailableModel = ModelSchema.Ref.make({
  provider: ProviderSchema.Name.make("selected"),
  id: "unavailable",
})
const routeModel = ModelSchema.Info.make({
  id: "route-model",
  provider: ProviderSchema.Bymorning,
  apiID: "route-model",
  name: "Route model",
  description: "",
  status: "active",
  releaseDate: "2026-01-01",
  lastUpdated: "2026-01-01",
  openWeights: false,
  capabilities: { temperature: true, reasoning: false, attachment: false, tools: true, input: [], output: [] },
  variants: [],
  limit: { context: 1, output: 1 },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
})
const modelPolicyByWorkspace = new Map<Workspace.ID, Set<string>>()
const managedAgent = AgentSchema.Info.make({
  id: selectedAgent,
  name: AgentSchema.Name.make("Selected"),
  instructions: "Selected Agent",
  model: selectedModel,
  mode: "primary",
  hidden: false,
  steps: null,
  permissions: [],
})
const builtInAgent = AgentSchema.Info.make({
  id: AgentSchema.DefaultID,
  name: AgentSchema.Name.make("Default"),
  instructions: "Shipped Agent",
  mode: "primary",
  hidden: false,
  steps: null,
  permissions: [],
})
const knownAgent = (id: AgentSchema.ID) =>
  id === selectedAgent ? managedAgent : id === AgentSchema.DefaultID ? builtInAgent : undefined
const agent = Agent.Service.of({
  transform: () => Effect.succeed({ dispose: Effect.void }),
  reload: () => Effect.void,
  list: Effect.succeed([managedAgent]),
  get: (id) => Effect.succeed(knownAgent(id)),
  resolve: Effect.succeed(managedAgent),
  create: (input) => {
    if (input.id === selectedAgent) return Effect.fail(new Agent.ConflictError({ id: input.id }))
    if (input.model?.id === unavailableModel.id)
      return Effect.fail(new Agent.ModelUnavailableError({ model: input.model }))
    return Effect.succeed(input)
  },
  update: (id, input) => {
    if (knownAgent(id) === undefined) return Effect.fail(new Agent.NotFoundError({ id }))
    if (input.model?.id === unavailableModel.id)
      return Effect.fail(new Agent.ModelUnavailableError({ model: input.model }))
    return Effect.succeed(AgentSchema.Info.make({ id, ...input }))
  },
  delete: (id) => {
    if (knownAgent(id) === undefined) return Effect.fail(new Agent.NotFoundError({ id }))
    deletedAgents.push(id)
    return Effect.void
  },
})
const deletedAgents: AgentSchema.ID[] = []
let createdSessionInput: SessionSchema.CreateInput | undefined
const managedSkill = SkillSchema.Info.make({
  id: SkillSchema.ID.create(),
  name: "Review",
  description: "Reviews changes",
  instructions: "Inspect carefully",
})
const missingSkillID = SkillSchema.ID.create()
let updatedSkill: SkillSchema.Info | undefined
const project = Project.Service.of({
  create: () => Effect.die(new Error("unused")),
  get: (projectID) =>
    projectID === managedProjectID
      ? Effect.succeed(managedProject)
      : Effect.fail(new Project.NotFoundError({ projectID })),
  list: () => Effect.succeed([]),
  update: ({ projectID }) => Effect.fail(new Project.NotFoundError({ projectID })),
  delete: (projectID) => Effect.fail(new Project.NotFoundError({ projectID })),
})
const session = Session.Service.of({
  synthetic: () => Effect.die(new Error("unused")),
  createChild: () => Effect.die(new Error("unused")),
  create: (input) => {
    if (input.projectID !== managedProjectID)
      return Effect.fail(new Project.NotFoundError({ projectID: input.projectID }))
    return Effect.sync(() => {
      createdSessionInput = input
      return SessionSchema.Info.make({
        id: SessionSchema.ID.make("00000000-0000-4000-8000-000000000801"),
        projectID: input.projectID,
        title: "New session",
        agent: input.agent ?? AgentSchema.DefaultID,
        model: input.model ?? selectedModel,
        createdAt: new Date("2026-08-22T12:00:00.000Z"),
        updatedAt: new Date("2026-08-22T12:00:00.000Z"),
      })
    })
  },
  update: ({ sessionID, projectID }) =>
    projectID === undefined
      ? Effect.fail(new Session.NotFoundError({ sessionID }))
      : Effect.fail(new Project.NotFoundError({ projectID })),
  delete: (sessionID) => Effect.fail(new Session.NotFoundError({ sessionID })),
  list: () => Effect.succeed({ data: [] }),
  get: (sessionID) => Effect.fail(new Session.NotFoundError({ sessionID })),
  inbox: () => Effect.die(new Error("unused")),
  messages: () => Effect.die(new Error("unused")),
  prompt: () => Effect.die(new Error("unused")),
  compact: () => Effect.die(new Error("unused")),
  active: Effect.die(new Error("unbound active snapshot")),
  background: () => Effect.die(new Error("unused")),
  interrupt: () => Effect.die(new Error("unused")),
  resume: () => Effect.die(new Error("unused")),
  awaitIdle: () => Effect.die(new Error("unused")),
  switchAgent: () => Effect.die(new Error("unused")),
  switchModel: () => Effect.die(new Error("unused")),
})
const skill = Skill.Service.of({
  transform: () => Effect.succeed({ dispose: Effect.void }),
  reload: () => Effect.void,
  list: Effect.succeed([managedSkill]),
  get: (skillID) =>
    skillID === managedSkill.id ? Effect.succeed(managedSkill) : Effect.fail(new Skill.NotFoundError({ skillID })),
  create: (input) =>
    Effect.succeed(
      SkillSchema.Info.make({
        id: managedSkill.id,
        name: input.name,
        description: input.description,
        instructions: input.instructions,
      }),
    ),
  update: (input) =>
    Effect.sync(() => {
      updatedSkill = input
      return input
    }),
  delete: (skillID) => (skillID === managedSkill.id ? Effect.void : Effect.fail(new Skill.NotFoundError({ skillID }))),
})
const integration = Integration.Service.of({
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(undefined),
  client: {
    put: (input: Parameters<Integration.Interface["client"]["put"]>[0]) => {
      if (clientConfigurationFailure?.operation !== "put") return Effect.sync(() => void (clientPut = input))
      if (clientConfigurationFailure.kind === "invalid")
        return Effect.fail(new Integration.OAuthClientConfigurationInvalidError(input))
      if (clientConfigurationFailure.kind === "missing")
        return Effect.fail(new Integration.OAuthMethodNotFoundError(input))
      if (clientConfigurationFailure.kind === "storage")
        return Effect.fail(new Integration.OAuthClientConfigurationStorageError({ ...input, operation: "put" }))
      return Effect.die(new Error("sensitive OAuth client configuration put failure"))
    },
    remove: (input: Parameters<Integration.Interface["client"]["remove"]>[0]) => {
      if (clientConfigurationFailure?.operation !== "remove") return Effect.sync(() => void (clientRemove = input))
      if (clientConfigurationFailure.kind === "missing")
        return Effect.fail(new Integration.OAuthMethodNotFoundError(input))
      if (clientConfigurationFailure.kind === "storage")
        return Effect.fail(new Integration.OAuthClientConfigurationStorageError({ ...input, operation: "remove" }))
      return Effect.die(new Error("sensitive OAuth client configuration remove failure"))
    },
  },
  connection: {
    key: (input: Parameters<Integration.Interface["connection"]["key"]>[0]) =>
      Effect.sync(() => {
        keyConnection = input
      }),
    values: (input: Parameters<Integration.Interface["connection"]["values"]>[0]) =>
      input.values.BAD === undefined
        ? Effect.sync(() => {
            valuesConnection = input
          })
        : Effect.fail(new Integration.ValuesError({ message: "Unknown value: BAD" })),
    activate: (credentialID: Credential.ID) =>
      Effect.sync(() => {
        activatedCredential = credentialID
      }),
    update: (credentialID: Credential.ID, updates: { readonly label?: string }) =>
      Effect.sync(() => {
        if (updates.label !== undefined) updatedCredential = { id: credentialID, label: updates.label }
      }),
    remove: (credentialID: Credential.ID) =>
      Effect.sync(() => {
        removedCredential = credentialID
      }),
  },
  oauth: {
    connect: (input: Parameters<Integration.Interface["oauth"]["connect"]>[0]) => {
      oauthConnection = input
      if (clientConfigurationFailure?.operation === "connect") {
        if (clientConfigurationFailure.kind === "invalid")
          return Effect.fail(new Integration.OAuthClientConfigurationInvalidError(input))
        if (clientConfigurationFailure.kind === "storage")
          return Effect.fail(new Integration.OAuthClientConfigurationStorageError({ ...input, operation: "resolve" }))
        return Effect.die(new Error("sensitive stored OAuth client configuration failure"))
      }
      if (oauthFailure === "connect") {
        return Effect.fail(new Integration.AuthorizationError({ cause: new Error("sensitive OAuth cause") }))
      }
      return Effect.succeed(
        Integration.Attempt.make({
          attemptID: Integration.AttemptID.make("con_oauth"),
          url: "https://example.com/authorize",
          instructions: "Continue in your browser",
          mode: "code",
          time: { created: 1, expires: 2 },
        }),
      )
    },
    status: () => Effect.succeed(oauthAttemptStatus),
    complete: (input: Parameters<Integration.Interface["oauth"]["complete"]>[0]) => {
      oauthCompletion = input
      if (oauthFailure === "code") {
        return Effect.fail(new Integration.CodeRequiredError({ attemptID: input.attemptID }))
      }
      if (oauthFailure === "complete") {
        return Effect.fail(new Integration.AuthorizationError({ cause: new Error("sensitive completion cause") }))
      }
      return Effect.void
    },
    cancel: (input: Parameters<Integration.Interface["oauth"]["cancel"]>[0]) =>
      Effect.sync(() => void (cancelledOAuth = input)),
  },
  command: {
    connect: (input: Parameters<Integration.Interface["command"]["connect"]>[0]) => {
      commandConnection = input
      if (commandFailure) {
        return Effect.fail(new Integration.AuthorizationError({ cause: new Error("sensitive command cause") }))
      }
      return Effect.succeed({
        attemptID: Integration.AttemptID.make("con_command"),
        time: { created: 1, expires: 2 },
      })
    },
    status: () => Effect.succeed(commandAttemptStatus),
    cancel: (input: Parameters<Integration.Interface["command"]["cancel"]>[0]) =>
      Effect.sync(() => void (cancelledCommand = input)),
  },
} as unknown as Integration.Interface)
const storageLayer = Storage.layer({
  configure: (draft) => {
    draft.add(Storage.memory())
    draft.default.set(Storage.ID.make("memory"))
  },
})
const storage = Layer.effect(
  Storage.Service,
  Effect.gen(function* () {
    const storage = yield* Storage.Service
    return Storage.Service.of({
      ...storage,
      object: {
        ...storage.object,
        list: (prefix) =>
          failDirectoryList
            ? Effect.fail(
                new Storage.OperationError({
                  message: "Failed to list stored objects",
                  providerID: Storage.ID.make("memory"),
                  operation: "list",
                  cause: new Error("sensitive provider cause"),
                }),
              )
            : storage.object.list(prefix),
      },
    })
  }),
).pipe(Layer.provide(storageLayer))
const database = Layer.succeed(
  Database.Service,
  Database.Service.of({
    use: <A, E, R>(label: string): Effect.Effect<A, E, R> =>
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- the focused DB seam returns the middleware projection for its one supported query
      (label === "SessionWorkspaceMiddleware.lookup"
        ? Effect.succeed([
            {
              workspaceID,
              userID: actor.properties.userID,
              accountID,
              role: actor.properties.role,
              userDeleted: null,
              accountStatus: "active",
              accountDeleted: null,
              workspaceStatus: "active",
              workspaceDeleted: null,
            },
          ])
        : Effect.die(new Error("unexpected Session database lookup"))) as unknown as Effect.Effect<A, E, R>,
    transact: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
    transactRoot: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
    afterCommit: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.asVoid(effect),
  }),
)
const providerLayer = Layer.succeed(Provider.Service, provider)
const accountLayer = Layer.succeed(
  Account.Service,
  Account.Service.of({
    get: () => Effect.succeed({ id: account.properties.accountID, email: null }),
    validate: () => Effect.succeed(account),
    suspend: () => Effect.die(new Error("unused")),
    restore: () => Effect.die(new Error("unused")),
  }),
)
const userLayer = Layer.succeed(
  User.Service,
  User.Service.of({
    select: (input) =>
      Effect.sync(() => {
        selectedWorkspace = input.workspaceID
        if (input.workspaceID === undefined) return actor
        return new UserActor({
          type: "user",
          properties: { ...actor.properties, workspaceID: input.workspaceID, role: selectedRole },
        })
      }),
    invite: Effect.fn("User.Test.invite")(function* (workspaceID: Workspace.ID, input: UserSchema.InviteInput) {
      invitation = { workspaceID, input }
      if (invitationFailure !== undefined) {
        return yield* new User.InviteError({
          reason: "persistence-unavailable",
        })
      }
      return UserSchema.Member.make({ id: UserSchema.ID.create(), ...input, status: "pending" })
    }),
    remove: () => Effect.die(new Error("unused")),
    list: (selectedActor) =>
      Effect.sync(() => {
        listedWorkspace = selectedActor.properties.workspaceID
        return UserSchema.MemberList.make({
          role: selectedActor.properties.role,
          members: [
            UserSchema.Member.make({
              id: actor.properties.userID,
              email: AuthSchema.Email.make("member@example.com"),
              role: selectedActor.properties.role,
              status: "active",
            }),
          ],
        })
      }),
  }),
)
const authLayer = Layer.succeed(
  Auth.Service,
  Auth.Service.of({
    resolve: (assertion) =>
      assertion.verifiedEmail.endsWith("@bymorning.ai")
        ? Effect.succeed(account)
        : Effect.die(new Error("email-domain")),
    open: () =>
      Effect.sync(() => {
        startedLogins++
        return { redirect: new URL("https://issuer.example/authorize"), attempt }
      }),
    complete: ({ attempt: current, response }) => {
      const params = Redacted.value(response)
      const reject = (reason: Auth.RejectedError["reason"]) =>
        Effect.fail(new Auth.RejectedError({ reason, message: "Authentication failed" }))
      if (current === expiredAttempt)
        return Effect.fail(new Auth.ExpiredError({ reason: "attempt", message: "Login attempt expired" }))
      if (params.get("state") !== Redacted.value(current.state)) return reject("state")
      const code = params.get("code")
      if (code === "successful-code") return Effect.succeed({ actor: account, session: loginSession })
      if (code === "denied-code") return reject("email-domain")
      if (code === "unverified-code") return reject("email-unverified")
      if (code === "unknown-provider-code") return reject("provider-missing")
      if (code === "invite-only-code") return reject("provisioning")
      if (code === "unavailable-code")
        return Effect.fail(new Auth.UnavailableError({ operation: "complete", message: "Authentication is unavailable" }))
      return code === "" ? reject("response") : reject("exchange")
    },
    authenticate: () => Effect.succeed(account),
    end: () => Effect.void,
    list: () => Effect.succeed([]),
    revoke: () => Effect.void,
    revokeAll: () => Effect.void,
  }),
)
const authNode = makeGlobalNode({ service: Auth.Service, layer: authLayer, deps: [] })
let providerInfos: AuthProvider.Info[] = []
const admittedProvider = (domains: readonly string[], status: "enabled" | "disabled" = "enabled"): AuthProvider.Info =>
  AuthProvider.Info.make({
    id: AuthProviderSchema.ID.create(),
    revision: AuthProviderSchema.Revision.make(1),
    displayName: "Fixture IdP",
    kind: "custom",
    issuer: Schema.decodeUnknownSync(AuthProviderSchema.Issuer)("https://issuer.example"),
    clientID: "fixture-client",
    domains: Schema.decodeUnknownSync(Schema.NonEmptyArray(AuthProviderSchema.Domain))(domains),
    status,
  })
/** Outcome of the Auth Provider writes that run discovery (setup, create, update). */
let providerDiscovery = (): Effect.Effect<never, AuthProvider.DiscoveryError> => Effect.die(new Error("unused"))
const authProviderNode = makeGlobalNode({
  service: AuthProvider.Service,
  deps: [],
  layer: Layer.succeed(
    AuthProvider.Service,
    AuthProvider.Service.of({
      init: () => Effect.void,
      list: () => Effect.sync(() => [...providerInfos]),
      get: () => Effect.die(new Error("unused")),
      create: () => providerDiscovery(),
      update: () => providerDiscovery(),
      resolve: () => Effect.die(new Error("unused")),
      inspect: () => Effect.die(new Error("unused")),
      setup: () => providerDiscovery(),
    }),
  ),
})
// The fixture treats the selected workspace Role as the Installation Admin
// grant: tests that set selectedRole = "admin" exercise the authorized path,
// and member tests exercise the Installation Admin refusal.
const installationNode = makeGlobalNode({
  service: Installation.Service,
  deps: [],
  layer: Layer.succeed(
    Installation.Service,
    Installation.Service.of({
      admin: {
        list: () => Effect.die(new Error("unused")),
        grant: () => Effect.die(new Error("unused")),
        revoke: () => Effect.die(new Error("unused")),
      },
      policy: {
        get: Effect.succeed(Installation.empty),
        update: () => Effect.die(new Error("unused")),
      },
      check: () => Effect.sync(() => selectedRole === "admin"),
      bootstrap: () => Effect.succeed(false),
      arm: Effect.void,
    }),
  ),
})
const oauthCallbackNode = makeGlobalNode({
  service: IntegrationOAuthCallback.Service,
  deps: [],
  layer: Layer.succeed(
    IntegrationOAuthCallback.Service,
    IntegrationOAuthCallback.Service.of({
      register: () => Effect.die(new Error("unused")),
      deliver: (input) =>
        Effect.sync(() => {
          integrationOAuthCallback = input
          return input.state === "expected"
        }),
    }),
  ),
})
const workspaceMapNode = WorkspaceMap.node({
  bindings: [],
  member: (owner) => {
    const workspaceID = owner.workspaceID
    graphAcquisitions++
    const bus = Bus.layer.pipe(Layer.provide(NodeCrypto.layer))
    const form = Form.layer.pipe(Layer.provide(bus))
    const readOutboundConfig = () => outboundConfigs.get(workspaceID) ?? Schema.decodeUnknownSync(Info)({})
    const config = Config.Service.of({
      provider: { update: () => Effect.die(new Error("unused")) },
      get: Effect.sync(readOutboundConfig),
      update: (input) =>
        Schema.decodeUnknownEffect(Info)(input).pipe(
          Effect.orDie,
          Effect.tap((value) => Effect.sync(() => outboundConfigs.set(workspaceID, value))),
        ),
      refresh: Effect.sync(readOutboundConfig),
      model: { put: () => Effect.die(new Error("unused")), remove: () => Effect.die(new Error("unused")) },
      mcp: {
        update: (name, activation) =>
          Effect.sync(() => {
            const current = readOutboundConfig()
            const value = Info.make({
              ...current,
              mcp: { ...current.mcp, activation: { ...current.mcp?.activation, [name]: activation } },
            })
            outboundConfigs.set(workspaceID, value)
            return value
          }),
        put: (name, server) =>
          Effect.sync(() => {
            const current = readOutboundConfig()
            const value = Info.make({
              ...current,
              mcp: { ...current.mcp, servers: { ...current.mcp?.servers, [name]: server } },
            })
            outboundConfigs.set(workspaceID, value)
            return value
          }),
        remove: (name) =>
          Effect.sync(() => {
            const current = readOutboundConfig()
            const servers = { ...current.mcp?.servers }
            delete servers[name]
            const value = Info.make({ ...current, mcp: { ...current.mcp, servers } })
            outboundConfigs.set(workspaceID, value)
            return value
          }),
      },
      modelPolicy: {
        reconcile: () => Effect.sync(readOutboundConfig),
        initialize: () => Effect.sync(readOutboundConfig),
        toggle: () => Effect.sync(readOutboundConfig),
        setDefault: () => Effect.sync(readOutboundConfig),
      },
      plugin: Config.pluginUnavailable,
      entries: () => Effect.succeed([]),
      changes: () => Stream.empty,
    })
    const outbound = Mcp.Service.of({
      instructions: () => Effect.succeed([]),
      servers: () =>
        Effect.sync(() =>
          Object.entries(readOutboundConfig().mcp?.servers ?? {}).map(([name, server]) => ({
            name,
            enabled:
              readOutboundConfig().mcp?.activation?.[name] === "enabled" ||
              (readOutboundConfig().mcp?.activation?.[name] === undefined && server.disabled !== true),
            status:
              outboundOverrides.get(`${workspaceID}\0${name}`) === false ||
              readOutboundConfig().mcp?.activation?.[name] === "disabled" ||
              (readOutboundConfig().mcp?.activation?.[name] === undefined && server.disabled === true)
                ? ("disabled" as const)
                : ("connected" as const),
            ...(server.oauth === false ? {} : { integrationID: Mcp.identity(name, server.url) }),
          })),
        ),
      authorize: () => Effect.die(new Error("unused")),
      connect: (name) =>
        Effect.sync(() => readOutboundConfig().mcp?.servers?.[name]).pipe(
          Effect.flatMap((server) =>
            server === undefined || readOutboundConfig().mcp?.activation?.[name] === "disabled"
              ? Effect.fail(new Mcp.NotFoundError({ server: name }))
              : Effect.sync(() => outboundOverrides.set(`${workspaceID}\0${name}`, true)),
          ),
          Effect.asVoid,
        ),
      disconnect: (name) =>
        Effect.sync(() => readOutboundConfig().mcp?.servers?.[name]).pipe(
          Effect.flatMap((server) =>
            server === undefined
              ? Effect.fail(new Mcp.NotFoundError({ server: name }))
              : Effect.sync(() => outboundOverrides.set(`${workspaceID}\0${name}`, false)),
          ),
          Effect.asVoid,
        ),
      test: (name) =>
        Effect.sync(() => readOutboundConfig().mcp?.servers?.[name]).pipe(
          Effect.flatMap((server) => {
            if (
              server !== undefined &&
              readOutboundConfig().mcp?.activation?.[name] !== "disabled" &&
              outboundOverrides.get(`${workspaceID}\0${name}`) !== false
            )
              return Effect.void
            return Effect.fail(
              server === undefined
                ? new Mcp.NotFoundError({ server: name })
                : new Mcp.RequestError({ message: "Connection failed", cause: name }),
            )
          }),
        ),
      tools: () =>
        Effect.sync(() =>
          Object.keys(readOutboundConfig().mcp?.servers ?? {}).map((server) => ({
            server,
            name: "search",
            action: `${server}_search`,
            description: "Search the remote service",
          })),
        ),
      callTool: () => Effect.fail(new Mcp.NotFoundError({ server: "test" })),
      transform: () => Effect.succeed({ dispose: Effect.void }),
      reload: () => Effect.void,
    })
    const seededPolicy = Layer.effect(
      Policy.Service,
      Effect.gen(function* () {
        const registry = yield* Policy.Service
        yield* registry.transform((draft) =>
          draft.add({
            id: "plugin-contributed",
            name: "Plugin contributed",
            enabled: true,
            rules: [],
            source: { type: "plugin", pluginID: PluginSchema.ID.make("test.plugin"), pluginSource: { type: "sdk" } },
          }),
        )
        return registry
      }),
    ).pipe(Layer.provide(Policy.layer))
    // Fresh so each Workspace gets its own registry, like the production graph in workspace-map/graph.ts.
    const managedPolicy = ManagedPolicy.layer(workspaceID).pipe(
      Layer.provideMerge(seededPolicy),
      Layer.provide(storageLayer),
      Layer.fresh,
    )
    return makeWorkspaceNode({
      name: "@bymorning/server/test/Routes.workspace",
      deps: [],
      layer:
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- focused route test supplies only capabilities its requests invoke
        Layer.mergeAll(
          form,
          managedPolicy,
          Layer.succeed(Config.Service, config),
          Layer.succeed(Mcp.Service, outbound),
          Layer.succeed(
            Tool.Service,
            Tool.Service.of({
              transform: () => Effect.die(new Error("unused")),
              actions: () =>
                Effect.succeed([
                  { name: "read", action: "read", description: "Read workspace files" },
                  { name: "linear_tool", action: "linear_tool", description: "Search Linear" },
                ]),
              snapshot: () =>
                Effect.succeed({
                  definitions: [
                    {
                      type: "tool" as const,
                      name: "read",
                      description: "Read workspace files",
                      inputSchema: { type: "object" },
                    },
                    {
                      type: "tool" as const,
                      name: "linear_tool",
                      description: "Search Linear",
                      inputSchema: { type: "object" },
                    },
                  ],
                  execute: () => Effect.succeed({ content: [] }),
                }),
              reload: () => Effect.void,
            }),
          ),
          Layer.succeed(
            ToolGateway.Member.Service,
            ToolGateway.Member.Service.of({
              snapshot: Effect.succeed({
                definitions: [
                  { type: "tool" as const, name: "linear_search", description: "Search Linear", inputSchema: {} },
                  { type: "tool" as const, name: "execute", description: "Execute code", inputSchema: {} },
                ],
                execute: ({ call }) =>
                  Effect.succeed({
                    content: [{ type: "text" as const, text: call.name === "linear_search" ? "ok" : "ok" }],
                  }),
              }),
              call: () => Effect.die(new Error("unused")),
              resume: () => Effect.die(new Error("unused")),
            }),
          ),
          Layer.succeed(Project.Service, project),
          bus,
          form,
          Layer.succeed(Agent.Service, agent),
          Layer.succeed(
            Session.Service,
            Session.Service.of({
              ...session,
              active: Effect.sync(() => {
                activeCalls++
                return activeSessions.get(workspaceID) ?? new Set()
              }),
            }),
          ),
          Layer.succeed(
            Usage.Service,
            Usage.Service.of({
              record: () => Effect.die(new Error("unused")),
              spend: () => Effect.die(new Error("unused")),
              list: () => Effect.succeed({ data: [] }),
              records: (input = {}) =>
                Effect.sync(() => {
                  usageRecordsRequest = { workspaceID, ...input }
                  return {
                    data: [
                      Record.make({
                        id: ID.make("00000000-0000-4000-8000-000000000721"),
                        model: "bymorning/route-model",
                        createdAt: new Date("2026-08-30T12:00:00.000Z"),
                        usage: {
                          cost: 1.5,
                          costComplete: false,
                          tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
                        },
                      }),
                    ],
                    cursor: "next_page",
                  }
                }),
              overview: ({ days }) =>
                Effect.sync(() => {
                  overviewRequest = { workspaceID, days }
                  const total = Aggregate.make({
                    invocations: workspaceID === otherWorkspaceID ? 2 : 1,
                    cost: days,
                    costComplete: true,
                    tokens: {
                      total: 15,
                      input: 1,
                      output: 2,
                      reasoning: 3,
                      cache: { read: 4, write: 5 },
                    },
                  })
                  return Overview.make({
                    days,
                    from: new Date("2026-08-01T00:00:00.000Z"),
                    to: new Date("2026-08-30T12:00:00.000Z"),
                    total,
                    daily: [{ date: "2026-08-01", usage: total }],
                    users: [{ userID: actor.properties.userID, usage: total }],
                    models: [{ model: "bymorning/route-model", usage: total }],
                  })
                }),
              leaderboard: ({ days }) =>
                Effect.succeed(
                  Leaderboard.make({
                    days,
                    from: new Date("2026-08-01T00:00:00.000Z"),
                    to: new Date("2026-08-30T12:00:00.000Z"),
                    users: [],
                    models: [],
                  }),
                ),
            }),
          ),
          Layer.succeed(
            ToolUsage.Service,
            ToolUsage.Service.of({
              records: (input = {}) => {
                if (input.cursor === "bad_cursor") return Effect.fail(new ToolUsage.InvalidCursorError())
                return Effect.sync(() => {
                  toolUsageRequest = { workspaceID, ...input }
                  return {
                    data: [
                      ToolUsageSchema.Record.make({
                        id: ToolUsageSchema.ID.make("00000000-0000-4000-8000-000000000731"),
                        workspaceID,
                        userID: input.userID ?? actor.properties.userID,
                        sessionID: input.sessionID ?? null,
                        tool: "linear.search",
                        status: "completed",
                        occurredAt: new Date("2026-09-03T12:00:00.000Z"),
                      }),
                    ],
                    cursor: "next_page",
                  }
                })
              },
            }),
          ),
          Layer.succeed(Skill.Service, skill),
          managedPolicy,
          Layer.succeed(Integration.Service, integration),
          Layer.succeed(Credential.Service, {
            discard: (integrationID: string) => Effect.sync(() => void discardedIntegrations.push(integrationID)),
            connected: () => Effect.sync(() => connectedMembers),
          } as unknown as Credential.Interface),
          Layer.succeed(
            PluginSupervisor.Service,
            PluginSupervisor.Service.of({
              awaitActivation: Effect.sync(() => pluginFlushes++),
              reload: Effect.sync(() => pluginFlushes++),
              reloadAfter: (mutation) =>
                mutation.pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      pluginFlushes++
                      pluginReloads++
                    }),
                  ),
                ),
            }),
          ),
          Layer.succeed(
            Plugin.Service,
            Plugin.Service.of({
              awaitActivation: Effect.sync(() => pluginFlushes++).pipe(
                Effect.andThen(
                  Effect.suspend(() =>
                    pluginActivationFailure
                      ? Effect.fail(
                          new Plugin.ActivationError({
                            pluginID: PluginSchema.ID.make("required.tool"),
                            message: "sensitive activation detail",
                          }),
                        )
                      : Effect.void,
                  ),
                ),
              ),
              hold: () => Effect.succeed(Effect.void),
              close: () => Effect.void,
              activate: () => Effect.void,
              list: () => Effect.succeed([]),
            }),
          ),
          Layer.sync(Catalog.Service, () => {
            boundCalls++
            const list = [routeModel]
            const visible = () =>
              Effect.sync(() =>
                list
                  .filter((info) => info.provider === ProviderSchema.Bymorning)
                  .map((info, index) =>
                    ModelSchema.Management.make({
                      info,
                      enabled: !modelPolicyByWorkspace.get(workspaceID)?.has(info.id),
                      isPreferredDefault: index === 0,
                      isEffectiveDefault: index === 0,
                    }),
                  ),
              )
            return Catalog.Service.of({
              provider: {
                get: () => Effect.succeed(providerInfo),
                all: () => Effect.succeed([providerInfo]),
                available: () => Effect.succeed([providerInfo]),
                directory: () =>
                  Effect.sync(() =>
                    selectedWorkspace === otherWorkspaceID
                      ? [{ ...providerDirectoryEntry, connected: true, connectionCount: 1 }]
                      : [providerDirectoryEntry],
                  ),
                update: (input: ProviderSchema.UpdateInput) =>
                  Effect.succeed({ ...providerInfo, status: input.status }),
              },
              model: {
                available: () => Effect.succeed(list.filter((info) => info.provider === ProviderSchema.Bymorning)),
                visible,
                toggle: (input: ModelSchema.ToggleInput) =>
                  visible().pipe(
                    Effect.flatMap((management) => {
                      if (
                        !management.some((item) => item.info.provider === input.provider && item.info.id === input.id)
                      )
                        return Effect.fail(new Catalog.ModelUnavailableError({ model: input }))
                      return Effect.sync(() => {
                        const disabled = modelPolicyByWorkspace.get(workspaceID) ?? new Set<string>()
                        if (input.enabled) disabled.delete(input.id)
                        if (!input.enabled) disabled.add(input.id)
                        modelPolicyByWorkspace.set(workspaceID, disabled)
                      }).pipe(Effect.andThen(visible()))
                    }),
                  ),
                setDefault: (input: ModelSchema.Identity) =>
                  visible().pipe(
                    Effect.flatMap((management) => {
                      const selected = management.find(
                        (item) => item.info.provider === input.provider && item.info.id === input.id,
                      )
                      return selected?.enabled
                        ? Effect.succeed(
                            management.map((item) => ({
                              ...item,
                              isPreferredDefault: item.info.provider === input.provider && item.info.id === input.id,
                              isEffectiveDefault: item.info.provider === input.provider && item.info.id === input.id,
                            })),
                          )
                        : Effect.fail(new Catalog.ModelUnavailableError({ model: input }))
                    }),
                  ),
              },
            } as unknown as Catalog.Interface)
          }),
        ) as Layer.Layer<WorkspaceMap.Capabilities>,
    })
  },
})
const oauthNode = makeGlobalNode({
  service: OAuth.Service,
  deps: [],
  layer: Layer.succeed(
    OAuth.Service,
    OAuth.Service.of({
      resolveAccess: (token: string) =>
        Effect.sync(() => resolvedGatewayTokens.push(token)).pipe(
          Effect.as(
            token === "valid"
              ? actor.properties
              : token === "other"
                ? { ...actor.properties, workspaceID: otherWorkspaceID }
                : undefined,
          ),
        ),
    } as unknown as OAuth.Interface),
  ),
})
const llmLeaseNode = makeGlobalNode({
  service: LLMGateway.Lease.Service,
  deps: [],
  layer: Layer.succeed(
    LLMGateway.Lease.Service,
    LLMGateway.Lease.Service.of({
      acquire: () => Effect.die(new Error("unused")),
      invalidate: () => Effect.void,
    }),
  ),
})
const gatewayReply = () => ({
  status: 200,
  headers: Headers.fromInput({ "content-type": "application/json" }),
  body: Stream.make(new TextEncoder().encode('{"ok":true}')),
})
let gatewayInvoke: LLMGateway.Interface["invoke"]
gatewayInvoke = () => Effect.succeed(gatewayReply())
const llmGatewayNode = makeGlobalNode({
  service: LLMGateway.Service,
  deps: [],
  layer: Layer.succeed(
    LLMGateway.Service,
    LLMGateway.Service.of({
      list: () => Effect.sync(() => gatewayLists++).pipe(Effect.as(gatewayReply())),
      invoke: (input) => gatewayInvoke(input),
      preview: () => Effect.die(new Error("Routing preview is not exercised by route tests")),
    }),
  ),
})
const cookieNode = makeGlobalNode({
  service: WebCookie.Service,
  deps: [],
  layer: Layer.succeed(
    WebCookie.Service,
    WebCookie.Service.of({
      encrypt: () => Effect.succeed(Schema.decodeUnknownSync(WebCookie.Value)(Redacted.make("attempt"))),
      decrypt: (value) =>
        Effect.succeed(
          Redacted.value(value) === "attempt"
            ? attempt
            : Redacted.value(value) === "expired"
              ? expiredAttempt
              : loginSession,
        ),
    }),
  ),
})
const webProviderNode = makeGlobalNode({
  service: WebProvider.Service,
  deps: [],
  layer: Layer.succeed(
    WebProvider.Service,
    WebProvider.Service.of({
      start: () =>
        Effect.succeed({
          redirect: new URL("https://issuer.example/authorize"),
          provider: AuthSchema.Provider.make("test"),
          state: Redacted.make("expected-state"),
          verifier: Redacted.make("verifier"),
        }),
      complete: ({ code }) =>
        Redacted.value(code) === "successful-code"
          ? Effect.succeed(
              AuthSchema.Assertion.make({
                provider: AuthSchema.Provider.make("test"),
                subject: AuthSchema.Sub.make("routes-test"),
                verifiedEmail: AuthSchema.Email.make("routes-test@bymorning.ai"),
              }),
            )
          : Effect.fail(new WebProvider.ProviderError({ operation: "complete", reason: "exchange" })),
    }),
  ),
})

const withServer = async (
  run: (baseURL: string) => Promise<void>,
  appOrigin = "https://app.example",
  config?: { readonly trustedProxies?: ReadonlyArray<string> },
) => {
  budgetReserves = 0
  budgetReserve = () => Effect.succeed({ settle: () => Effect.void })
  providerInfos = []
  providerDiscovery = () => Effect.die(new Error("unused"))
  const process = Application.process(
    {
      appOrigin: new URL(appOrigin),
      cipher: Effect.runSync(
        Cipher.localBackend(Redacted.make(Buffer.alloc(32, 11).toString("base64url"))).pipe(
          Effect.provide(NodeCrypto.layer),
        ),
      ),
      ...(config?.trustedProxies === undefined ? {} : { trustedProxies: config.trustedProxies }),
    },
    { identity: webProviderNode },
  )
  const application = LayerNode.compile(process.root, {
    replacements: [
      process.workspaces.replace(workspaceMapNode),
      process.adapters.oauthCallback.replace(oauthCallbackNode),
      process.recovery.boot.replace(Layer.empty),
      // The stubbed Database only serves the Session middleware lookup; Audit
      // recording is replaced with a no-op so handler behavior stays observable.
      Audit.node.replace(
        Layer.succeed(
          Audit.Service,
          Audit.Service.of({
            record: (input) => Effect.sync(() => void auditRecords.push(input)),
            list: () => Effect.succeed({ data: [] }),
            prune: () => Effect.succeed({ deleted: 0 }),
          }),
        ),
      ),
      Database.node.replace(database),
      Storage.defaultNode.replace(storage),
      Storage.node.replace(storage),
      Provider.node.replace(providerLayer),
      Model.node.replace(Model.layer),
      WebCookie.node.replace(cookieNode),
      WebProvider.node.replace(webProviderNode),
      Account.node.replace(accountLayer),
      User.node.replace(userLayer),
      Auth.node.replace(authNode),
      AuthProvider.node.replace(authProviderNode),
      Installation.node.replace(installationNode),
      OAuth.node.replace(oauthNode),
      Budget.node.replace(
        Layer.succeed(
          Budget.Service,
          Budget.Service.of({
            reserve: (holders) => {
              budgetReserves++
              return budgetReserve(holders)
            },
            limit: () => Effect.void,
            status: () => Effect.succeed([]),
          }),
        ),
      ),
      LLMGateway.lease.replace(llmLeaseNode),
      LLMGateway.node.replace(llmGatewayNode),
    ],
  })
  const live = HttpRouter.serve(application, { disableListenLog: true, disableLogger: true }).pipe(
    Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0 })),
  )
  const runtime = ManagedRuntime.make(live)
  try {
    const server = await runtime.runPromise(HttpServer.HttpServer)
    await run(HttpServer.formatAddress(server.address).replace("0.0.0.0", "127.0.0.1"))
  } finally {
    await runtime.dispose()
  }
}

const getWithAuthority = (
  baseURL: string,
  authority: string,
  forwarded?: Readonly<{ readonly [key: string]: string }>,
): Promise<{
  readonly status: number
  readonly location: string | undefined
  readonly setCookies: ReadonlyArray<string>
}> =>
  new Promise((resolve, reject) => {
    const clientRequest = request(new URL("/auth/login", baseURL), {
      headers: { host: authority, ...forwarded },
    })
    clientRequest.on("response", (response) => {
      response.resume()
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          location: response.headers.location,
          setCookies: response.headers["set-cookie"] ?? [],
        }),
      )
    })
    clientRequest.on("error", reject)
    clientRequest.end()
  })

describe("HTTP authentication admission", () => {
  it("serves the Auth Provider inventory from the production root", () =>
    withServer(async (baseURL) => {
      const response = await fetch(`${baseURL}/auth/method`)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        state: "setup",
        callbackBase: "https://app.example/auth/callback",
        // The host default idle limit is advertised so clients can lock their display.
        idleTimeout: 900_000,
      })
    }))

  it("[SEC-HDR-01] sets baseline security headers on auth and API responses", () =>
    withServer(async (baseURL) => {
      const method = await fetch(`${baseURL}/auth/method`)
      expect(method.status).toBe(200)
      expect(method.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains")
      expect(method.headers.get("x-frame-options")).toBe("DENY")
      expect(method.headers.get("cross-origin-opener-policy")).toBe("same-origin")
      expect(method.headers.get("referrer-policy")).toBe("no-referrer")
      expect(method.headers.get("permissions-policy")).toContain("camera=()")
      expect(method.headers.get("permissions-policy")).toContain("microphone=()")
      expect(method.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      )
      expect(method.headers.get("cache-control")).toBe("no-store")
      expect(method.headers.get("x-content-type-options")).toBe("nosniff")

      const api = await fetch(`${baseURL}/api/providers`, { headers: { cookie: "__Host-bm_auth=abc" } })
      expect(api.status).toBe(200)
      // API JSON may carry CUI; it is never cached and never framed or scripted.
      expect(api.headers.get("cache-control")).toBe("no-store")
      expect(api.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      )
      expect(api.headers.get("x-frame-options")).toBe("DENY")
      expect(api.headers.get("cross-origin-opener-policy")).toBe("same-origin")
      expect(api.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
      expect(api.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains")
      expect(api.headers.get("x-content-type-options")).toBe("nosniff")
    }))

  it("[SEC-HDR-02] omits HSTS on plain-HTTP origins and keeps the integration callback page policy", () =>
    withServer(async (baseURL) => {
      const method = await fetch(`${baseURL}/auth/method`)
      expect(method.status).toBe(200)
      expect(method.headers.get("strict-transport-security")).toBeNull()
      expect(method.headers.get("x-frame-options")).toBe("DENY")
      expect(method.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      )

      const page = await fetch(`${baseURL}/auth/integration/callback/complete`)
      expect(page.status).toBe(200)
      // The script-free callback page keeps its stricter hashed-style policy.
      expect(page.headers.get("content-security-policy")).toContain("default-src 'none'")
      expect(page.headers.get("content-security-policy")).toContain("style-src 'sha256-")
      expect(page.headers.get("content-security-policy")).toContain("form-action 'none'")
      expect(page.headers.get("x-frame-options")).toBe("DENY")
      expect(page.headers.get("referrer-policy")).toBe("no-referrer")
      expect(page.headers.get("cache-control")).toBe("no-store")
      expect(page.headers.get("strict-transport-security")).toBeNull()
    }, "http://localhost:3000"))

  it("[SEC-CORS-01] admits only the Application origin for cross-origin requests", () =>
    withServer(async (baseURL) => {
      const preflight = (origin: string, requestHeaders?: string) =>
        fetch(`${baseURL}/api/providers`, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "GET",
            ...(requestHeaders === undefined ? {} : { "access-control-request-headers": requestHeaders }),
          },
        })

      const foreign = await preflight("https://evil.example")
      expect(foreign.status).toBe(204)
      expect(foreign.headers.get("access-control-allow-origin")).toBeNull()

      const own = await preflight("https://app.example", "content-type, authorization")
      expect(own.status).toBe(204)
      expect(own.headers.get("access-control-allow-origin")).toBe("https://app.example")
      const allowedHeaders = own.headers.get("access-control-allow-headers") ?? ""
      expect(allowedHeaders).toContain("authorization")
      // The Anthropic direct-browser-access header is not a supported gateway browser input.
      expect(allowedHeaders).not.toContain("anthropic-dangerous-direct-browser-access")

      // Development origins are not admitted when the Application is not loopback.
      const dev = await preflight("http://localhost:3000")
      expect(dev.headers.get("access-control-allow-origin")).toBeNull()
      const loopbackDev = await preflight("http://127.0.0.1:3000")
      expect(loopbackDev.headers.get("access-control-allow-origin")).toBeNull()
    }))

  it("[SEC-CORS-02] admits the Vite development origins only on a loopback Application origin", () =>
    withServer(async (baseURL) => {
      const dev = await fetch(`${baseURL}/api/providers`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:3000", "access-control-request-method": "GET" },
      })
      expect(dev.status).toBe(204)
      expect(dev.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
      const foreign = await fetch(`${baseURL}/api/providers`, {
        method: "OPTIONS",
        headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
      })
      expect(foreign.headers.get("access-control-allow-origin")).toBeNull()
    }, "http://localhost:3210"))

  it("[SEC-RATE-01] throttles public authentication endpoints per client and route", () =>
    withServer(async (baseURL) => {
      // Ten requests per minute per client and route; the eleventh is refused.
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await fetch(`${baseURL}/auth/login`, { redirect: "manual" })
        expect(response.status).toBe(302)
      }
      const limited = await fetch(`${baseURL}/auth/login`, { redirect: "manual" })
      expect(limited.status).toBe(429)
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0)
      expect(await limited.json()).toEqual({ error: "rate_limited" })
      expect(limited.headers.get("cache-control")).toBe("no-store")

      // A different route class keeps its own bucket.
      const logout = await fetch(`${baseURL}/auth/logout`, {
        method: "POST",
        headers: { origin: "https://app.example" },
      })
      expect(logout.status).toBe(204)
    }))

  it("[SEC-RATE-02] ignores X-Forwarded-For without trusted proxies and honors it with them", () =>
    withServer(async (baseURL) => {
      // The peer is not trusted, so a spoofed chain cannot reset the bucket.
      for (let attempt = 0; attempt < 10; attempt++) {
        await fetch(`${baseURL}/auth/login`, { redirect: "manual", headers: { "x-forwarded-for": "203.0.113.10" } })
      }
      const limited = await fetch(`${baseURL}/auth/login`, {
        redirect: "manual",
        headers: { "x-forwarded-for": "203.0.113.11" },
      })
      expect(limited.status).toBe(429)
    }).then(() =>
      withServer(
        async (baseURL) => {
          // With the peer trusted, each forwarded client gets its own bucket.
          for (let attempt = 0; attempt < 10; attempt++) {
            const response = await fetch(`${baseURL}/auth/login`, {
              redirect: "manual",
              headers: { "x-forwarded-for": "203.0.113.10" },
            })
            expect(response.status).toBe(302)
          }
          const limited = await fetch(`${baseURL}/auth/login`, {
            redirect: "manual",
            headers: { "x-forwarded-for": "203.0.113.10" },
          })
          expect(limited.status).toBe(429)
          const other = await fetch(`${baseURL}/auth/login`, {
            redirect: "manual",
            headers: { "x-forwarded-for": "203.0.113.11" },
          })
          expect(other.status).toBe(302)
          // A client cannot prepend fake hops to reset its bucket: the rightmost
          // untrusted entry (the one the trusted proxy appended) is the key.
          const spoofed = await fetch(`${baseURL}/auth/login`, {
            redirect: "manual",
            headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.10" },
          })
          expect(spoofed.status).toBe(429)
        },
        "https://app.example",
        { trustedProxies: ["127.0.0.1"] },
      ),
    ))

  it("[SEC-RATE-09] leaves the read-only sign-in method probe unthrottled", () =>
    withServer(async (baseURL) => {
      // The sign-in page reads the provider inventory on every visit; a shared
      // egress address must never take the page down with an exhausted bucket.
      for (let attempt = 0; attempt < 25; attempt++) {
        const response = await fetch(`${baseURL}/auth/method`)
        expect(response.status).toBe(200)
      }
    }))

  it("refuses a member permission-rule change", () =>
    withServer(async (baseURL) => {
      const response = await fetch(`${baseURL}/api/config?workspace=${workspaceID}`, {
        method: "PUT",
        headers: {
          cookie: "__Host-bm_auth=abc",
          origin: "https://app.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ permissions: [{ action: "read", resource: "*", effect: "deny" }] }),
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        _tag: "ForbiddenError",
        message: "Only Workspace administrators can change permissions",
      })
    }))

  it("refuses a member MCP activation change through generic Config", () =>
    withServer(async (baseURL) => {
      outboundConfigs.set(workspaceID, Schema.decodeUnknownSync(Info)({}))
      const response = await fetch(`${baseURL}/api/config?workspace=${workspaceID}`, {
        method: "PUT",
        headers: {
          cookie: "__Host-bm_auth=abc",
          origin: "https://app.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ mcp: { activation: { linear: "disabled" } } }),
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        _tag: "ForbiddenError",
        message: "Only Workspace administrators can change MCP activation",
      })
    }))

  it("shows shared MCP header values only to administrators and lets a member return a redacted document unchanged", () =>
    withServer(async (baseURL) => {
      const headers = {
        cookie: "__Host-bm_auth=abc",
        origin: "https://app.example",
        "content-type": "application/json",
      }
      const servers = {
        river: {
          type: "remote",
          url: "https://river.example/mcp",
          oauth: false,
          headers: { "X-Shared": "shared-secret", JiraToken: "${JIRA_TOKEN}" },
        },
      }
      const url = `${baseURL}/api/config?workspace=${workspaceID}`
      const seed = () => outboundConfigs.set(workspaceID, Schema.decodeUnknownSync(Info)({ mcp: { servers } }))
      try {
        seed()
        const memberRead = await fetch(url, { headers })
        const memberText = await memberRead.text()
        expect(memberText).not.toContain("shared-secret")
        expect(JSON.parse(memberText).mcp.servers.river.headers).toEqual({
          "X-Shared": "[redacted]",
          JiraToken: "${JIRA_TOKEN}",
        })

        // Returning the redacted document with a member-writable change is not an MCP edit.
        const document = JSON.parse(memberText)
        const roundTrip = await fetch(url, {
          method: "PUT",
          headers,
          body: JSON.stringify({ ...document, compaction: { auto: false } }),
        })
        expect(roundTrip.status).toBe(200)
        expect(JSON.stringify(await roundTrip.json())).not.toContain("shared-secret")
        expect(outboundConfigs.get(workspaceID)?.mcp?.servers?.river?.headers).toEqual({
          "X-Shared": "shared-secret",
          JiraToken: "${JIRA_TOKEN}",
        })

        // A real header edit by a member is still refused, and nothing is stored.
        seed()
        const edited = await fetch(url, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            mcp: { servers: { river: { ...servers.river, headers: { "X-Shared": "attacker", JiraToken: "${JIRA_TOKEN}" } } } },
          }),
        })
        expect(edited.status).toBe(403)
        expect(outboundConfigs.get(workspaceID)?.mcp?.servers?.river?.headers?.["X-Shared"]).toBe("shared-secret")

        // Administrators read the real values.
        selectedRole = "admin"
        const adminRead = (await (await fetch(url, { headers })).json()) as { mcp: { servers: { river: { headers: { [header: string]: string } } } } }
        expect(adminRead.mcp.servers.river.headers["X-Shared"]).toBe("shared-secret")
        const refreshed = await fetch(`${baseURL}/api/config/refresh?workspace=${workspaceID}`, {
          method: "POST",
          headers,
        })
        expect(((await refreshed.json()) as typeof adminRead).mcp.servers.river.headers["X-Shared"]).toBe("shared-secret")
        selectedRole = "member"
        const memberRefresh = await fetch(`${baseURL}/api/config/refresh?workspace=${workspaceID}`, {
          method: "POST",
          headers,
        })
        expect(JSON.stringify(await memberRefresh.json())).not.toContain("shared-secret")
      } finally {
        selectedRole = "member"
      }
    }))

  it("settles plugin reconciliation before returning a Config update", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        pluginFlushes = 0
        pluginReloads = 0
        const response = await fetch(`${baseURL}/api/config?workspace=${workspaceID}`, {
          method: "PUT",
          headers: {
            cookie: "__Host-bm_auth=abc",
            origin: "https://app.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({ plugins: ["-test.tool"] }),
        })

        expect(response.status).toBe(200)
        expect(pluginReloads).toBe(1)
      } finally {
        selectedRole = "member"
      }
    }))

  it("mounts GatewayApi separately and never falls back from a higher-priority credential", () =>
    withServer(async (baseURL) => {
      resolvedGatewayTokens.length = 0
      gatewayLists = 0
      const request = (headers: { readonly [key: string]: string }) =>
        fetch(`${baseURL}/inference/openai/v1/models`, { headers })

      expect(
        (await request({ authorization: "Bearer valid", "x-api-key": "other", "x-goog-api-key": "other" })).status,
      ).toBe(200)
      expect((await request({ "x-api-key": "valid", "x-goog-api-key": "other" })).status).toBe(200)
      expect((await request({ "x-goog-api-key": "valid" })).status).toBe(200)
      expect((await request({ authorization: "Bearer invalid", "x-api-key": "valid" })).status).toBe(401)
      expect((await request({ "x-api-key": "invalid", "x-goog-api-key": "valid" })).status).toBe(401)

      expect(resolvedGatewayTokens).toEqual(["valid", "valid", "valid", "invalid", "invalid"])
      expect(gatewayLists).toBe(3)
      expect(budgetReserves).toBe(0)

      const completion = await fetch(`${baseURL}/inference/openai/v1/chat/completions`, {
        method: "POST",
        headers: { authorization: "Bearer valid", "content-type": "application/json" },
        body: JSON.stringify({ model: "public-model", messages: [] }),
      })
      expect(completion.status).toBe(200)
      expect(budgetReserves).toBe(1)
    }))

  it("refuses an exhausted Spend Limit as a native 429 with retry-after", () =>
    withServer(async (baseURL) => {
      budgetReserve = () =>
        Effect.fail(new Budget.ExceededError({ holder: Actor.holder.workspace(workspaceID), retryAfter: 1500 }))
      const response = await fetch(`${baseURL}/inference/openai/v1/chat/completions`, {
        method: "POST",
        headers: { authorization: "Bearer valid", "content-type": "application/json" },
        body: JSON.stringify({ model: "public-model", messages: [] }),
      })
      expect(response.status).toBe(429)
      expect(response.headers.get("retry-after")).toBe("2")
      expect(await response.json()).toMatchObject({ error: { type: "rate_limit_error", code: null } })
    }))

  it("cancels GatewayApi work when the client disconnects before response headers", () =>
    withServer(async (baseURL) => {
      const started = await Effect.runPromise(Deferred.make<void>())
      const finalized = await Effect.runPromise(Deferred.make<void>())
      gatewayInvoke = () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(finalized, undefined)),
        )
      try {
        const url = new URL("/inference/openai/v1/chat/completions", baseURL)
        const client = request(url, {
          method: "POST",
          headers: { authorization: "Bearer valid", "content-type": "application/json" },
        })
        client.on("error", () => undefined)
        client.end(JSON.stringify({ model: "public-model", messages: [] }))
        await Effect.runPromise(Deferred.await(started))
        client.destroy()
        await Effect.runPromise(Deferred.await(finalized))
      } finally {
        gatewayInvoke = () => Effect.succeed(gatewayReply())
      }
    }))

  it("interrupts a committed GatewayApi response stream when the client disconnects", () =>
    withServer(async (baseURL) => {
      const finalized = await Effect.runPromise(Deferred.make<void>())
      gatewayInvoke = () =>
        Effect.succeed({
          status: 200,
          headers: Headers.fromInput({ "content-type": "text/event-stream" }),
          body: Stream.concat(
            Stream.make(new TextEncoder().encode("data: ready\n\n")),
            Stream.fromEffect(Effect.never.pipe(Effect.ensuring(Deferred.succeed(finalized, undefined)))),
          ),
        })
      try {
        const url = new URL("/inference/openai/v1/chat/completions", baseURL)
        const client = request(url, {
          method: "POST",
          headers: { authorization: "Bearer valid", "content-type": "application/json" },
        })
        client.on("error", () => undefined)
        client.end(JSON.stringify({ model: "public-model", stream: true, messages: [] }))
        await new Promise<void>((resolve, reject) => {
          client.once("response", (response) => response.once("data", () => resolve()))
          client.once("error", reject)
        })
        client.destroy()
        await Effect.runPromise(Deferred.await(finalized))
      } finally {
        gatewayInvoke = () => Effect.succeed(gatewayReply())
      }
    }))

  it("exposes the prepared direct and CodeMode Tools over raw MCP", () =>
    withServer(async (baseURL) => {
      pluginFlushes = 0
      const rpc = (body: object, authorization = "Bearer valid") =>
        fetch(`${baseURL}/mcp`, {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify(body),
        })
      const responseBody = async <T>(response: Response): Promise<T> => {
        const contentType = response.headers.get("content-type") ?? ""
        expect(contentType).toContain("text/event-stream")
        const event = (await response.text())
          .split("\n\n")
          .find((chunk) => chunk.split("\n").some((line) => line.startsWith("data:")))
        if (event === undefined) throw new Error("MCP response did not contain an SSE data event")
        return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(
          event
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice("data:".length).trimStart())
            .join("\n"),
        ) as T
      }

      const unauthenticated = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "")
      expect(unauthenticated.status).toBe(401)
      expect(unauthenticated.headers.get("www-authenticate")).toBe(
        'Bearer resource_metadata="https://app.example/.well-known/oauth-protected-resource/mcp"',
      )
      const inference = await fetch(`${baseURL}/inference/openai/v1/models`)
      expect(inference.status).toBe(401)
      expect(inference.headers.get("www-authenticate")).toBe("Bearer")

      const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })
      expect(listed.status).toBe(200)
      const listedBody = await responseBody<{
        readonly result: {
          readonly tools: ReadonlyArray<{
            readonly name: string
            readonly description?: string
            readonly inputSchema: { readonly type?: string }
          }>
        }
      }>(listed)
      expect(listedBody.result.tools.map((tool) => tool.name)).toContain("execute")
      expect(listedBody.result.tools.every((tool) => tool.inputSchema.type === "object")).toBe(true)

      const unavailable = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/list" }, "Bearer other")
      expect(unavailable.status).toBe(200)
      const unavailableBody = await responseBody<{
        readonly result: { readonly tools: ReadonlyArray<{ readonly name: string }> }
      }>(unavailable)
      expect(unavailableBody.result.tools.map((tool) => tool.name)).toEqual(["linear_search", "execute", "mcp_resume"])

      const direct = await responseBody<{ readonly error?: { readonly code: number } }>(
        await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "linear_search", arguments: {} } }),
      )
      expect(direct.error?.code).not.toBe(-32602)
      expect(pluginFlushes).toBe(3)
      expect(budgetReserves).toBe(0)
    }))

  it("renders member activation failure as a sanitized MCP availability response", () =>
    withServer(async (baseURL) => {
      pluginActivationFailure = true
      try {
        const response = await fetch(`${baseURL}/mcp`, {
          method: "POST",
          headers: {
            authorization: "Bearer valid",
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        })
        expect(response.status).toBe(503)
        const body = await response.text()
        expect(JSON.parse(body)).toEqual({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32003, message: "Service unavailable" },
        })
        expect(body).not.toContain("sensitive activation detail")
      } finally {
        pluginActivationFailure = false
      }
    }))

  it("saves member-value headers and discards saved values when a server moves or is removed", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        outboundConfigs.clear()
        outboundOverrides.clear()
        discardedIntegrations = []
        valuesConnection = undefined
        outboundConfigs.set(workspaceID, Schema.decodeUnknownSync(Info)({}))
        const headers = { cookie: "__Host-bm_auth=abc", "content-type": "application/json", origin: "https://app.example" }
        const put = (body: unknown) =>
          fetch(`${baseURL}/api/mcp/server/river?workspace=${workspaceID}`, {
            method: "PUT",
            headers,
            body: JSON.stringify(body),
          })
        const memberHeaders = { JiraToken: "${JIRA_TOKEN}", UserEmail: "${member.email}" }

        // OAuth and member values are mutually exclusive.
        const combined = await put({ url: "https://river.example/mcp", headers: memberHeaders })
        expect(combined.status).toBe(400)
        expect(await combined.text()).toContain("cannot combine OAuth")

        expect((await put({ url: "https://river.example/mcp", oauth: false, headers: memberHeaders })).status).toBe(200)
        expect(outboundConfigs.get(workspaceID)?.mcp?.servers?.river).toEqual({
          type: "remote",
          url: "https://river.example/mcp",
          oauth: false,
          headers: memberHeaders,
        })
        expect(discardedIntegrations).toEqual([])

        // Values were entrusted to the previous address: moving the server discards them.
        expect((await put({ url: "https://moved.example/mcp", oauth: false, headers: memberHeaders })).status).toBe(200)
        expect(discardedIntegrations).toEqual([Mcp.identity("river", "https://river.example/mcp")])

        expect(
          (await fetch(`${baseURL}/api/mcp/server/river?workspace=${workspaceID}`, { method: "DELETE", headers })).status,
        ).toBeLessThan(300)
        expect(discardedIntegrations).toEqual([
          Mcp.identity("river", "https://river.example/mcp"),
          Mcp.identity("river", "https://moved.example/mcp"),
        ])
      } finally {
        selectedRole = "member"
      }
    }))

  it("lets administrators see which members hold values for a server, and no one else", () =>
    withServer(async (baseURL) => {
      const headers = { cookie: "__Host-bm_auth=abc", origin: "https://app.example", "content-type": "application/json" }
      const url = `${baseURL}/api/mcp/server/river/member?workspace=${workspaceID}`
      const memberHeaders = { JiraToken: "${JIRA_TOKEN}" }
      try {
        outboundConfigs.set(
          workspaceID,
          Schema.decodeUnknownSync(Info)({
            mcp: {
              servers: {
                river: { type: "remote", url: "https://river.example/mcp", oauth: false, headers: memberHeaders },
                plain: { type: "remote", url: "https://plain.example/mcp" },
              },
            },
          }),
        )
        connectedMembers = [{ userID: actor.properties.userID, updated: new Date("2026-10-21T12:00:00.000Z") }]

        // A member cannot list who has connected.
        expect((await fetch(url, { headers })).status).toBe(403)

        selectedRole = "admin"
        const listed = (await (await fetch(url, { headers })).json()) as Array<{ email: string; connected: boolean; updated?: string }>
        expect(listed).toEqual([
          {
            userID: actor.properties.userID,
            email: "member@example.com",
            connected: true,
            updated: "2026-10-21T12:00:00.000Z",
          },
        ])
        connectedMembers = []
        expect(await (await fetch(url, { headers })).json()).toEqual([
          { userID: actor.properties.userID, email: "member@example.com", connected: false },
        ])
        // A server that asks nobody for their own values has nothing to report.
        const plain = await fetch(`${baseURL}/api/mcp/server/plain/member?workspace=${workspaceID}`, { headers })
        expect(await plain.json()).toEqual([])
        expect((await fetch(`${baseURL}/api/mcp/server/missing/member?workspace=${workspaceID}`, { headers })).status).toBe(404)
      } finally {
        selectedRole = "member"
      }
    }))

  it("saves the signed-in member's own values and refuses invalid ones", () =>
    withServer(async (baseURL) => {
      valuesConnection = undefined
      const headers = { cookie: "__Host-bm_auth=abc", "content-type": "application/json", origin: "https://app.example" }
      const integrationID = Mcp.identity("river", "https://river.example/mcp")
      const saved = await fetch(`${baseURL}/api/integration/${integrationID}/connect/values?workspace=${workspaceID}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ values: { JIRA_TOKEN: "member-secret" } }),
      })
      expect(saved.status).toBe(204)
      expect(valuesConnection).toEqual({
        integrationID: Integration.ID.make(integrationID),
        values: { JIRA_TOKEN: "member-secret" },
        label: undefined,
      })
      const refused = await fetch(`${baseURL}/api/integration/${integrationID}/connect/values?workspace=${workspaceID}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ values: { BAD: "x" } }),
      })
      expect(refused.status).toBe(400)
      const body = await refused.text()
      expect(body).toContain("Unknown value: BAD")
      expect(body).not.toContain("member-secret")
    }))

  it("persists and controls sanitized outbound MCP servers per workspace", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        outboundConfigs.clear()
        outboundOverrides.clear()
        outboundConfigs.set(
          workspaceID,
          Schema.decodeUnknownSync(Info)({
            permissions: [{ action: "read", resource: "*", effect: "deny" }],
          }),
        )
        const headers = {
          cookie: "__Host-bm_auth=abc",
          "content-type": "application/json",
          origin: "https://app.example",
        }
        const put = await fetch(`${baseURL}/api/mcp/server/linear?workspace=${workspaceID}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            url: "https://mcp.linear.app/mcp",
            oauth: { client_secret: "must-not-persist" },
            headers: { authorization: "must-not-appear" },
          }),
        })
        expect(put.status).toBe(200)
        expect(outboundConfigs.get(workspaceID)?.permissions).toEqual([
          { action: "read", resource: "*", effect: "deny" },
        ])
        // Headers are Workspace configuration; they never appear in server or Tool listings.
        expect(outboundConfigs.get(workspaceID)?.mcp?.servers?.linear).toEqual({
          type: "remote",
          url: "https://mcp.linear.app/mcp",
          oauth: {},
          headers: { authorization: "must-not-appear" },
        })
        const listed = await fetch(`${baseURL}/api/mcp/server?workspace=${workspaceID}`, { headers })
        const listedBody = await listed.text()
        expect(listedBody).not.toContain("must-not-persist")
        expect(listedBody).not.toContain("must-not-appear")
        expect(JSON.parse(listedBody)).toEqual([
          {
            name: "linear",
            enabled: true,
            status: "connected",
            integrationID: Mcp.identity("linear", "https://mcp.linear.app/mcp"),
          },
        ])
        const tools = await fetch(`${baseURL}/api/mcp/tool?workspace=${workspaceID}`, { headers })
        expect(tools.status).toBe(200)
        await expect(tools.json()).resolves.toEqual([
          { server: "linear", name: "search", action: "linear_search", description: "Search the remote service" },
        ])
        await expect(
          (await fetch(`${baseURL}/api/mcp/server?workspace=${otherWorkspaceID}`, { headers })).json(),
        ).resolves.toEqual([])

        const disabled = await fetch(`${baseURL}/api/mcp/server/linear/activation?workspace=${workspaceID}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ enabled: false }),
        })
        expect(disabled.status).toBe(200)
        await expect(disabled.json()).resolves.toMatchObject({ name: "linear", enabled: false, status: "disabled" })
        expect(outboundConfigs.get(workspaceID)?.mcp?.activation?.linear).toBe("disabled")
        expect(
          (
            await fetch(`${baseURL}/api/mcp/server/linear/connect?workspace=${workspaceID}`, {
              method: "POST",
              headers,
            })
          ).status,
        ).toBe(404)
        expect(
          (
            await fetch(`${baseURL}/api/mcp/server/linear/activation?workspace=${workspaceID}`, {
              method: "PUT",
              headers,
              body: JSON.stringify({ enabled: true }),
            })
          ).status,
        ).toBe(200)

        expect(
          (
            await fetch(`${baseURL}/api/mcp/server/linear/disconnect?workspace=${workspaceID}`, {
              method: "POST",
              headers,
            })
          ).status,
        ).toBe(200)
        expect(
          await (await fetch(`${baseURL}/api/mcp/server?workspace=${workspaceID}`, { headers })).json(),
        ).toMatchObject([{ name: "linear", status: "disabled" }])
        await expect(
          (
            await fetch(`${baseURL}/api/mcp/server/linear/test?workspace=${workspaceID}`, { method: "POST", headers })
          ).json(),
        ).resolves.toEqual({ ok: false, error: "Connection failed" })
        expect(
          (
            await fetch(`${baseURL}/api/mcp/server/linear/connect?workspace=${workspaceID}`, {
              method: "POST",
              headers,
            })
          ).status,
        ).toBe(200)
        await expect(
          (
            await fetch(`${baseURL}/api/mcp/server/linear/test?workspace=${workspaceID}`, { method: "POST", headers })
          ).json(),
        ).resolves.toEqual({ ok: true })
        expect(
          (await fetch(`${baseURL}/api/mcp/server/unknown/test?workspace=${workspaceID}`, { method: "POST", headers }))
            .status,
        ).toBe(404)
        expect(
          (await fetch(`${baseURL}/api/mcp/server/linear?workspace=${workspaceID}`, { method: "DELETE", headers }))
            .status,
        ).toBe(200)
        expect(
          (await fetch(`${baseURL}/api/mcp/server/linear?workspace=${workspaceID}`, { method: "DELETE", headers }))
            .status,
        ).toBe(404)
        expect(
          (
            await fetch(`${baseURL}/api/mcp/server/not%20valid/connect?workspace=${workspaceID}`, {
              method: "POST",
              headers,
            })
          ).status,
        ).toBe(400)
        expect(
          (
            await fetch(`${baseURL}/api/mcp/server/not%20valid/test?workspace=${workspaceID}`, {
              method: "POST",
              headers,
            })
          ).status,
        ).toBe(400)

        expect(
          (
            await fetch(`${baseURL}/api/mcp/server/tool?workspace=${workspaceID}`, {
              method: "PUT",
              headers,
              body: JSON.stringify({ url: "https://tool.example/mcp", oauth: false }),
            })
          ).status,
        ).toBe(200)
        await expect(
          (await fetch(`${baseURL}/api/mcp/server?workspace=${workspaceID}`, { headers })).json(),
        ).resolves.toMatchObject([{ name: "tool", status: "connected" }])
      } finally {
        selectedRole = "member"
      }
    }))

  it("lists Workspace Tool permissions and refuses member updates", () =>
    withServer(async (baseURL) => {
      const headers = {
        cookie: "__Host-bm_auth=abc",
        "content-type": "application/json",
        origin: "https://app.example",
      }
      outboundConfigs.set(
        workspaceID,
        Schema.decodeUnknownSync(Info)({
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "read", resource: "private", effect: "deny" },
            { action: "read", resource: "*", effect: "deny" },
            { action: "unsubmitted", resource: "*", effect: "ask" },
          ],
        }),
      )

      const listed = await fetch(`${baseURL}/api/permission/tool?workspace=${workspaceID}`, { headers })
      expect(listed.status).toBe(200)
      expect(await listed.json()).toEqual([
        {
          name: "linear_tool",
          action: "linear_tool",
          description: "Search Linear",
          effect: "allow",
        },
        { name: "read", action: "read", description: "Read workspace files", effect: "deny" },
      ])

      const updated = await fetch(`${baseURL}/api/permission/tool?workspace=${workspaceID}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          tools: [
            { action: "read", effect: "allow" },
            { action: "linear_tool", effect: "deny" },
          ],
        }),
      })
      expect(updated.status).toBe(400)
      expect(await updated.json()).toEqual({
        _tag: "Protocol.InputError",
        error: "Only Workspace administrators can change permissions",
      })
      expect(outboundConfigs.get(workspaceID)?.permissions).toEqual([
        { action: "*", resource: "*", effect: "allow" },
        { action: "read", resource: "private", effect: "deny" },
        { action: "read", resource: "*", effect: "deny" },
        { action: "unsubmitted", resource: "*", effect: "ask" },
      ])

      const unknown = await fetch(`${baseURL}/api/permission/tool?workspace=${workspaceID}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ tools: [{ action: "missing", effect: "allow" }] }),
      })
      expect(unknown.status).toBe(400)
      expect(await unknown.json()).toEqual({
        _tag: "Protocol.InputError",
        error: "Only Workspace administrators can change permissions",
      })

      expect((await fetch(`${baseURL}/api/mcp/catalog?workspace=${workspaceID}`, { headers })).status).toBe(404)
      expect(
        (
          await fetch(`${baseURL}/api/mcp/tool?workspace=${workspaceID}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ tools: [] }),
          })
        ).status,
      ).toBe(404)
    }))

  it("sets one versioned hardened attempt and ignores proxy authority", () =>
    withServer(async (baseURL) => {
      startedLogins = 0
      const login = await getWithAuthority(baseURL, "localhost:3000", {
        forwarded: "host=evil.example;proto=https",
        "x-forwarded-host": "evil.example",
      })
      expect(login.status).toBe(302)
      expect(new URL(login.location ?? "invalid:").origin).toBe("https://issuer.example")
      expect(login.setCookies.filter((value) => value.startsWith("__Secure-bm_auth_attempt_v1=attempt;"))).toEqual([
        "__Secure-bm_auth_attempt_v1=attempt; Max-Age=600; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax",
      ])
      expect(startedLogins).toBe(1)
    }, "http://localhost:3000"))

  it("does not expose direct AI ingress", () =>
    withServer(async (baseURL) => {
      const response = await fetch(`${baseURL}/ai/v1/responses`, {
        method: "POST",
        headers: { authorization: "Bearer invalid", "content-type": "application/json" },
        body: JSON.stringify({ model: "owned" }),
      })
      expect(response.status).toBe(404)
    }))

  it("rejects duplicate reserved Account cookies", () =>
    withServer(async (baseURL) => {
      const response = await fetch(`${baseURL}/api/providers`, {
        headers: { cookie: "__Host-bm_auth=abc; __Host-bm_auth=def" },
      })
      expect(response.status).toBe(401)
    }))

  it("authorizes a stream before committing event-stream headers", () =>
    withServer(async (baseURL) => {
      const response = await fetch(`${baseURL}/api/event`)
      expect(response.status).toBe(401)
      expect(response.headers.get("content-type") ?? "").not.toContain("text/event-stream")
    }))

  it("does not expose the removed Session event endpoint", () =>
    withServer(async (baseURL) => {
      const sessionID = SessionSchema.ID.make("00000000-0000-4000-8000-000000000809")
      const response = await fetch(`${baseURL}/api/event/session?workspace=${workspaceID}&sessionID=${sessionID}`, {
        headers: { cookie: "__Host-bm_auth=abc" },
      })

      expect(response.status).toBe(404)
      expect(response.headers.get("content-type") ?? "").not.toContain("text/event-stream")
    }))

  it("rejects unsafe Workspace operations without the exact trusted Origin", () =>
    withServer(async (baseURL) => {
      const response = await fetch(`${baseURL}/api/session`, {
        method: "POST",
        headers: { cookie: "__Host-bm_auth=abc", origin: "https://evil.example" },
      })
      expect(response.status).toBe(403)
    }))

  it("binds the stable default or exact Workspace before invoking a resource handler", () =>
    withServer(async (baseURL) => {
      selectedWorkspace = Workspace.ID.make("wrk_previous")
      boundCalls = 0
      const cookie = { cookie: "__Host-bm_auth=abc" }
      const providers = await fetch(`${baseURL}/api/providers`, { headers: cookie })
      expect(providers.status).toBe(200)
      expect(await providers.json()).toEqual([providerDirectoryEntry])
      expect(selectedWorkspace).toBeUndefined()
      expect(boundCalls).toBe(1)

      const models = await fetch(`${baseURL}/api/models`, { headers: cookie })
      expect(models.status).toBe(200)
      const discovered = Schema.decodeUnknownSync(Schema.Array(ModelSchema.Management))(await models.json())
      expect(discovered[0]?.info).toHaveProperty("provider", ProviderSchema.Bymorning)
      expect(discovered[0]?.info).not.toHaveProperty("providerID")

      expect((await fetch(`${baseURL}/api/providers?workspace=${workspaceID}`, { headers: cookie })).status).toBe(200)
      expect(selectedWorkspace).toBe(workspaceID)
      expect(boundCalls).toBe(1)

      const isolated = await fetch(`${baseURL}/api/providers?workspace=${otherWorkspaceID}`, { headers: cookie })
      expect(await isolated.json()).toEqual([{ ...providerDirectoryEntry, connected: true, connectionCount: 1 }])

      selectedWorkspace = Workspace.ID.make("wrk_previous")
      expect((await fetch(`${baseURL}/api/session?workspace=${workspaceID}`, { headers: cookie })).status).toBe(200)
      expect(selectedWorkspace).toBe(workspaceID)

      expect((await fetch(`${baseURL}/api/providers?workspace=bad`, { headers: cookie })).status).toBe(400)
      expect(boundCalls).toBe(2)
    }))

  it("manages model policy with validation and Workspace scoping", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        modelPolicyByWorkspace.clear()
        const headers = {
          cookie: "__Host-bm_auth=abc",
          origin: "https://app.example",
          "content-type": "application/json",
        }
        const management = await fetch(`${baseURL}/api/models?workspace=${workspaceID}`, { headers })
        expect(management.status).toBe(200)
        const models = Schema.decodeUnknownSync(Schema.Array(ModelSchema.Management))(await management.json())
        const selected = models[0]!.info

        const disabled = await fetch(`${baseURL}/api/models/toggle?workspace=${workspaceID}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ provider: selected.provider, id: selected.id, enabled: false }),
        })
        expect(disabled.status).toBe(200)
        expect(Schema.decodeUnknownSync(Schema.Array(ModelSchema.Management))(await disabled.json())[0]?.enabled).toBe(
          false,
        )
        const listedAfterDisable = await fetch(`${baseURL}/api/models?workspace=${workspaceID}`, { headers })
        expect(
          Schema.decodeUnknownSync(Schema.Array(ModelSchema.Management))(await listedAfterDisable.json())[0]?.enabled,
        ).toBe(false)

        const unavailableDefault = await fetch(`${baseURL}/api/models/default?workspace=${workspaceID}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ provider: selected.provider, id: selected.id }),
        })
        expect(unavailableDefault.status).toBe(400)
        expect(await unavailableDefault.json()).toEqual({ _tag: "Protocol.InputError", error: "Model is not usable" })

        const missing = await fetch(`${baseURL}/api/models/toggle?workspace=${workspaceID}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ provider: selected.provider, id: "missing", enabled: false }),
        })
        expect(missing.status).toBe(400)

        const other = await fetch(`${baseURL}/api/models?workspace=${otherWorkspaceID}`, { headers })
        expect(other.status).toBe(200)
        expect(Schema.decodeUnknownSync(Schema.Array(ModelSchema.Management))(await other.json())[0]?.enabled).toBe(
          true,
        )

        await fetch(`${baseURL}/api/models/toggle?workspace=${workspaceID}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ provider: selected.provider, id: selected.id, enabled: true }),
        })
        const preferred = await fetch(`${baseURL}/api/models/default?workspace=${workspaceID}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ provider: selected.provider, id: selected.id }),
        })
        expect(preferred.status).toBe(200)
        expect(
          Schema.decodeUnknownSync(Schema.Array(ModelSchema.Management))(await preferred.json())[0]?.isPreferredDefault,
        ).toBe(true)
      } finally {
        selectedRole = "member"
      }
    }))

  it("lists only memberships from the authenticated Workspace selection", () =>
    withServer(async (baseURL) => {
      const headers = { cookie: "__Host-bm_auth=abc" }
      listedWorkspace = undefined

      const response = await fetch(`${baseURL}/api/users?workspace=${otherWorkspaceID}`, { headers })

      expect(response.status).toBe(200)
      expect(listedWorkspace).toBe(otherWorkspaceID)
      expect(await response.json()).toEqual({
        role: "member",
        members: [{ id: actor.properties.userID, email: "member@example.com", role: "member", status: "active" }],
      })
      expect((await fetch(`${baseURL}/api/users?workspace=${workspaceID}`)).status).toBe(401)
    }))

  it("[SEC-INVITE-01] invites a member in the authenticated Workspace selection when an enabled Auth Provider admits the domain", () =>
    withServer(async (baseURL) => {
      providerInfos = [admittedProvider(["bymorning.ai"])]
      invitation = undefined
      invitationFailure = undefined
      selectedRole = "admin"
      const response = await fetch(`${baseURL}/api/users?workspace=${otherWorkspaceID}`, {
        method: "POST",
        headers: { cookie: "__Host-bm_auth=abc", "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify({ email: " Invitee@ByMorning.AI ", role: "admin" }),
      })

      expect(response.status).toBe(200)
      expect(invitation).toEqual({
        workspaceID: otherWorkspaceID,
        input: { email: "invitee@bymorning.ai", role: "admin" },
      })
      expect(await response.json()).toEqual({
        id: expect.stringMatching(/^usr_/),
        email: "invitee@bymorning.ai",
        role: "admin",
        status: "pending",
      })
      selectedRole = "member"
    }))

  it("[SEC-INVITE-02] maps invitation authorization and persistence failures without a conflict response", () =>
    withServer(async (baseURL) => {
      providerInfos = [admittedProvider(["bymorning.ai"])]
      selectedRole = "admin"
      const request = (email = "invitee@bymorning.ai") =>
        fetch(`${baseURL}/api/users?workspace=${workspaceID}`, {
          method: "POST",
          headers: { cookie: "__Host-bm_auth=abc", "content-type": "application/json", origin: "https://app.example" },
          body: JSON.stringify({ email, role: "member" }),
        })

      expect((await request("invitee@example.com")).status).toBe(403)
      invitationFailure = "unavailable"
      expect((await request()).status).toBe(503)
      invitationFailure = undefined
      selectedRole = "member"
    }))

  it("[SEC-INVITE-03] refuses invitation domains no enabled Auth Provider admits", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      const invite = (email: string) =>
        fetch(`${baseURL}/api/users?workspace=${workspaceID}`, {
          method: "POST",
          headers: { cookie: "__Host-bm_auth=abc", "content-type": "application/json", origin: "https://app.example" },
          body: JSON.stringify({ email, role: "member" }),
        })

      // No Auth Provider is configured at all: no domain is admitted.
      const none = await invite("invitee@bymorning.ai")
      expect(none.status).toBe(403)
      expect(JSON.stringify(await none.json())).toContain("Ask an Installation admin")

      // A disabled Auth Provider does not admit its domains.
      providerInfos = [admittedProvider(["bymorning.ai"], "disabled")]
      expect((await invite("invitee@bymorning.ai")).status).toBe(403)

      // Subdomains and suffix lookalikes of an admitted domain stay refused.
      providerInfos = [admittedProvider(["bymorning.ai"])]
      const subdomain = await invite("invitee@sub.bymorning.ai")
      expect(subdomain.status).toBe(403)
      // The refusal gives guidance only; it never discloses the admitted domains (other tenants' Auth Providers).
      const refusal = JSON.stringify(await subdomain.json())
      expect(refusal).toContain("Ask an Installation admin")
      expect(refusal).not.toContain("Admitted domains")
      expect(refusal).not.toContain("bymorning.ai")
      expect((await invite("invitee@bymorning.ai.evil.test")).status).toBe(403)
      expect((await invite("invitee@bymorning.ai")).status).toBe(200)
      selectedRole = "member"
    }))

  it("returns the bound process-local active Session snapshot", () =>
    withServer(async (baseURL) => {
      const sessionA = SessionSchema.ID.make("00000000-0000-4000-8000-000000000601")
      const sessionB = SessionSchema.ID.make("00000000-0000-4000-8000-000000000602")
      const headers = { cookie: "__Host-bm_auth=abc" }
      activeCalls = 0
      activeSessions.clear()

      const empty = await fetch(`${baseURL}/api/session/active?workspace=${workspaceID}`, { headers })
      expect(empty.status).toBe(200)
      expect(await empty.json()).toEqual({})

      activeSessions.set(workspaceID, new Set([sessionA]))
      activeSessions.set(otherWorkspaceID, new Set([sessionB]))
      const workspaceA = await fetch(`${baseURL}/api/session/active?workspace=${workspaceID}`, { headers })
      expect(workspaceA.status).toBe(200)
      expect(await workspaceA.json()).toEqual({ [sessionA]: { type: "running" } })
      const workspaceB = await fetch(`${baseURL}/api/session/active?workspace=${otherWorkspaceID}`, { headers })
      expect(workspaceB.status).toBe(200)
      expect(await workspaceB.json()).toEqual({ [sessionB]: { type: "running" } })
      expect(activeCalls).toBe(3)

      expect((await fetch(`${baseURL}/api/session/active?workspace=bad`, { headers })).status).toBe(400)
      expect((await fetch(`${baseURL}/api/session/active`)).status).toBe(401)
      expect(activeCalls).toBe(3)
    }))

  it("waits for plugin activation before Integration and Credential operations", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        pluginFlushes = 0
        removedCredential = undefined
        const authenticated = { cookie: "__Host-bm_auth=abc" }
        const integrationResponse = await fetch(`${baseURL}/api/integration?workspace=${workspaceID}`, {
          headers: authenticated,
        })
        expect(integrationResponse.status).toBe(200)
        expect(pluginFlushes).toBe(1)

        const credentialID = Credential.ID.create()
        const credentialResponse = await fetch(`${baseURL}/api/credential/${credentialID}?workspace=${workspaceID}`, {
          method: "DELETE",
          headers: { ...authenticated, origin: "https://app.example" },
        })
        expect(credentialResponse.status).toBe(204)
        expect(pluginFlushes).toBe(2)
        expect(removedCredential).toBe(credentialID)

        const renameResponse = await fetch(`${baseURL}/api/credential/${credentialID}?workspace=${workspaceID}`, {
          method: "PATCH",
          headers: { ...authenticated, origin: "https://app.example", "content-type": "application/json" },
          body: JSON.stringify({ label: "Team" }),
        })
        expect(renameResponse.status).toBe(204)
        expect(updatedCredential).toEqual({ id: credentialID, label: "Team" })

        const activateResponse = await fetch(
          `${baseURL}/api/credential/${credentialID}/activate?workspace=${workspaceID}`,
          { method: "POST", headers: { ...authenticated, origin: "https://app.example" } },
        )
        expect(activateResponse.status).toBe(204)
        expect(activatedCredential).toBe(credentialID)

        const keyResponse = await fetch(`${baseURL}/api/integration/exa/connect/key?workspace=${workspaceID}`, {
          method: "POST",
          headers: { ...authenticated, origin: "https://app.example", "content-type": "application/json" },
          body: JSON.stringify({ key: "secret", answer: { region: "eu", retries: 2, enabled: false } }),
        })
        expect(keyResponse.status).toBe(204)
        expect(keyConnection).toEqual({
          integrationID: Integration.ID.make("exa"),
          key: "secret",
          answer: { region: "eu", retries: 2, enabled: false },
        })
      } finally {
        selectedRole = "member"
      }
    }))

  it("redacts failed attempt status while preserving pending command progress", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        pluginFlushes = 0
        oauthFailure = undefined
        commandFailure = false
        oauthConnection = undefined
        oauthCompletion = undefined
        cancelledOAuth = undefined
        commandConnection = undefined
        cancelledCommand = undefined
        oauthAttemptStatus = {
          status: "failed",
          message: "code=oauth-code token=oauth-token answer=oauth-answer",
          time: { created: 1, expires: 2 },
        }
        commandAttemptStatus = {
          status: "pending",
          message: "checking...\n  exact stderr\n",
          time: { created: 1, expires: 2 },
        }
        const integrationID = Integration.ID.make("github")
        const methodID = Integration.MethodID.make("device")
        const authenticated = { cookie: "__Host-bm_auth=abc" }
        const mutable = {
          ...authenticated,
          origin: "https://app.example",
          "content-type": "application/json",
        }

        const oauth = await fetch(
          `${baseURL}/api/integration/${integrationID}/connect/oauth?workspace=${workspaceID}`,
          {
            method: "POST",
            headers: mutable,
            body: JSON.stringify({ methodID, answer: { region: "eu" }, label: "Work" }),
          },
        )
        expect(oauth.status).toBe(200)
        expect(await oauth.json()).toEqual({
          attemptID: "con_oauth",
          url: "https://example.com/authorize",
          instructions: "Continue in your browser",
          mode: "code",
          time: { created: 1, expires: 2 },
        })
        expect(oauthConnection).toEqual({ integrationID, methodID, answer: { region: "eu" }, label: "Work" })

        const oauthStatus = await fetch(
          `${baseURL}/api/integration/${integrationID}/connect/oauth/con_oauth?workspace=${workspaceID}`,
          { headers: authenticated },
        )
        const oauthStatusBody = await oauthStatus.text()
        expect(JSON.parse(oauthStatusBody)).toEqual({
          status: "failed",
          message: "Authentication failed",
          time: { created: 1, expires: 2 },
        })
        expect(oauthStatusBody).not.toContain("oauth-code")
        expect(oauthStatusBody).not.toContain("oauth-token")
        expect(oauthStatusBody).not.toContain("oauth-answer")

        for (const status of ["pending", "complete", "expired"] as const) {
          oauthAttemptStatus = { status, time: { created: 3, expires: 4 } }
          const response = await fetch(
            `${baseURL}/api/integration/${integrationID}/connect/oauth/con_oauth?workspace=${workspaceID}`,
            { headers: authenticated },
          )
          expect(await response.json()).toEqual(oauthAttemptStatus)
        }

        const complete = await fetch(
          `${baseURL}/api/integration/${integrationID}/connect/oauth/con_oauth/complete?workspace=${workspaceID}`,
          { method: "POST", headers: mutable, body: JSON.stringify({ code: "answer" }) },
        )
        expect(complete.status).toBe(204)
        expect(oauthCompletion).toEqual({ integrationID, attemptID: "con_oauth", code: "answer" })

        const cancelOAuth = await fetch(
          `${baseURL}/api/integration/${integrationID}/connect/oauth/con_oauth?workspace=${workspaceID}`,
          { method: "DELETE", headers: mutable },
        )
        expect(cancelOAuth.status).toBe(204)
        expect(cancelledOAuth).toEqual({ integrationID, attemptID: "con_oauth" })

        const command = await fetch(
          `${baseURL}/api/integration/${integrationID}/connect/command?workspace=${workspaceID}`,
          {
            method: "POST",
            headers: mutable,
            body: JSON.stringify({ methodID, label: "CLI", command: ["/tmp/owned"] }),
          },
        )
        expect(command.status).toBe(200)
        expect(await command.json()).toEqual({ attemptID: "con_command", time: { created: 1, expires: 2 } })
        expect(commandConnection).toEqual({ integrationID, methodID, label: "CLI" })

        const commandStatus = await fetch(
          `${baseURL}/api/integration/${integrationID}/connect/command/con_command?workspace=${workspaceID}`,
          { headers: authenticated },
        )
        expect(await commandStatus.json()).toEqual(commandAttemptStatus)

        commandAttemptStatus = {
          status: "failed",
          message: "stdout=command-output persistence=database-callback-cause",
          time: { created: 1, expires: 2 },
        }
        const failedCommandStatus = await fetch(
          `${baseURL}/api/integration/${integrationID}/connect/command/con_command?workspace=${workspaceID}`,
          { headers: authenticated },
        )
        const failedCommandStatusBody = await failedCommandStatus.text()
        expect(JSON.parse(failedCommandStatusBody)).toEqual({
          status: "failed",
          message: "Command failed",
          time: { created: 1, expires: 2 },
        })
        expect(failedCommandStatusBody).not.toContain("command-output")
        expect(failedCommandStatusBody).not.toContain("database-callback-cause")

        for (const status of ["complete", "expired"] as const) {
          commandAttemptStatus = { status, time: { created: 3, expires: 4 } }
          const response = await fetch(
            `${baseURL}/api/integration/${integrationID}/connect/command/con_command?workspace=${workspaceID}`,
            { headers: authenticated },
          )
          expect(await response.json()).toEqual(commandAttemptStatus)
        }

        const cancelCommand = await fetch(
          `${baseURL}/api/integration/${integrationID}/connect/command/con_command?workspace=${workspaceID}`,
          { method: "DELETE", headers: mutable },
        )
        expect(cancelCommand.status).toBe(204)
        expect(cancelledCommand).toEqual({ integrationID, attemptID: "con_command" })
        expect(pluginFlushes).toBe(13)
      } finally {
        selectedRole = "member"
      }
    }))

  it("configures and removes a workspace OAuth client as a Workspace administrator", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        clientConfigurationFailure = undefined
        clientPut = undefined
        clientRemove = undefined
        const integrationID = Integration.ID.make("mail")
        const methodID = Integration.MethodID.make("oauth")
        const headers = {
          cookie: "__Host-bm_auth=abc",
          origin: "https://app.example",
          "content-type": "application/json",
        }
        const url = `${baseURL}/api/integration/${integrationID}/oauth/${methodID}/client?workspace=${workspaceID}`
        const put = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ answer: { client_id: "id" } }) })
        expect(put.status).toBe(204)
        expect(clientPut).toEqual({ integrationID, methodID, answer: { client_id: "id" } })
        const remove = await fetch(url, { method: "DELETE", headers })
        expect(remove.status).toBe(204)
        expect(clientRemove).toEqual({ integrationID, methodID })
      } finally {
        selectedRole = "member"
      }
    }))

  it("maps OAuth client configuration failures to safe responses", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        const integrationID = Integration.ID.make("mail")
        const methodID = Integration.MethodID.make("oauth")
        const headers = {
          cookie: "__Host-bm_auth=abc",
          origin: "https://app.example",
          "content-type": "application/json",
        }
        const url = `${baseURL}/api/integration/${integrationID}/oauth/${methodID}/client?workspace=${workspaceID}`
        const put = () => fetch(url, { method: "PUT", headers, body: JSON.stringify({ answer: { client_id: "id" } }) })
        const remove = () => fetch(url, { method: "DELETE", headers })
        const connect = () =>
          fetch(`${baseURL}/api/integration/${integrationID}/connect/oauth?workspace=${workspaceID}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ methodID }),
          })
        const expectInternal = async (response: Response) => {
          expect(response.status).toBe(500)
          const body = await response.text()
          expect(JSON.parse(body)).toEqual({ _tag: "Protocol.InternalError", error: "Internal server error" })
          expect(body).not.toContain("sensitive")
        }

        clientConfigurationFailure = { operation: "put", kind: "invalid" }
        const invalidSubmitted = await put()
        expect(invalidSubmitted.status).toBe(400)
        expect(await invalidSubmitted.json()).toEqual({
          _tag: "InvalidRequestError",
          message: "OAuth client configuration is invalid",
        })

        clientConfigurationFailure = { operation: "connect", kind: "invalid" }
        const invalidStored = await connect()
        expect(invalidStored.status).toBe(400)
        expect(await invalidStored.json()).toEqual({
          _tag: "InvalidRequestError",
          message: "OAuth client configuration is invalid",
        })

        for (const operation of ["put", "remove"] as const) {
          clientConfigurationFailure = { operation, kind: "missing" }
          const response = await (operation === "put" ? put() : remove())
          expect(response.status).toBe(404)
          expect(await response.json()).toEqual({
            _tag: "Integration.OAuthMethodNotFoundError",
            integrationID,
            methodID,
            message: "OAuth client method not found",
          })
        }

        clientConfigurationFailure = { operation: "put", kind: "storage" }
        await expectInternal(await put())
        clientConfigurationFailure = { operation: "remove", kind: "unknown" }
        await expectInternal(await remove())
        clientConfigurationFailure = { operation: "connect", kind: "storage" }
        await expectInternal(await connect())
        clientConfigurationFailure = { operation: "connect", kind: "unknown" }
        await expectInternal(await connect())
        clientConfigurationFailure = undefined
      } finally {
        selectedRole = "member"
      }
    }))

  it("maps Integration authorization and code errors to stable redacted requests", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        const integrationID = Integration.ID.make("github")
        const headers = {
          cookie: "__Host-bm_auth=abc",
          origin: "https://app.example",
          "content-type": "application/json",
        }
        const post = (path: string, body: object) =>
          fetch(`${baseURL}${path}?workspace=${workspaceID}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          })

        oauthFailure = "connect"
        const connect = await post(`/api/integration/${integrationID}/connect/oauth`, { methodID: "device" })
        expect(connect.status).toBe(400)
        expect(await connect.json()).toEqual({ _tag: "InvalidRequestError", message: "Authentication failed" })

        oauthFailure = "code"
        const code = await post(`/api/integration/${integrationID}/connect/oauth/con_oauth/complete`, {})
        expect(code.status).toBe(400)
        expect(await code.json()).toEqual({
          _tag: "InvalidRequestError",
          message: "Authorization code is required",
        })

        oauthFailure = "complete"
        const completion = await post(`/api/integration/${integrationID}/connect/oauth/con_oauth/complete`, {
          code: "bad",
        })
        expect(completion.status).toBe(400)
        expect(await completion.json()).toEqual({ _tag: "InvalidRequestError", message: "Authentication failed" })

        oauthFailure = undefined
        commandFailure = true
        const command = await post(`/api/integration/${integrationID}/connect/command`, { methodID: "cli" })
        expect(command.status).toBe(400)
        const body = await command.text()
        expect(JSON.parse(body)).toEqual({ _tag: "InvalidRequestError", message: "Authentication failed" })
        expect(body).not.toContain("sensitive")
        commandFailure = false
      } finally {
        selectedRole = "member"
      }
    }))

  it("reads Agents by ID and returns ID-keyed not-found errors", () =>
    withServer(async (baseURL) => {
      const headers = { cookie: "__Host-bm_auth=abc" }
      const response = await fetch(`${baseURL}/api/agent/${selectedAgent}?workspace=${workspaceID}`, { headers })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(managedAgent)

      const missing = AgentSchema.ID.make("missing")
      const unavailable = await fetch(`${baseURL}/api/agent/${missing}?workspace=${workspaceID}`, { headers })
      expect(unavailable.status).toBe(404)
      expect(await unavailable.json()).toEqual({
        _tag: "Agent.NotFoundError",
        id: missing,
        message: `Agent not found: ${missing}`,
      })
    }))

  it("creates Agents and maps duplicate IDs to conflict", () =>
    withServer(async (baseURL) => {
      const headers = {
        cookie: "__Host-bm_auth=abc",
        origin: "https://app.example",
        "content-type": "application/json",
      }
      const created = AgentSchema.Info.make({
        ...managedAgent,
        id: AgentSchema.ID.make("created"),
        name: AgentSchema.Name.make("created"),
        instructions: "Created Agent",
        mode: "subagent",
      })
      const response = await fetch(`${baseURL}/api/agent?workspace=${workspaceID}`, {
        method: "POST",
        headers,
        body: JSON.stringify(created),
      })
      expect(response.status).toBe(201)
      expect(await response.json()).toEqual(created)

      const conflict = await fetch(`${baseURL}/api/agent?workspace=${workspaceID}`, {
        method: "POST",
        headers,
        body: JSON.stringify(AgentSchema.Info.make({ ...managedAgent, mode: "subagent" })),
      })
      expect(conflict.status).toBe(409)
      expect(await conflict.json()).toEqual({
        _tag: "Agent.ConflictError",
        id: selectedAgent,
        message: `Agent already exists: ${selectedAgent}`,
      })

      // The Workspace has one primary Agent, so a created Agent must be a subagent.
      const primary = await fetch(`${baseURL}/api/agent?workspace=${workspaceID}`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          AgentSchema.Info.make({ ...created, id: AgentSchema.ID.make("second-primary"), mode: "primary" }),
        ),
      })
      expect(primary.status).toBe(403)
      expect(await primary.json()).toEqual({
        _tag: "ForbiddenError",
        message: "A created Agent must be a subagent",
      })

      const invalid = AgentSchema.Info.make({
        ...created,
        id: AgentSchema.ID.make("invalid-model"),
        name: AgentSchema.Name.make("invalid-model"),
        model: unavailableModel,
      })
      const unavailable = await fetch(`${baseURL}/api/agent?workspace=${workspaceID}`, {
        method: "POST",
        headers,
        body: JSON.stringify(invalid),
      })
      expect(unavailable.status).toBe(400)
      expect(await unavailable.json()).toEqual({
        _tag: "Agent.ModelUnavailableError",
        model: unavailableModel,
        message: "Agent model unavailable: selected/unavailable",
      })
    }))

  it("updates Agents by their immutable ID and maps missing IDs", () =>
    withServer(async (baseURL) => {
      const headers = {
        cookie: "__Host-bm_auth=abc",
        origin: "https://app.example",
        "content-type": "application/json",
      }
      const input = AgentSchema.Update.make({ ...managedAgent, instructions: "Updated Agent" })
      const response = await fetch(`${baseURL}/api/agent/${selectedAgent}?workspace=${workspaceID}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(input),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ...managedAgent, instructions: "Updated Agent" })

      const missing = AgentSchema.ID.make("missing")
      const unavailable = await fetch(`${baseURL}/api/agent/${missing}?workspace=${workspaceID}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(input),
      })
      expect(unavailable.status).toBe(404)
      expect(await unavailable.json()).toEqual({
        _tag: "Agent.NotFoundError",
        id: missing,
        message: `Agent not found: ${missing}`,
      })

      // Mode is fixed for an Agent's lifetime, so a subagent cannot be promoted.
      const promoted = await fetch(`${baseURL}/api/agent/${selectedAgent}?workspace=${workspaceID}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(AgentSchema.Update.make({ ...input, mode: "subagent" })),
      })
      expect(promoted.status).toBe(403)
      expect(await promoted.json()).toEqual({
        _tag: "ForbiddenError",
        message: "An Agent's mode cannot be changed",
      })

      const invalid = AgentSchema.Update.make({ ...input, model: unavailableModel })
      const invalidResponse = await fetch(`${baseURL}/api/agent/${selectedAgent}?workspace=${workspaceID}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(invalid),
      })
      expect(invalidResponse.status).toBe(400)
      expect(await invalidResponse.json()).toEqual({
        _tag: "Agent.ModelUnavailableError",
        model: unavailableModel,
        message: "Agent model unavailable: selected/unavailable",
      })
    }))

  it("removes an Agent record and maps missing IDs", () =>
    withServer(async (baseURL) => {
      deletedAgents.length = 0
      const headers = { cookie: "__Host-bm_auth=abc", origin: "https://app.example" }
      const response = await fetch(`${baseURL}/api/agent/${selectedAgent}?workspace=${workspaceID}`, {
        method: "DELETE",
        headers,
      })
      expect(response.status).toBe(204)
      expect(deletedAgents).toEqual([selectedAgent])

      const missing = AgentSchema.ID.make("missing")
      const unavailable = await fetch(`${baseURL}/api/agent/${missing}?workspace=${workspaceID}`, {
        method: "DELETE",
        headers,
      })
      expect(unavailable.status).toBe(404)
      expect(await unavailable.json()).toEqual({
        _tag: "Agent.NotFoundError",
        id: missing,
        message: `Agent not found: ${missing}`,
      })
    }))

  it("reserves built-in Agent overrides for Workspace administrators", () =>
    withServer(async (baseURL) => {
      deletedAgents.length = 0
      const headers = {
        cookie: "__Host-bm_auth=abc",
        origin: "https://app.example",
        "content-type": "application/json",
      }
      const path = `${baseURL}/api/agent/${AgentSchema.DefaultID}?workspace=${workspaceID}`
      const input = AgentSchema.Update.make({ ...builtInAgent, instructions: "Workspace override" })

      selectedRole = "member"
      const saveDenied = await fetch(path, { method: "PUT", headers, body: JSON.stringify(input) })
      expect(saveDenied.status).toBe(403)
      expect(await saveDenied.json()).toEqual({
        _tag: "ForbiddenError",
        message: "Only Workspace administrators can change a built-in Agent",
      })
      const resetDenied = await fetch(path, { method: "DELETE", headers })
      expect(resetDenied.status).toBe(403)
      expect(await resetDenied.json()).toEqual({
        _tag: "ForbiddenError",
        message: "Only Workspace administrators can reset a built-in Agent",
      })
      expect(deletedAgents).toEqual([])

      selectedRole = "admin"
      const saved = await fetch(path, { method: "PUT", headers, body: JSON.stringify(input) })
      expect(saved.status).toBe(200)
      expect(await saved.json()).toEqual({ ...builtInAgent, instructions: "Workspace override" })
      const reset = await fetch(path, { method: "DELETE", headers })
      expect(reset.status).toBe(204)
      expect(deletedAgents).toEqual([AgentSchema.DefaultID])
      selectedRole = "member"
    }))

  it("passes optional Agent and Model selections through Session creation", () =>
    withServer(async (baseURL) => {
      createdSessionInput = undefined
      const response = await fetch(`${baseURL}/api/session?workspace=${workspaceID}`, {
        method: "POST",
        headers: {
          cookie: "__Host-bm_auth=abc",
          origin: "https://app.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ projectID: managedProjectID, agent: selectedAgent, model: selectedModel }),
      })

      expect(response.status).toBe(201)
      expect(createdSessionInput).toEqual({ projectID: managedProjectID, agent: selectedAgent, model: selectedModel })
      expect(await response.json()).toMatchObject({
        projectID: managedProjectID,
        agent: selectedAgent,
        model: selectedModel,
      })
    }))

  it("lists usage through the selected Workspace", () =>
    withServer(async (baseURL) => {
      const response = await fetch(`${baseURL}/api/usage?workspace=${workspaceID}&limit=50`, {
        headers: { cookie: "__Host-bm_auth=abc" },
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: [] })
    }))

  it("lists durable usage records through the selected Workspace", () =>
    withServer(async (baseURL) => {
      usageRecordsRequest = undefined
      const response = await fetch(
        `${baseURL}/api/usage/records?workspace=${workspaceID}&limit=50&cursor=current_page`,
        {
          headers: { cookie: "__Host-bm_auth=abc" },
        },
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        data: [
          {
            id: "00000000-0000-4000-8000-000000000721",
            model: "bymorning/route-model",
            createdAt: "2026-08-30T12:00:00.000Z",
            usage: {
              cost: 1.5,
              costComplete: false,
              tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
            },
          },
        ],
        cursor: "next_page",
      })
      expect(usageRecordsRequest).toEqual({ workspaceID, limit: 50, cursor: "current_page" })
    }))

  it("lists filtered Tool usage through the selected Workspace", () =>
    withServer(async (baseURL) => {
      toolUsageRequest = undefined
      const sessionID = SessionSchema.ID.make("00000000-0000-4000-8000-000000000732")
      const response = await fetch(
        `${baseURL}/api/tool/usage?workspace=${workspaceID}&limit=25&cursor=current_page&userID=${actor.properties.userID}&sessionID=${sessionID}`,
        { headers: { cookie: "__Host-bm_auth=abc" } },
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        data: [
          {
            id: "00000000-0000-4000-8000-000000000731",
            userID: actor.properties.userID,
            sessionID,
            tool: "linear.search",
            status: "completed",
            occurredAt: "2026-09-03T12:00:00.000Z",
          },
        ],
        cursor: "next_page",
      })
      expect(toolUsageRequest).toEqual({
        workspaceID,
        cursor: "current_page",
        limit: 25,
        userID: actor.properties.userID,
        sessionID,
      })

      const isolated = await fetch(`${baseURL}/api/tool/usage?workspace=${otherWorkspaceID}`, {
        headers: { cookie: "__Host-bm_auth=abc" },
      })
      expect(isolated.status).toBe(200)
      expect(toolUsageRequest).toEqual({ workspaceID: otherWorkspaceID })
      expect((await fetch(`${baseURL}/api/tool/usage?workspace=${workspaceID}`)).status).toBe(401)
    }))

  it("maps invalid Tool usage cursors to the protocol error", () =>
    withServer(async (baseURL) => {
      const response = await fetch(`${baseURL}/api/tool/usage?workspace=${workspaceID}&cursor=bad_cursor`, {
        headers: { cookie: "__Host-bm_auth=abc" },
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ _tag: "Session.InvalidCursorError", message: "Invalid cursor" })
    }))

  it("returns a validated usage overview from the selected Workspace", () =>
    withServer(async (baseURL) => {
      overviewRequest = undefined
      const headers = { cookie: "__Host-bm_auth=abc" }
      const response = await fetch(`${baseURL}/api/usage/overview?workspace=${workspaceID}&days=30`, { headers })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        days: 30,
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-30T12:00:00.000Z",
        total: {
          invocations: 1,
          cost: 30,
          tokens: { total: 15, input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
        },
        daily: [{ date: "2026-08-01" }],
        users: [{ userID: actor.properties.userID }],
        models: [{ model: "bymorning/route-model" }],
      })
      expect(overviewRequest).toEqual({ workspaceID, days: 30 })

      const isolated = await fetch(`${baseURL}/api/usage/overview?workspace=${otherWorkspaceID}&days=7`, { headers })
      expect(isolated.status).toBe(200)
      expect(await isolated.json()).toMatchObject({ days: 7, total: { invocations: 2, cost: 7 } })
      expect(overviewRequest).toEqual({ workspaceID: otherWorkspaceID, days: 7 })

      expect((await fetch(`${baseURL}/api/usage/overview?workspace=${workspaceID}`, { headers })).status).toBe(400)
      expect((await fetch(`${baseURL}/api/usage/overview?workspace=${workspaceID}&days=14`, { headers })).status).toBe(
        400,
      )
      expect(overviewRequest).toEqual({ workspaceID: otherWorkspaceID, days: 7 })
    }))

  it("returns and validates the complete workspace leaderboard range", () =>
    withServer(async (baseURL) => {
      const headers = { cookie: "__Host-bm_auth=abc" }
      const response = await fetch(`${baseURL}/api/usage/leaderboard?workspace=${workspaceID}&days=7`, { headers })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        days: 7,
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-30T12:00:00.000Z",
        users: [],
        models: [],
      })
      expect((await fetch(`${baseURL}/api/usage/leaderboard?workspace=${workspaceID}`, { headers })).status).toBe(400)
      expect(
        (await fetch(`${baseURL}/api/usage/leaderboard?workspace=${workspaceID}&days=14`, { headers })).status,
      ).toBe(400)
    }))

  it("returns 404 for a missing Project on Project mutation and Session creation", () =>
    withServer(async (baseURL) => {
      const headers = {
        cookie: "__Host-bm_auth=abc",
        origin: "https://app.example",
        "content-type": "application/json",
      }
      const update = await fetch(`${baseURL}/api/project/${missingProjectID}?workspace=${workspaceID}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: "Unavailable" }),
      })
      expect(update.status).toBe(404)

      const remove = await fetch(`${baseURL}/api/project/${missingProjectID}?workspace=${workspaceID}`, {
        method: "DELETE",
        headers,
      })
      expect(remove.status).toBe(404)

      const create = await fetch(`${baseURL}/api/session?workspace=${workspaceID}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ projectID: missingProjectID }),
      })
      expect(create.status).toBe(404)
    }))

  it("lists, reads, and writes binary files only after resolving the Project in the selected Workspace", () =>
    withServer(async (baseURL) => {
      const authenticated = { cookie: "__Host-bm_auth=abc" }
      const unsafe = {
        ...authenticated,
        origin: "https://app.example",
        "content-type": "image/png",
      }
      const fileURL = `${baseURL}/api/project/${managedProjectID}/directory/file?workspace=${workspaceID}`
      const body = Uint8Array.from({ length: 48 * 1024 }, (_, index) => index % 256)

      const write = await fetch(`${fileURL}&path=${encodeURIComponent("assets/image.png")}`, {
        method: "PUT",
        headers: unsafe,
        body,
      })
      expect(write.status).toBe(204)

      const list = await fetch(`${baseURL}/api/project/${managedProjectID}/directory?workspace=${workspaceID}`, {
        headers: authenticated,
      })
      expect(list.status).toBe(200)
      expect(await list.json()).toEqual({ paths: ["assets/image.png"] })

      const read = await fetch(`${fileURL}&path=${encodeURIComponent("assets/image.png")}`, { headers: authenticated })
      expect(read.status).toBe(200)
      expect(read.headers.get("content-type")).toBe("application/octet-stream")
      expect(new Uint8Array(await read.arrayBuffer())).toEqual(body)

      const oversized = await fetch(`${fileURL}&path=oversized.bin`, {
        method: "PUT",
        headers: unsafe,
        body: new Uint8Array(20 * 1024 * 1024 + 1),
      })
      expect(oversized.status).toBe(400)

      const chunkedStatus = await new Promise<number | undefined>((resolve, reject) => {
        const upload = request(
          `${fileURL}&path=chunked-oversized.bin`,
          { method: "PUT", headers: unsafe },
          (response) => {
            response.resume()
            response.once("end", () => resolve(response.statusCode))
          },
        )
        upload.once("error", reject)
        upload.write(new Uint8Array(20 * 1024 * 1024 + 1))
        upload.end()
      })
      expect(chunkedStatus).toBe(400)
      const afterOversized = await fetch(
        `${baseURL}/api/project/${managedProjectID}/directory?workspace=${workspaceID}`,
        {
          headers: authenticated,
        },
      )
      expect(await afterOversized.json()).toEqual({ paths: ["assets/image.png"] })

      // Uploads between the 10 MiB API limit and the 20 MiB upload limit are accepted.
      const large = await fetch(`${fileURL}&path=large.bin`, {
        method: "PUT",
        headers: unsafe,
        body: new Uint8Array(15 * 1024 * 1024),
      })
      expect(large.status).toBe(204)

      const invalid = await fetch(`${fileURL}&path=${encodeURIComponent("../secret")}`, { headers: authenticated })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({ _tag: "Protocol.InputError", error: "Invalid Project file path" })

      const missing = await fetch(`${fileURL}&path=${encodeURIComponent("missing.ts")}`, { headers: authenticated })
      expect(missing.status).toBe(404)
      expect(await missing.json()).toMatchObject({ _tag: "ProjectFile.NotFoundError", path: "missing.ts" })

      const unavailable = await fetch(`${baseURL}/api/project/${missingProjectID}/directory?workspace=${workspaceID}`, {
        headers: authenticated,
      })
      expect(unavailable.status).toBe(404)
      expect(await unavailable.json()).toMatchObject({ _tag: "Project.NotFoundError", projectID: missingProjectID })

      failDirectoryList = true
      const failed = await fetch(`${baseURL}/api/project/${managedProjectID}/directory?workspace=${workspaceID}`, {
        headers: authenticated,
      })
      failDirectoryList = false
      expect(failed.status).toBe(500)
      expect(await failed.json()).toEqual({
        _tag: "Protocol.InternalError",
        error: "Project file operation failed",
      })
    }))

  it("deletes and moves files after resolving the Project, mapping each refusal and recording each change", () =>
    withServer(async (baseURL) => {
      const authenticated = { cookie: "__Host-bm_auth=abc" }
      const unsafe = { ...authenticated, origin: "https://app.example" }
      const json = { ...unsafe, "content-type": "application/json" }
      const directory = `${baseURL}/api/project/${managedProjectID}/directory`
      const fileURL = (path: string) => `${directory}/file?workspace=${workspaceID}&path=${encodeURIComponent(path)}`
      const moveURL = `${directory}/move?workspace=${workspaceID}`
      const paths = async () =>
        (
          (await (await fetch(`${directory}?workspace=${workspaceID}`, { headers: authenticated })).json()) as {
            paths: string[]
          }
        ).paths.filter((path) => path.startsWith("ops/"))
      for (const [path, body] of [
        ["ops/a.txt", "a"],
        ["ops/b.txt", "b"],
        ["ops/c.txt", "c"],
      ] as const)
        expect(
          (await fetch(fileURL(path), { method: "PUT", headers: { ...unsafe, "content-type": "text/plain" }, body }))
            .status,
        ).toBe(204)
      auditRecords.length = 0

      const conflict = await fetch(moveURL, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ from: "ops/a.txt", to: "ops/b.txt" }),
      })
      expect(conflict.status).toBe(409)
      expect(await conflict.json()).toEqual({
        _tag: "ProjectFile.ConflictError",
        path: "ops/b.txt",
        message: "A Project file already exists at ops/b.txt",
      })

      const moved = await fetch(moveURL, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ from: "ops/a.txt", to: "ops/renamed/a.txt" }),
      })
      expect(moved.status).toBe(204)
      expect(await paths()).toEqual(["ops/b.txt", "ops/c.txt", "ops/renamed/a.txt"])
      const read = await fetch(fileURL("ops/renamed/a.txt"), { headers: authenticated })
      expect(await read.text()).toBe("a")

      const unchanged = await fetch(moveURL, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ from: "ops/c.txt", to: "ops/c.txt" }),
      })
      expect(unchanged.status).toBe(204)

      const deleted = await fetch(fileURL("ops/b.txt"), { method: "DELETE", headers: unsafe })
      expect(deleted.status).toBe(204)
      expect(await paths()).toEqual(["ops/c.txt", "ops/renamed/a.txt"])

      const missingDelete = await fetch(fileURL("ops/b.txt"), { method: "DELETE", headers: unsafe })
      expect(missingDelete.status).toBe(404)
      expect(await missingDelete.json()).toMatchObject({ _tag: "ProjectFile.NotFoundError", path: "ops/b.txt" })
      const missingMove = await fetch(moveURL, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ from: "ops/missing.txt", to: "ops/elsewhere.txt" }),
      })
      expect(missingMove.status).toBe(404)
      expect(await missingMove.json()).toMatchObject({ _tag: "ProjectFile.NotFoundError", path: "ops/missing.txt" })

      for (const response of [
        await fetch(fileURL("../secret"), { method: "DELETE", headers: unsafe }),
        await fetch(moveURL, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ from: "ops/c.txt", to: "/absolute.txt" }),
        }),
      ]) {
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ _tag: "Protocol.InputError", error: "Invalid Project file path" })
      }

      const unavailable = await fetch(
        `${baseURL}/api/project/${missingProjectID}/directory/file?workspace=${workspaceID}&path=ops%2Fc.txt`,
        { method: "DELETE", headers: unsafe },
      )
      expect(unavailable.status).toBe(404)
      expect(await unavailable.json()).toMatchObject({ _tag: "Project.NotFoundError", projectID: missingProjectID })

      // Unsafe methods require the Application origin, exactly like uploads.
      const foreign = await fetch(fileURL("ops/c.txt"), {
        method: "DELETE",
        headers: { ...authenticated, origin: "https://evil.example" },
      })
      expect(foreign.status).toBe(403)
      expect(await paths()).toEqual(["ops/c.txt", "ops/renamed/a.txt"])

      // Only completed changes are recorded; refusals and the no-op move are not.
      expect(auditRecords).toEqual([
        expect.objectContaining({
          action: "file.move",
          workspaceID,
          target: `${managedProjectID}:ops/a.txt`,
          detail: { from: "ops/a.txt", to: "ops/renamed/a.txt" },
          outcome: "success",
        }),
        expect.objectContaining({
          action: "file.delete",
          workspaceID,
          target: `${managedProjectID}:ops/b.txt`,
          detail: { path: "ops/b.txt" },
          outcome: "success",
        }),
      ])
    }))

  it("rejects an invalid Origin before persisted Session lookup or graph acquisition", () =>
    withServer(async (baseURL) => {
      const sessionID = crypto.randomUUID()
      const acquired = graphAcquisitions
      const response = await fetch(`${baseURL}/api/session/${sessionID}?workspace=${workspaceID}`, {
        method: "PATCH",
        headers: {
          cookie: "__Host-bm_auth=abc",
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "Unavailable" }),
      })
      expect(response.status).toBe(403)
      expect(graphAcquisitions).toBe(acquired)
    }))

  it("enforces Form ownership and serves the pending-to-answered lifecycle", () =>
    withServer(async (baseURL) => {
      const authenticated = { cookie: "__Host-bm_auth=abc" }
      const unsafe = { ...authenticated, origin: "https://app.example", "content-type": "application/json" }
      const create = await fetch(`${baseURL}/api/session/${formSessionID}/form`, {
        method: "POST",
        headers: unsafe,
        body: JSON.stringify({
          title: "Questions",
          fields: [{ key: "name", type: "string", required: true }],
        }),
      })
      expect(create.status).toBe(200)
      const info = Schema.decodeUnknownSync(Form.Info)(await create.json())

      const listed = await fetch(`${baseURL}/api/session/${formSessionID}/form`, { headers: authenticated })
      expect(listed.status).toBe(200)
      expect(await listed.json()).toEqual([info])

      const owned = await fetch(`${baseURL}/api/session/${formSessionID}/form/${info.id}`, {
        headers: authenticated,
      })
      expect(owned.status).toBe(200)
      expect(await owned.json()).toEqual(info)

      const workspaceListed = await fetch(`${baseURL}/api/form/request?workspace=${workspaceID}`, {
        headers: authenticated,
      })
      expect(workspaceListed.status).toBe(200)
      expect(await workspaceListed.json()).toEqual([info])

      const foreign = await fetch(`${baseURL}/api/session/${otherFormSessionID}/form/${info.id}`, {
        headers: authenticated,
      })
      expect(foreign.status).toBe(404)
      expect(await foreign.json()).toEqual({
        _tag: "Form.NotFoundError",
        id: info.id,
        message: `Form not found: ${info.id}`,
      })

      const invalid = await fetch(`${baseURL}/api/session/${formSessionID}/form/${info.id}/reply`, {
        method: "POST",
        headers: unsafe,
        body: JSON.stringify({ answer: {} }),
      })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({
        _tag: "Form.InvalidAnswerError",
        id: info.id,
        message: "Missing required form field: name",
      })

      const replied = await fetch(`${baseURL}/api/session/${formSessionID}/form/${info.id}/reply`, {
        method: "POST",
        headers: unsafe,
        body: JSON.stringify({ answer: { name: "Ava" } }),
      })
      expect(replied.status).toBe(204)

      const state = await fetch(`${baseURL}/api/session/${formSessionID}/form/${info.id}/state`, {
        headers: authenticated,
      })
      expect(state.status).toBe(200)
      expect(await state.json()).toEqual({ status: "answered", answer: { name: "Ava" } })

      const settled = await fetch(`${baseURL}/api/session/${formSessionID}/form/${info.id}/cancel`, {
        method: "POST",
        headers: unsafe,
      })
      expect(settled.status).toBe(409)
      expect(await settled.json()).toEqual({
        _tag: "Form.AlreadySettledError",
        id: info.id,
        message: `Form already settled: ${info.id}`,
      })

      const pending = await fetch(`${baseURL}/api/session/${formSessionID}/form`, { headers: authenticated })
      expect(pending.status).toBe(200)
      expect(await pending.json()).toEqual([])

      const createCancelled = await fetch(`${baseURL}/api/session/${formSessionID}/form`, {
        method: "POST",
        headers: unsafe,
        body: JSON.stringify({ title: "Cancel me", fields: [{ key: "note", type: "string" }] }),
      })
      expect(createCancelled.status).toBe(200)
      const cancelledInfo = Schema.decodeUnknownSync(Form.Info)(await createCancelled.json())
      const cancelled = await fetch(`${baseURL}/api/session/${formSessionID}/form/${cancelledInfo.id}/cancel`, {
        method: "POST",
        headers: unsafe,
      })
      expect(cancelled.status).toBe(204)
      const cancelledState = await fetch(`${baseURL}/api/session/${formSessionID}/form/${cancelledInfo.id}/state`, {
        headers: authenticated,
      })
      expect(cancelledState.status).toBe(200)
      expect(await cancelledState.json()).toEqual({ status: "cancelled" })
    }))

  it("binds Skill CRUD to the selected Workspace capability and constructs full updates", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        updatedSkill = undefined
        const authenticated = { cookie: "__Host-bm_auth=abc" }
        const unsafe = {
          ...authenticated,
          origin: "https://app.example",
          "content-type": "application/json",
        }

        const list = await fetch(`${baseURL}/api/skill?workspace=${workspaceID}`, { headers: authenticated })
        expect(list.status).toBe(200)
        expect(await list.json()).toEqual([managedSkill])

        const get = await fetch(`${baseURL}/api/skill/${managedSkill.id}?workspace=${workspaceID}`, {
          headers: authenticated,
        })
        expect(get.status).toBe(200)
        expect(await get.json()).toEqual(managedSkill)

        const create = await fetch(`${baseURL}/api/skill?workspace=${workspaceID}`, {
          method: "POST",
          headers: unsafe,
          body: JSON.stringify({ name: "Review", description: "Reviews changes", instructions: "Inspect carefully" }),
        })
        expect(create.status).toBe(201)

        const replacement = { name: "Audit", description: "Audits changes", instructions: "Replace every field" }
        const update = await fetch(`${baseURL}/api/skill/${managedSkill.id}?workspace=${workspaceID}`, {
          method: "PUT",
          headers: unsafe,
          body: JSON.stringify(replacement),
        })
        expect(update.status).toBe(200)
        expect(updatedSkill).toEqual({ id: managedSkill.id, ...replacement })

        const remove = await fetch(`${baseURL}/api/skill/${managedSkill.id}?workspace=${workspaceID}`, {
          method: "DELETE",
          headers: unsafe,
        })
        expect(remove.status).toBe(204)

        const missing = await fetch(`${baseURL}/api/skill/${missingSkillID}?workspace=${workspaceID}`, {
          headers: authenticated,
        })
        expect(missing.status).toBe(404)
        expect(await missing.json()).toMatchObject({ _tag: "Skill.Error", skillID: missingSkillID })
        expect(
          (
            await fetch(`${baseURL}/api/skill/${missingSkillID}?workspace=${workspaceID}`, {
              method: "DELETE",
              headers: unsafe,
            })
          ).status,
        ).toBe(404)
      } finally {
        selectedRole = "member"
      }
    }))

  it("manages durable policies and suppression through the Policy CRUD routes", () =>
    withServer(async (baseURL) => {
      selectedRole = "admin"
      try {
        const authenticated = { cookie: "__Host-bm_auth=abc" }
        const unsafe = {
          ...authenticated,
          origin: "https://app.example",
          "content-type": "application/json",
        }
        const definition = {
          id: "managed",
          name: "Managed",
          rules: [{ type: "guardrail", action: "tool.execute", resource: "shell", effect: "deny" }],
        }

        const create = await fetch(`${baseURL}/api/policy?workspace=${workspaceID}`, {
          method: "POST",
          headers: unsafe,
          body: JSON.stringify(definition),
        })
        expect(create.status).toBe(200)
        expect(await create.json()).toMatchObject({
          ...definition,
          enabled: true,
          managed: true,
          suppressed: false,
          source: ManagedSource,
        })
        const list = await fetch(`${baseURL}/api/policy?workspace=${workspaceID}`, { headers: authenticated })
        expect(((await list.json()) as ReadonlyArray<PolicyInfo>).map(({ id, managed }) => ({ id, managed }))).toEqual([
          { id: "plugin-contributed", managed: false },
          { id: "managed", managed: true },
        ])

        const conflict = await fetch(`${baseURL}/api/policy?workspace=${workspaceID}`, {
          method: "POST",
          headers: unsafe,
          body: JSON.stringify({ ...definition, id: "plugin-contributed" }),
        })
        expect(conflict.status).toBe(400)

        const invalid = await fetch(`${baseURL}/api/policy?workspace=${workspaceID}`, {
          method: "POST",
          headers: unsafe,
          body: JSON.stringify({
            id: "invalid",
            name: "Invalid",
            rules: [{ type: "prompt", match: { pattern: "[" }, replacement: "" }],
          }),
        })
        expect(invalid.status).toBe(400)
        expect(await invalid.json()).toMatchObject({ _tag: "Protocol.InputError" })

        const update = await fetch(`${baseURL}/api/policy/managed?workspace=${workspaceID}`, {
          method: "PUT",
          headers: unsafe,
          body: JSON.stringify({ ...definition, name: "Renamed", enabled: false }),
        })
        expect(update.status).toBe(200)
        expect(await update.json()).toMatchObject({ id: "managed", name: "Renamed", enabled: false })

        const suppress = await fetch(`${baseURL}/api/policy/plugin-contributed/enabled?workspace=${workspaceID}`, {
          method: "PUT",
          headers: unsafe,
          body: JSON.stringify({ enabled: false }),
        })
        expect(suppress.status).toBe(200)
        expect(await suppress.json()).toMatchObject({ id: "plugin-contributed", managed: false, suppressed: true })
        const restore = await fetch(`${baseURL}/api/policy/plugin-contributed/enabled?workspace=${workspaceID}`, {
          method: "PUT",
          headers: unsafe,
          body: JSON.stringify({ enabled: true }),
        })
        expect(restore.status).toBe(200)
        expect(await restore.json()).toMatchObject({ id: "plugin-contributed", suppressed: false })

        const remove = await fetch(`${baseURL}/api/policy/managed?workspace=${workspaceID}`, {
          method: "DELETE",
          headers: unsafe,
        })
        expect(remove.status).toBe(204)
        const missing = await fetch(`${baseURL}/api/policy/managed?workspace=${workspaceID}`, {
          method: "DELETE",
          headers: unsafe,
        })
        expect(missing.status).toBe(404)
        expect(await missing.json()).toMatchObject({ _tag: "Policy.NotFoundError", id: "managed" })
      } finally {
        selectedRole = "member"
      }
    }))

  // The callback route admits 10 requests per client bucket, so each test stays below it.
  const callbackFailure = (baseURL: string) => async (reason: string, query: string, cookie?: string) => {
    const response = await fetch(`${baseURL}/auth/callback${query}`, {
      redirect: "manual",
      headers: cookie === undefined ? undefined : { cookie },
    })
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(`https://app.example/login?auth=failed&reason=${reason}`)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("set-cookie")).toContain("__Secure-bm_auth_attempt_v1=")
    expect(response.headers.get("set-cookie")).not.toContain("__Host-bm_auth=")
    expect(await response.text()).not.toContain("sensitive")
  }
  const valid = "__Secure-bm_auth_attempt_v1=attempt"

  it("projects a callback without one readable attempt cookie as expired", () =>
    withServer(async (baseURL) => {
      const assertFailure = callbackFailure(baseURL)
      await assertFailure("expired", "?state=sensitive")
      await assertFailure("expired", "?code=sensitive")
      await assertFailure("expired", "?code=&state=")
      await assertFailure("expired", "?code=sensitive&state=expected-state")
      await assertFailure("expired", "?code=sensitive&state=expected-state", "__Secure-bm_auth_attempt_v1=tampered")
      await assertFailure("expired", "?code=sensitive&state=expected-state", `${valid}; __Secure-bm_auth_attempt_v1=other`)
      await assertFailure("expired", "?error=access_denied&error_description=sensitive")
    }))

  it("projects each Auth.complete failure onto one coarse, non-sensitive reason", () =>
    withServer(async (baseURL) => {
      const assertFailure = callbackFailure(baseURL)
      await assertFailure("expired", "?code=sensitive&state=expected-state", "__Secure-bm_auth_attempt_v1=expired")
      await assertFailure("expired", "?code=sensitive&state=wrong", valid)
      await assertFailure("exchange", "?code=sensitive&state=expected-state", valid)
      await assertFailure("claims", "?code=unverified-code&state=expected-state", valid)
      await assertFailure("domain", "?code=denied-code&state=expected-state", valid)
      await assertFailure("provider", "?code=unknown-provider-code&state=expected-state", valid)
      await assertFailure("account", "?code=invite-only-code&state=expected-state", valid)
      await assertFailure("unknown", "?code=unavailable-code&state=expected-state", valid)
      await assertFailure("unknown", "?error=access_denied&error_description=sensitive&state=expected-state", valid)
    }))

  it("expires the attempt cookie after a successful callback", () =>
    withServer(async (baseURL) => {
      const response = await fetch(`${baseURL}/auth/callback?code=successful-code&state=expected-state`, {
        redirect: "manual",
        headers: { cookie: "__Secure-bm_auth_attempt_v1=attempt" },
      })
      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe("https://app.example/")
      const setCookies = response.headers.getSetCookie()
      expect(setCookies).toHaveLength(2)
      expect(setCookies.some((value) => value.startsWith("__Host-bm_auth="))).toBe(true)
      expect(setCookies).toContain(
        "__Secure-bm_auth_attempt_v1=; Max-Age=0; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax",
      )
    }))

  it("consumes Integration callback values before redirecting to one clean, secret-free page", () =>
    withServer(async (baseURL) => {
      for (const query of ["?state=expected&code=sensitive-code", "?state=expected&error=access_denied"]) {
        const response = await fetch(`${baseURL}/auth/integration/callback${query}`, { redirect: "manual" })
        expect(response.status).toBe(303)
        expect(response.headers.get("location")).toBe("https://app.example/auth/integration/callback/complete")
        expect(response.headers.get("cache-control")).toBe("no-store")
        expect(response.headers.get("referrer-policy")).toBe("no-referrer")
        expect(response.headers.get("content-security-policy")).toBe(
          "default-src 'none'; style-src 'sha256-rUpXgSWTvfYfMhCasLmD39NLtF8NAku7yvpNTAZV7Go='; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        )
        expect(await response.text()).toBe("")
      }
      const rejected = await fetch(`${baseURL}/auth/integration/callback?state=unknown&code=sensitive-code`, {
        redirect: "manual",
      })
      expect(rejected.status).toBe(503)
      expect(rejected.headers.get("location")).toBeNull()
      expect(integrationOAuthCallback).toEqual({ state: "unknown", code: "sensitive-code" })

      const page = await fetch(`${baseURL}/auth/integration/callback/complete`)
      expect(page.status).toBe(200)
      expect(page.url).toBe(`${baseURL}/auth/integration/callback/complete`)
      expect(page.headers.get("cache-control")).toBe("no-store")
      expect(page.headers.get("referrer-policy")).toBe("no-referrer")
      expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8")
      expect(page.headers.get("content-security-policy")).toBe(
        "default-src 'none'; style-src 'sha256-rUpXgSWTvfYfMhCasLmD39NLtF8NAku7yvpNTAZV7Go='; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      )
      const body = await page.text()
      expect(body).toContain("Authorization response received")
      expect(body).toContain("return to ByMorning")
      expect(body).not.toContain("<script")
      expect(body).not.toContain("sensitive-code")
      expect(body).not.toContain("access_denied")
      expect(body).not.toContain("expected")
    }))

  it("projects email-domain denial as the coarse domain reason without the email or internal reason", () =>
    withServer(async (baseURL) => {
      const response = await fetch(`${baseURL}/auth/callback?code=denied-code&state=expected-state`, {
        redirect: "manual",
        headers: { cookie: "__Secure-bm_auth_attempt_v1=attempt" },
      })
      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe("https://app.example/login?auth=failed&reason=domain")
      expect(response.headers.get("cache-control")).toBe("no-store")
      const setCookie = response.headers.get("set-cookie") ?? ""
      expect(setCookie).toContain("__Secure-bm_auth_attempt_v1=")
      expect(setCookie).not.toContain("__Host-bm_auth=")
      const body = await response.text()
      expect(body).not.toContain("email-domain")
      expect(body).not.toContain("person@other.test")
    }))

  describe("Auth Provider discovery failures", () => {
    const origin = "https://login.microsoftonline.us"
    const unreachable = `ByMorning could not reach the identity provider at ${origin}. Check that the Gateway has outbound HTTPS access to it.`
    const discovery = (reason: AuthProvider.DiscoveryError["reason"], message: string) => () =>
      Effect.fail(new AuthProvider.DiscoveryError({ reason, message }))
    const setup = (baseURL: string) =>
      fetch(`${baseURL}/auth/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "create",
          token: "setup-token",
          value: {
            id: AuthProviderSchema.ID.create(),
            displayName: "Microsoft Entra",
            kind: "microsoft",
            domains: ["example.gov"],
            issuer: `${origin}/tenant/v2.0`,
            clientID: "client",
            clientSecret: "secret",
          },
        }),
      })

    it("answers Setup 503 with the unreachable issuer origin and the egress remedy", () =>
      withServer(async (baseURL) => {
        providerDiscovery = discovery("unreachable", unreachable)
        const response = await setup(baseURL)
        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({ _tag: "ServiceUnavailableError", message: unreachable })
      }))

    it.each([
      ["issuer", `The identity provider's discovery document at ${origin} did not match the issuer. Check the issuer URL.`],
      [
        "issuer",
        `The identity provider at ${origin} did not return a valid discovery document for this issuer. Check the issuer URL.`,
      ],
      [
        "endpoint",
        `The identity provider's discovery document at ${origin} does not list an authorization, token, and JWKS endpoint.`,
      ],
      ["grant", `The identity provider at ${origin} does not support the authorization code flow.`],
      ["pkce", `The identity provider at ${origin} does not support PKCE with S256.`],
      [
        "client-auth",
        `The identity provider at ${origin} does not accept a client secret (client_secret_basic or client_secret_post).`,
      ],
    ] as const)("answers Setup 400 for a %s discovery failure with its message verbatim", (reason, message) =>
      withServer(async (baseURL) => {
        providerDiscovery = discovery(reason, message)
        const response = await setup(baseURL)
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ _tag: "Protocol.InputError", error: message })
      }),
    )

    it("carries the discovery message through Settings create and update", () =>
      withServer(async (baseURL) => {
        selectedRole = "admin"
        try {
          providerDiscovery = discovery("unreachable", unreachable)
          const headers = {
            cookie: "__Host-bm_auth=abc",
            origin: "https://app.example",
            "content-type": "application/json",
          }
          const id = AuthProviderSchema.ID.create()
          const create = await fetch(`${baseURL}/api/auth-provider`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              id,
              displayName: "Microsoft Entra",
              kind: "microsoft",
              domains: ["example.gov"],
              issuer: `${origin}/tenant/v2.0`,
              clientID: "client",
              clientSecret: "secret",
            }),
          })
          expect(create.status).toBe(400)
          expect(await create.json()).toEqual({ _tag: "Protocol.InputError", error: unreachable })
          const update = await fetch(`${baseURL}/api/auth-provider/${id}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              id,
              revision: 1,
              displayName: "Microsoft Entra",
              kind: "microsoft",
              domains: ["example.gov"],
              status: "enabled",
              clientSecret: "rotated",
            }),
          })
          expect(update.status).toBe(400)
          expect(await update.json()).toEqual({ _tag: "Protocol.InputError", error: unreachable })
        } finally {
          selectedRole = "member"
        }
      }))
  })

  it("enforces exact-Origin logout", () =>
    withServer(async (baseURL) => {
      expect((await fetch(`${baseURL}/auth/logout`, { method: "POST" })).status).toBe(403)
      expect(
        (
          await fetch(`${baseURL}/auth/logout`, {
            method: "POST",
            headers: { origin: "https://app.example" },
          })
        ).status,
      ).toBe(204)
    }))
})
