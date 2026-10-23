export * as Integration from "./integration.js"

import { BedrockAuth } from "@opencode-ai/ai/protocols/utils/bedrock-auth"
import { AwsRegion } from "@bymorning/schema/aws-region"

import {
  Cause,
  Clock,
  Config,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Schedule,
  Schema,
  Scope,
  Stream,
  SynchronizedRef,
  Types,
} from "effect"
import { makeWorkspaceNode, type WorkspaceNode } from "@bymorning/util/effect/app-node"
import { Workspace } from "@bymorning/schema/workspace"
import { Integration } from "@bymorning/schema/integration"
import { Credential } from "./credential.js"
import { State } from "./state.js"
import { Bus } from "./bus.js"
import { Actor } from "./actor.js"
import { IntegrationConnection } from "./integration/connection.js"
import { AppProcess } from "./util/process.js"
import { ChildProcess } from "effect/unstable/process"
import { Form } from "./form.js"
import type { Event as EventSchema } from "@bymorning/schema/event"
import type {
  Implementation,
  MethodDefinition,
  MethodSelector,
  OAuthAuthorization,
  OAuthImplementation,
} from "./integration/definition.js"

export const ID = Integration.ID
export type ID = Integration.ID

export const MethodID = Integration.MethodID
export type MethodID = Integration.MethodID

export const AttemptID = Integration.AttemptID
export type AttemptID = typeof AttemptID.Type

export const OAuthMethod = Integration.OAuthMethod
export type OAuthMethod = Integration.OAuthMethod

export const CommandMethod = Integration.CommandMethod
export type CommandMethod = Integration.CommandMethod

export const KeyMethod = Integration.KeyMethod
export type KeyMethod = Integration.KeyMethod

export const EnvMethod = Integration.EnvMethod
export type EnvMethod = Integration.EnvMethod

export const AwsSigV4Method = Integration.AwsSigV4Method
export type AwsSigV4Method = Integration.AwsSigV4Method

export const EnvGroupMethod = Integration.EnvGroupMethod
export type EnvGroupMethod = Integration.EnvGroupMethod

export const ValuesMethod = Integration.ValuesMethod
export type ValuesMethod = Integration.ValuesMethod

export const BedrockAwsSigV4MethodID = Integration.BedrockAwsSigV4MethodID
export const BedrockBearerEnvMethodID = Integration.BedrockBearerEnvMethodID
export const BedrockSigV4EnvMethodID = Integration.BedrockSigV4EnvMethodID
export const BedrockEnvMethods = Integration.BedrockEnvMethods

export const Method = Integration.Method
export type Method = Integration.Method

export const Info = Integration.Info
export type Info = Integration.Info

/** Consumer-specific authentication source selection. */
export interface Selection {
  readonly deployment?: "allow" | "omit"
}

export const Attempt = Integration.Attempt
export type Attempt = Integration.Attempt

export const AttemptStatus = Integration.AttemptStatus
export type AttemptStatus = typeof AttemptStatus.Type

export const CommandAttempt = Integration.CommandAttempt
export type CommandAttempt = Integration.CommandAttempt

export const CommandAttemptStatus = Integration.CommandAttemptStatus
export type CommandAttemptStatus = Integration.CommandAttemptStatus

export class CodeRequiredError extends Schema.TaggedError<CodeRequiredError>()("Integration.CodeRequired", {
  attemptID: AttemptID,
}) {}

export class AuthorizationError extends Schema.TaggedError<AuthorizationError>()("Integration.Authorization", {
  cause: Schema.Defect(),
}) {}

export const OAuthClientConfigurationNotConfiguredError = Credential.MissingError
export type OAuthClientConfigurationNotConfiguredError = Credential.MissingError
export const OAuthClientConfigurationInvalidError = Credential.InvalidError
export type OAuthClientConfigurationInvalidError = Credential.InvalidError
export const OAuthClientConfigurationStorageError = Credential.StorageError
export type OAuthClientConfigurationStorageError = Credential.StorageError
export class OAuthMethodNotFoundError extends Schema.TaggedError<OAuthMethodNotFoundError>()(
  "Integration.OAuthMethodNotFoundError",
  { integrationID: ID, methodID: MethodID },
) {}

/** Member values were refused: no values method, an unknown or missing name, an empty value, or a line break. */
export class ValuesError extends Schema.TaggedError<ValuesError>()("Integration.ValuesError", {
  message: Schema.String,
}) {}

export type Error = CodeRequiredError | AuthorizationError

export { Event } from "@bymorning/schema/integration"

export const Ref = Integration.Ref
export type Ref = Integration.Ref

type Entry = {
  readonly ref: Types.DeepMutable<Ref>
  readonly definitions: Types.DeepMutable<MethodDefinition>[]
  readonly implementations: Map<MethodID, Types.DeepMutable<OAuthImplementation>>
}

type Data = {
  readonly integrations: Map<ID, Entry>
}

/** @internal */
export type Editor = {
  readonly list: () => readonly Ref[]
  readonly get: (id: ID) => Ref | undefined
  readonly update: (id: ID, update: (integration: Types.DeepMutable<Ref>) => void) => void
  readonly remove: (id: ID) => void
  readonly method: {
    readonly list: (integrationID: ID) => readonly MethodDefinition[]
    readonly update: (implementation: Implementation) => void
    readonly remove: (integrationID: ID, selector: MethodSelector) => void
  }
}

export interface Interface extends State.Transformable<Editor> {
  /** Registers a scoped transform over the integration registry. */
  /** Returns one integration with its methods and current connections. */
  readonly get: (id: ID, selection?: Selection) => Effect.Effect<Info | undefined, OAuthClientConfigurationStorageError>
  /** Returns all integrations with their methods and current connections. */
  // @effect-diagnostics-next-line lazyEffect:off
  readonly list: () => Effect.Effect<Info[], OAuthClientConfigurationStorageError>
  readonly client: {
    readonly put: (input: {
      readonly integrationID: ID
      readonly methodID: MethodID
      readonly answer: Form.Answer
    }) => Effect.Effect<
      void,
      OAuthMethodNotFoundError | OAuthClientConfigurationInvalidError | OAuthClientConfigurationStorageError | Actor.ForbiddenError
    >
    readonly remove: (input: {
      readonly integrationID: ID
      readonly methodID: MethodID
    }) => Effect.Effect<void, OAuthMethodNotFoundError | OAuthClientConfigurationStorageError | Actor.ForbiddenError>
  }
  readonly connection: {
    /** Returns the active connection for one integration. */
    readonly active: (id: ID, selection?: Selection) => Effect.Effect<IntegrationConnection.Info | undefined>
    /** Resolves a connection into usable credential material. */
    readonly resolve: (
      connection: IntegrationConnection.Info,
    ) => Effect.Effect<Credential.Value | undefined, AuthorizationError>
    /** Runs a key method and stores the resulting credential. */
    readonly key: (input: {
      /** Integration receiving the credential. */
      readonly integrationID: ID
      /** Secret entered by the user. */
      readonly key: string
      /** Values collected from the method's form fields. */
      readonly answer?: Form.Answer
      /** User-facing label for the stored credential. */
      readonly label?: string
      readonly scope?: "member" | "workspace"
    }) => Effect.Effect<void, AuthorizationError | Actor.ForbiddenError>
    /** Stores and activates an AWS SigV4 credential. */
    readonly awsSigV4: (input: {
      /** Integration receiving the credential. */
      readonly integrationID: ID
      /** AWS region used for Bedrock routing and request signing. */
      readonly region: string
      /** AWS access key ID. */
      readonly accessKeyId: string
      /** AWS secret access key. */
      readonly secretAccessKey: string
      /** Optional temporary-credential session token. */
      readonly sessionToken?: string
      /** User-facing label for the stored credential. */
      readonly label?: string
      readonly scope?: "member" | "workspace"
    }) => Effect.Effect<void, AuthorizationError | Actor.ForbiddenError>
    /**
     * Saves the bound member's values for an Integration's values method. Names
     * omitted from `values` keep the member's previously saved value; the result
     * must supply every field the method declares.
     */
    readonly values: (input: {
      readonly integrationID: ID
      readonly values: Readonly<Record<string, string>>
      readonly label?: string
    }) => Effect.Effect<void, ValuesError | Actor.ForbiddenError>
    /** Selects a stored credential as the active integration connection. */
    readonly activate: (credentialID: Credential.ID) => Effect.Effect<void, Actor.ForbiddenError>
    /** Updates a stored credential exposed as a connection. */
    readonly update: (
      credentialID: Credential.ID,
      updates: Partial<Pick<Credential.Info, "label">>,
    ) => Effect.Effect<void, Actor.ForbiddenError>
    /** Removes a stored credential connection. */
    readonly remove: (credentialID: Credential.ID) => Effect.Effect<void, Actor.ForbiddenError>
  }
  readonly oauth: {
    /** Starts a stateful OAuth attempt. */
    readonly connect: (input: {
      readonly integrationID: ID
      readonly methodID: MethodID
      readonly answer?: Form.Answer
      readonly label?: string
      readonly scope?: "member" | "workspace"
    }) => Effect.Effect<
      Attempt,
      | OAuthClientConfigurationNotConfiguredError
      | OAuthClientConfigurationInvalidError
      | OAuthClientConfigurationStorageError
      | AuthorizationError
      | Actor.ForbiddenError
    >
    /** Returns the current state of an OAuth attempt. */
    readonly status: (input: {
      readonly integrationID: ID
      readonly attemptID: AttemptID
    }) => Effect.Effect<AttemptStatus>
    /** Completes the attempt and stores its credential. */
    readonly complete: (input: {
      readonly integrationID: ID
      readonly attemptID: AttemptID
      readonly code?: string
    }) => Effect.Effect<void, CodeRequiredError | AuthorizationError>
    /** Cancels an attempt and releases its resources. */
    readonly cancel: (input: { readonly integrationID: ID; readonly attemptID: AttemptID }) => Effect.Effect<void>
  }
  readonly command: {
    readonly connect: (input: {
      readonly integrationID: ID
      readonly methodID: MethodID
      readonly label?: string
      readonly scope?: "member" | "workspace"
    }) => Effect.Effect<CommandAttempt, AuthorizationError | Actor.ForbiddenError>
    readonly status: (input: {
      readonly integrationID: ID
      readonly attemptID: AttemptID
    }) => Effect.Effect<CommandAttemptStatus>
    readonly cancel: (input: { readonly integrationID: ID; readonly attemptID: AttemptID }) => Effect.Effect<void>
  }
}

// @effect-diagnostics-next-line lazyEffect:off
export class Service extends Context.Service<Service, Interface>()("@opencode/Integration") {}

const attemptLifetime = Duration.toMillis(Duration.minutes(10))
const terminalRetention = Duration.toMillis(Duration.minutes(1))
const scrubInterval = Duration.seconds(30)

type AttemptTime = { created: number; expires: number }
type PendingAttempt = {
  status: "pending"
  completing: boolean
  persisting: boolean
  authorization: OAuthAuthorization
  integrationID: ID
  methodID: MethodID
  label?: string
  ownership: "member" | "workspace"
  scope: Scope.Closeable
  time: AttemptTime
}
type TerminalAttempt = {
  status: "complete" | "failed" | "expired"
  integrationID: ID
  message?: string
  removeAt: number
  time: AttemptTime
}
type AttemptEntry = PendingAttempt | TerminalAttempt

type PendingCommandAttempt = {
  status: "pending"
  integrationID: ID
  label?: string
  ownership: "member" | "workspace"
  message?: string
  persisting: boolean
  scope: Scope.Closeable
  time: AttemptTime
}
type TerminalCommandAttempt = {
  status: "complete" | "failed" | "expired"
  integrationID: ID
  message?: string
  removeAt: number
  time: AttemptTime
}
type CommandAttemptEntry = PendingCommandAttempt | TerminalCommandAttempt

export type MutationDefinition = typeof Integration.Event.Updated | typeof Integration.Event.ConnectionUpdated

export interface MutationPublisher {
  readonly publish: <D extends MutationDefinition>(
    definition: D,
    data: EventSchema.Data<D>,
    scope?: "member" | "workspace",
  ) => Effect.Effect<void>
}

export const layerWith = (publisher?: MutationPublisher, coordinator?: State.Coordinator) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const clientConfigurations = credentials.client
      const bus = yield* Bus.Service
      // The bound member's Role authorizes Workspace-scope Connection writes and
      // shared OAuth client setup. Caller-less constructions (the shared
      // Workspace Plugin runtime, tests) are trusted internal contexts.
      const binding = yield* Effect.serviceOption(Actor.Binding.Service)
      const publish = <D extends MutationDefinition>(
        definition: D,
        data: EventSchema.Data<D>,
        scope?: "member" | "workspace",
      ) =>
        (publisher?.publish(definition, data, scope) ?? bus.publish(definition, data)).pipe(Effect.orDie, Effect.asVoid)
      const processes = yield* AppProcess.Service
      const scope = yield* Scope.Scope
      const attempts = SynchronizedRef.makeUnsafe(new Map<AttemptID, AttemptEntry>())
      const commandAttempts = SynchronizedRef.makeUnsafe(new Map<AttemptID, CommandAttemptEntry>())
      const state = State.create<Data, Editor>({
        name: "integration",
        coordinator: coordinator ?? State.makeCoordinator(),
        initial: () => ({ integrations: new Map<ID, Entry>() }),
        editor: (editor) => ({
          list: () => Array.from(editor.integrations.values(), (entry) => entry.ref) as Ref[],
          get: (id) => editor.integrations.get(id)?.ref as Ref | undefined,
          update: (id, update) => {
            const current = editor.integrations.get(id) ?? {
              ref: { id, name: id },
              definitions: [],
              implementations: new Map(),
            }
            if (!editor.integrations.has(id)) editor.integrations.set(id, current)
            update(current.ref)
            current.ref.id = id
          },
          remove: (id) => editor.integrations.delete(id),
          method: {
            list: (integrationID) =>
              (editor.integrations.get(integrationID)?.definitions as MethodDefinition[] | undefined) ?? [],
            update: (implementation) => {
              const current = editor.integrations.get(implementation.integrationID) ?? {
                ref: {
                  id: implementation.integrationID,
                  name: implementation.integrationID,
                },
                definitions: [],
                implementations: new Map<MethodID, Types.DeepMutable<OAuthImplementation>>(),
              }
              if (!editor.integrations.has(implementation.integrationID)) {
                editor.integrations.set(implementation.integrationID, current)
              }
              const index = current.definitions.findIndex((method) => {
                if (method.type !== implementation.method.type) return false
                if ("id" in method && "id" in implementation.method) return method.id === implementation.method.id
                return true
              })
              if (index === -1) current.definitions.push(implementation.method as Types.DeepMutable<MethodDefinition>)
              else current.definitions[index] = implementation.method as Types.DeepMutable<MethodDefinition>
              if (implementation.method.type === "oauth") {
                current.implementations.set(
                  implementation.method.id,
                  implementation as Types.DeepMutable<OAuthImplementation>,
                )
              }
            },
            remove: (integrationID, method) => {
              const current = editor.integrations.get(integrationID)
              if (!current) return
              const index = current.definitions.findIndex((candidate) => {
                if (candidate.type !== method.type) return false
                if ("id" in candidate && "id" in method) return candidate.id === method.id
                return true
              })
              if (index !== -1) current.definitions.splice(index, 1)
              if (method.type === "oauth") current.implementations.delete(method.id)
            },
          },
        }),
        notify: () => publish(Integration.Event.Updated, {}),
      })

      const connectionScope = (integrationID: ID, requested?: "member" | "workspace") =>
        state.get().integrations.get(integrationID)?.ref.connectionPolicy === "member-only"
          ? "member"
          : (requested ?? "workspace")

      /**
       * Workspace-scoped Connections decide which external capabilities every
       * member may authenticate with, and permitted saved Connections can
       * activate a Provider, so only Workspace administrators establish them.
       * Member-scoped Connections (including every Connection of a member-only
       * Integration) stay open to the bound member.
       */
      const requireWorkspaceAdmin = (integrationID: ID, requested?: "member" | "workspace") =>
        connectionScope(integrationID, requested) === "workspace"
          ? Actor.Binding.requireAdmin(binding, "Only Workspace administrators can manage Workspace Connections")
          : Effect.void

      /** Shared Workspace Credential maintenance is administrator-only; member-scoped Credentials stay member-managed. */
      const requireCredentialAdmin = (scope: "member" | "workspace" | undefined) =>
        scope !== "member"
          ? Actor.Binding.requireAdmin(binding, "Only Workspace administrators can manage Workspace Connections")
          : Effect.void

      const getCredential = Effect.fnUntraced(function* (id: Credential.ID) {
        const credential = yield* credentials.get(id)
        if (
          credential &&
          state.get().integrations.get(credential.integrationID)?.ref.connectionPolicy === "member-only" &&
          credential.scope !== "member"
        )
          return undefined
        return credential
      })

      const createCredential = Effect.fnUntraced(function* (input: Parameters<Credential.Interface["create"]>[0]) {
        const scope = connectionScope(input.integrationID, input.scope)
        if (input.label !== undefined) return yield* credentials.create({ ...input, scope })
        const name = state.get().integrations.get(input.integrationID)?.ref.name ?? input.integrationID
        const labels = new Set(
          (yield* credentials.list(input.integrationID))
            .filter((credential) => (credential.scope ?? "workspace") === scope)
            .map((credential) => credential.label),
        )
        const label =
          Array.from({ length: labels.size + 1 }, (_, index) => (index === 0 ? name : `${name} ${index + 1}`)).find(
            (candidate) => !labels.has(candidate),
          ) ?? name
        return yield* credentials.create({ ...input, scope, label })
      })

      const readConfig = (name: string) =>
        Config.option(Config.string(name)).pipe(
          Effect.orElseSucceed(() => Option.none()),
          Effect.map(Option.getOrUndefined),
          Effect.map((value) => (value === undefined || value.length === 0 ? undefined : value)),
        )

      const readEnvGroup = Effect.fnUntraced(function* (method: Integration.EnvGroupMethod) {
        const values = new Map(
          yield* Effect.forEach([...method.required, ...method.optional], (name) =>
            readConfig(name).pipe(Effect.map((value) => [name, value] as const)),
          ),
        )
        if (method.required.some((name) => values.get(name) === undefined)) return undefined
        const region = values.get("AWS_REGION")
        if (region === undefined) return undefined
        if (method.authKind === "bedrock-bearer") {
          const credential = Option.getOrUndefined(
            Schema.decodeUnknownOption(Credential.AwsBearer)({
              type: "key",
              key: values.get("AWS_BEARER_TOKEN_BEDROCK"),
              configuration: { type: "aws-region", region },
            }),
          )
          if (credential === undefined) return undefined
          return {
            info: {
              type: "regional-env" as const,
              authKind: "bearer" as const,
              region: credential.configuration.region,
            },
            credential,
          }
        }
        const credential = Option.getOrUndefined(
          Schema.decodeUnknownOption(Credential.AwsSigV4)({
            type: "aws-sigv4",
            region,
            accessKeyId: values.get("AWS_ACCESS_KEY_ID"),
            secretAccessKey: values.get("AWS_SECRET_ACCESS_KEY"),
            ...(values.get("AWS_SESSION_TOKEN") === undefined ? {} : { sessionToken: values.get("AWS_SESSION_TOKEN") }),
          }),
        )
        if (credential === undefined) return undefined
        return {
          info: { type: "regional-env" as const, authKind: "sigv4" as const, region: credential.region },
          credential,
        }
      })

      const resolveConnections = Effect.fnUntraced(function* (
        entry: Entry | undefined,
        saved: readonly Credential.Info[],
        selection: Selection = {},
      ) {
        const ordered = saved.toReversed()
        const personal = ordered.filter((credential) => credential.scope === "member")
        const shared =
          entry?.ref.connectionPolicy === "member-only"
            ? []
            : ordered.filter((credential) => credential.scope !== "member")
        const credentials = [...personal, ...shared].map((credential): IntegrationConnection.Info => {
          if (credential.value.type === "aws-sigv4") {
            return {
              type: "regional-credential",
              id: credential.id,
              label: credential.label,
              scope: credential.scope ?? "workspace",
              active: credential.id === (credential.scope === "member" ? personal[0]?.id : shared[0]?.id),
              authKind: "sigv4",
              region: credential.value.region,
            }
          }
          const bearer = Option.getOrUndefined(Schema.decodeUnknownOption(Credential.AwsBearer)(credential.value))
          if (bearer !== undefined) {
            return {
              type: "regional-credential",
              id: credential.id,
              label: credential.label,
              scope: credential.scope ?? "workspace",
              active: credential.id === (credential.scope === "member" ? personal[0]?.id : shared[0]?.id),
              authKind: "bearer",
              region: bearer.configuration.region,
            }
          }
          return {
            type: "credential",
            id: credential.id,
            label: credential.label,
            scope: credential.scope ?? "workspace",
            active: credential.id === (credential.scope === "member" ? personal[0]?.id : shared[0]?.id),
          }
        })
        if (entry?.ref.connectionPolicy === "member-only") return credentials
        const env: IntegrationConnection.Info[] = []
        for (const method of entry?.definitions ?? []) {
          if (method.type === "env") {
            for (const name of method.names) {
              if ((yield* readConfig(name)) !== undefined) env.push({ type: "env", name })
            }
          }
          if (method.type === "env-group") {
            const resolved = yield* readEnvGroup(method)
            if (resolved !== undefined) env.push(resolved.info)
          }
        }
        const deployment: IntegrationConnection.Info[] = []
        if (selection.deployment === "allow" && entry?.definitions.some((method) => method.type === "aws-sigv4")) {
          const region = Option.getOrUndefined(Schema.decodeUnknownOption(AwsRegion)(
            (yield* readConfig("AWS_REGION")) ?? (yield* readConfig("AWS_DEFAULT_REGION")) ?? "us-east-1",
          ))
          if (region !== undefined) deployment.push({ type: "regional-deployment", authKind: "sigv4", region })
        }
        return [...credentials, ...env, ...deployment]
      })

      const projectMethod = (
        integrationID: ID,
        definition: MethodDefinition,
        connections: readonly IntegrationConnection.Info[],
        configured: ReadonlySet<string>,
        saved: readonly Credential.Info[],
      ) => {
        if (definition.type === "values") {
          // Only the member's own active values are projected, and only their names.
          const active = saved.find(
            (credential) => credential.scope === "member" && credential.active && credential.value.type === "values",
          )
          return {
            ...definition,
            saved: active?.value.type === "values" ? Object.keys(active.value.values).filter((name) => definition.fields.includes(name)) : [],
          }
        }
        if (definition.type === "env-group") {
          return {
            id: definition.id,
            type: definition.type,
            authKind: definition.authKind,
            available: connections.some(
              (connection) =>
                connection.type === "regional-env" &&
                connection.authKind === (definition.authKind === "bedrock-bearer" ? "bearer" : "sigv4"),
            ),
          }
        }
        if (definition.type !== "oauth") return definition
        const { client, ...method } = definition
        if (!client) return method
        return {
          ...method,
          client: { fields: client, configured: configured.has(`${integrationID}\0${definition.id}`) },
        }
      }

      const project = (
        entry: Entry,
        connections: IntegrationConnection.Info[],
        configured: ReadonlySet<string>,
        saved: readonly Credential.Info[],
      ) => {
        return Info.make({
          id: entry.ref.id,
          name: entry.ref.name,
          ...(entry.ref.connectionPolicy === undefined ? {} : { connectionPolicy: entry.ref.connectionPolicy }),
          methods: entry.definitions.map((definition) =>
            projectMethod(entry.ref.id, definition, connections, configured, saved),
          ),
          connections,
        })
      }

      const authorize = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.mapError((cause) => new AuthorizationError({ cause })))

      const close = (attemptScope: Scope.Closeable) =>
        Scope.close(attemptScope, Exit.void).pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid)

      const message = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause)
        return error instanceof Error ? error.message : String(error)
      }

      const settle = Effect.fnUntraced(function* (attemptID: AttemptID, exit: Exit.Exit<Credential.OAuth, unknown>) {
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const attempt = yield* SynchronizedRef.modify(attempts, (current) => {
              const match = current.get(attemptID)
              if (!match || match.status !== "pending" || match.persisting) return [undefined, current]
              const next = Exit.isSuccess(exit)
                ? { ...match, persisting: true }
                : {
                    status: "failed" as const,
                    integrationID: match.integrationID,
                    message: message(exit.cause),
                    time: match.time,
                    removeAt: now + terminalRetention,
                  }
              return [match, new Map(current).set(attemptID, next)]
            })
            if (!attempt) return
            if (Exit.isFailure(exit)) {
              yield* close(attempt.scope)
              return
            }

            yield* Effect.gen(function* () {
              const implementation = state
                .get()
                .integrations.get(attempt.integrationID)
                ?.implementations.get(attempt.methodID)
              const persistence = yield* Effect.sync(() => attempt.label ?? implementation?.label?.(exit.value)).pipe(
                Effect.flatMap((label) =>
                  createCredential({
                    integrationID: attempt.integrationID,
                    scope: attempt.ownership,
                    label,
                    value: exit.value,
                  }),
                ),
                Effect.asVoid,
                Effect.exit,
              )
              const settledAt = yield* Clock.currentTimeMillis
              const terminal = Exit.isSuccess(persistence)
                ? {
                    status: "complete" as const,
                    integrationID: attempt.integrationID,
                    time: attempt.time,
                    removeAt: settledAt + terminalRetention,
                  }
                : {
                    status: "failed" as const,
                    integrationID: attempt.integrationID,
                    message: message(persistence.cause),
                    time: attempt.time,
                    removeAt: settledAt + terminalRetention,
                  }
              // Persisting attempts cannot be cancelled, expired, or claimed again.
              yield* SynchronizedRef.update(attempts, (current) => new Map(current).set(attemptID, terminal))
              if (Exit.isFailure(persistence)) return yield* Effect.failCause(persistence.cause)
              yield* publish(
                Integration.Event.ConnectionUpdated,
                { integrationID: attempt.integrationID },
                attempt.ownership,
              )
              yield* publish(Integration.Event.Updated, {}, attempt.ownership)
            }).pipe(Effect.ensuring(close(attempt.scope)))
          }),
        )
      })

      const settleCommand = Effect.fnUntraced(function* (attemptID: AttemptID, exit: Exit.Exit<string, unknown>) {
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const attempt = yield* SynchronizedRef.modify(commandAttempts, (current) => {
              const match = current.get(attemptID)
              if (!match || match.status !== "pending" || match.persisting) return [undefined, current]
              const next = Exit.isSuccess(exit)
                ? { ...match, persisting: true }
                : {
                    status: "failed" as const,
                    integrationID: match.integrationID,
                    message: message(exit.cause),
                    time: match.time,
                    removeAt: now + terminalRetention,
                  }
              return [match, new Map(current).set(attemptID, next)]
            })
            if (!attempt) return
            if (Exit.isFailure(exit)) {
              yield* close(attempt.scope)
              return
            }

            const persistence = yield* createCredential({
              integrationID: attempt.integrationID,
              scope: attempt.ownership,
              label: attempt.label,
              value: Credential.Key.make({ type: "key", key: exit.value }),
            }).pipe(Effect.asVoid, Effect.exit)
            const settledAt = yield* Clock.currentTimeMillis
            const terminal = Exit.isSuccess(persistence)
              ? {
                  status: "complete" as const,
                  integrationID: attempt.integrationID,
                  time: attempt.time,
                  removeAt: settledAt + terminalRetention,
                }
              : {
                  status: "failed" as const,
                  integrationID: attempt.integrationID,
                  message: message(persistence.cause),
                  time: attempt.time,
                  removeAt: settledAt + terminalRetention,
                }
            yield* SynchronizedRef.update(commandAttempts, (current) => new Map(current).set(attemptID, terminal))
            yield* close(attempt.scope)
            if (Exit.isFailure(persistence)) return
            yield* publish(
              Integration.Event.ConnectionUpdated,
              { integrationID: attempt.integrationID },
              attempt.ownership,
            )
            yield* publish(Integration.Event.Updated, {}, attempt.ownership)
          }),
        )
      })

      const scrub = Effect.fnUntraced(function* () {
        const now = yield* Clock.currentTimeMillis
        const expired = yield* SynchronizedRef.modify(attempts, (current) => {
          const next = new Map(current)
          const scopes: Scope.Closeable[] = []
          for (const [id, attempt] of current) {
            if (attempt.status === "pending" && !attempt.persisting && attempt.time.expires <= now) {
              scopes.push(attempt.scope)
              next.set(id, {
                status: "expired",
                integrationID: attempt.integrationID,
                time: attempt.time,
                removeAt: now + terminalRetention,
              })
              continue
            }
            if (attempt.status !== "pending" && attempt.removeAt <= now) next.delete(id)
          }
          return [scopes, next]
        })
        yield* Effect.forEach(expired, close, { discard: true })
      })

      const scrubCommands = Effect.fnUntraced(function* () {
        const now = yield* Clock.currentTimeMillis
        const expired = yield* SynchronizedRef.modify(commandAttempts, (current) => {
          const next = new Map(current)
          const scopes: Scope.Closeable[] = []
          for (const [id, attempt] of current) {
            if (attempt.status === "pending" && !attempt.persisting && attempt.time.expires <= now) {
              scopes.push(attempt.scope)
              next.set(id, {
                status: "expired",
                integrationID: attempt.integrationID,
                time: attempt.time,
                removeAt: now + terminalRetention,
              })
              continue
            }
            if (attempt.status !== "pending" && attempt.removeAt <= now) next.delete(id)
          }
          return [scopes, next]
        })
        yield* Effect.forEach(expired, close, { discard: true })
      })

      yield* scrub().pipe(Effect.repeat(Schedule.spaced(scrubInterval)), Effect.forkIn(scope))
      yield* scrubCommands().pipe(Effect.repeat(Schedule.spaced(scrubInterval)), Effect.forkIn(scope))

      const connectOAuth = Effect.fn("Integration.oauth.connect")(function* (input: {
        readonly integrationID: ID
        readonly methodID: MethodID
        readonly answer?: Form.Answer
        readonly label?: string
        readonly scope?: "member" | "workspace"
      }) {
        yield* requireWorkspaceAdmin(input.integrationID, input.scope)
        const method = state.get().integrations.get(input.integrationID)?.implementations.get(input.methodID)
        if (!method) {
          return yield* Effect.die(new Error(`OAuth method not found: ${input.integrationID}/${input.methodID}`))
        }
        const answer = input.answer ?? {}
        if (method.method.form) {
          const invalid = Form.validateFields(method.method.form) ?? Form.validateAnswer(method.method.form, answer)
          if (invalid) return yield* new AuthorizationError({ cause: new Error(invalid) })
        }
        const clientAnswer = yield* clientConfigurations.resolve(
          { integrationID: method.integrationID, methodID: method.method.id },
          method.method.client,
        )
        const attemptScope = yield* Scope.fork(scope)
        const authorization = yield* authorize(method.authorize(answer, clientAnswer)).pipe(
          Scope.provide(attemptScope),
          Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(attemptScope, exit) : Effect.void)),
        )
        const id = AttemptID.create()
        const created = yield* Clock.currentTimeMillis
        const time = { created, expires: authorization.expiresAt ?? created + attemptLifetime }
        yield* SynchronizedRef.update(attempts, (current) =>
          new Map(current).set(id, {
            status: "pending",
            completing: authorization.mode === "auto",
            persisting: false,
            authorization,
            integrationID: input.integrationID,
            methodID: input.methodID,
            label: input.label,
            ownership: connectionScope(input.integrationID, input.scope),
            scope: attemptScope,
            time,
          }),
        )
        if (authorization.mode === "auto") {
          yield* authorization.callback.pipe(
            Effect.exit,
            Effect.flatMap((exit) => settle(id, exit)),
            Effect.forkIn(attemptScope, { startImmediately: true }),
          )
        }
        return new Attempt({
          attemptID: id,
          url: authorization.url,
          instructions: authorization.instructions,
          mode: authorization.mode,
          time,
        })
      })

      const connectCommand = Effect.fn("Integration.command.connect")(function* (input: {
        readonly integrationID: ID
        readonly methodID: MethodID
        readonly label?: string
        readonly scope?: "member" | "workspace"
      }) {
        yield* requireWorkspaceAdmin(input.integrationID, input.scope)
        const method = state
          .get()
          .integrations.get(input.integrationID)
          ?.definitions.find((method) => method.type === "command" && method.id === input.methodID)
        if (!method || method.type !== "command" || !method.command[0]) {
          return yield* Effect.die(new Error(`Command method not found: ${input.integrationID}/${input.methodID}`))
        }
        const command = method.command[0]

        const attemptScope = yield* Scope.fork(scope)
        const attemptID = AttemptID.create()
        const created = yield* Clock.currentTimeMillis
        const time = { created, expires: created + attemptLifetime }
        yield* SynchronizedRef.update(commandAttempts, (current) =>
          new Map(current).set(attemptID, {
            status: "pending",
            integrationID: input.integrationID,
            label: input.label,
            ownership: connectionScope(input.integrationID, input.scope),
            persisting: false,
            scope: attemptScope,
            time,
          }),
        )

        yield* Effect.gen(function* () {
          const handle = yield* processes.spawn(
            ChildProcess.make(command, method.command.slice(1), {
              extendEnv: true,
              stdin: "ignore",
            }),
          )
          const stdout = yield* AppProcess.collectStream(handle.stdout, undefined).pipe(Effect.forkScoped)
          yield* handle.stderr.pipe(
            Stream.decodeText,
            Stream.tap((chunk) =>
              SynchronizedRef.update(commandAttempts, (current) => {
                const attempt = current.get(attemptID)
                if (!attempt || attempt.status !== "pending") return current
                const message = (attempt.message ?? "") + chunk
                return new Map(current).set(attemptID, { ...attempt, message })
              }),
            ),
            Stream.runDrain,
          )
          const exitCode = yield* handle.exitCode
          if (exitCode !== 0) {
            const attempt = (yield* SynchronizedRef.get(commandAttempts)).get(attemptID)
            return yield* new AuthorizationError({
              cause: new Error(attempt?.message?.trim() || `Authentication command exited ${exitCode}`),
            })
          }
          const credential = (yield* Fiber.join(stdout)).buffer.toString("utf8").trim()
          if (!credential)
            return yield* new AuthorizationError({
              cause: new Error("Authentication command returned no credential"),
            })
          return credential
        }).pipe(
          Scope.provide(attemptScope),
          Effect.exit,
          Effect.flatMap((exit) => settleCommand(attemptID, exit)),
          Effect.forkIn(attemptScope, { startImmediately: true }),
        )

        return CommandAttempt.make({ attemptID, time })
      })

      return Service.of({
        // Apply a new transform at registration. Inside a plugin activation batch the rebuild is otherwise
        // deferred to the batch's end, where one plugin's throwing transform would fail the whole generation
        // instead of the registering plugin, and every later read would rethrow it.
        transform: (update) => state.transform(update).pipe(Effect.tap(() => Effect.sync(() => void state.get()))),
        reload: state.reload,
        get: Effect.fn("Integration.get")(function* (id, selection = {}) {
          const entry = state.get().integrations.get(id)
          if (!entry) return undefined
          const configured = yield* clientConfigurations.configured(
            entry.definitions.flatMap((method) =>
              method.type === "oauth" && method.client ? [{ integrationID: id, methodID: method.id }] : [],
            ),
          )
          const saved = yield* credentials.list(id)
          return project(
            entry,
            yield* resolveConnections(entry, saved, selection),
            new Set(configured.map((key) => `${key.integrationID}\0${key.methodID}`)),
            saved,
          )
        }),
        list: Effect.fn("Integration.list")(function* () {
          const entries = Array.from(state.get().integrations.values())
          const configured = yield* clientConfigurations.configured(
            entries.flatMap((entry) =>
              entry.definitions.flatMap((method) =>
                method.type === "oauth" && method.client ? [{ integrationID: entry.ref.id, methodID: method.id }] : [],
              ),
            ),
          )
          const configuredSet = new Set(configured.map((key) => `${key.integrationID}\0${key.methodID}`))
          const saved = Map.groupBy(yield* credentials.all(), (credential) => credential.integrationID)
          return (yield* Effect.forEach(entries, (entry) =>
            resolveConnections(entry, saved.get(entry.ref.id) ?? []).pipe(
              Effect.map((connections) => project(entry, connections, configuredSet, saved.get(entry.ref.id) ?? [])),
            ),
          )).toSorted((a, b) => a.name.localeCompare(b.name))
        }),
        client: {
          put: Effect.fn("Integration.client.put")(function* (input) {
            // OAuth application setup is shared by every authorization for its method.
            yield* Actor.Binding.requireAdmin(
              binding,
              "Only Workspace administrators can manage OAuth client configuration",
            )
            const implementation = state
              .get()
              .integrations.get(input.integrationID)
              ?.implementations.get(input.methodID)
            if (!implementation?.method.client) {
              return yield* new OAuthMethodNotFoundError({
                integrationID: input.integrationID,
                methodID: input.methodID,
              })
            }
            yield* clientConfigurations.put(
              {
                integrationID: input.integrationID,
                methodID: input.methodID,
              },
              implementation.method.client,
              input.answer,
            )
            yield* publish(Integration.Event.Updated, {})
          }),
          remove: Effect.fn("Integration.client.remove")(function* (input) {
            yield* Actor.Binding.requireAdmin(
              binding,
              "Only Workspace administrators can manage OAuth client configuration",
            )
            const implementation = state
              .get()
              .integrations.get(input.integrationID)
              ?.implementations.get(input.methodID)
            if (!implementation?.method.client) {
              return yield* new OAuthMethodNotFoundError({
                integrationID: input.integrationID,
                methodID: input.methodID,
              })
            }
            const removed = yield* clientConfigurations.remove({
              integrationID: input.integrationID,
              methodID: input.methodID,
            })
            if (removed) yield* publish(Integration.Event.Updated, {})
          }),
        },
        connection: {
          active: Effect.fn("Integration.connection.active")(function* (id, selection = {}) {
            const entry = state.get().integrations.get(id)
            return (yield* resolveConnections(entry, yield* credentials.list(id), selection))[0]
          }),
          resolve: Effect.fn("Integration.connection.resolve")(function* (connection) {
            if (connection.type === "regional-deployment") {
              const value = yield* BedrockAuth.defaultChain({ region: connection.region }).pipe(
                Effect.mapError(() => new AuthorizationError({ cause: "AWS deployment credentials unavailable" })),
              )
              return Credential.AwsSigV4.make({ type: "aws-sigv4", ...value, region: connection.region })
            }
            if (connection.type === "env") {
              const key = yield* readConfig(connection.name)
              return key ? Credential.Key.make({ type: "key", key }) : undefined
            }
            if (connection.type === "regional-env") {
              const methodID =
                connection.authKind === "bearer"
                  ? Integration.BedrockBearerEnvMethodID
                  : Integration.BedrockSigV4EnvMethodID
              const method = Array.from(state.get().integrations.values())
                .flatMap((entry) => entry.definitions)
                .find((candidate) => candidate.type === "env-group" && candidate.id === methodID)
              if (method?.type !== "env-group") return undefined
              return (yield* readEnvGroup(method))?.credential
            }
            const credential = yield* getCredential(connection.id)
            if (!credential) return undefined
            if (connection.type === "regional-credential") {
              if (credential.value.type === "aws-sigv4") return credential.value
              return Option.getOrUndefined(Schema.decodeUnknownOption(Credential.AwsBearer)(credential.value))
            }
            if (credential.value.type === "key" || credential.value.type === "aws-sigv4" || credential.value.type === "values")
              return credential.value
            const implementation = state
              .get()
              .integrations.get(credential.integrationID)
              ?.implementations.get(credential.value.methodID)
            const refresh = implementation?.refresh
            if (!refresh) return credential.value
            const now = yield* Clock.currentTimeMillis
            if (
              credential.value.expires === 0 ||
              credential.value.expires > now + Duration.toMillis(Duration.minutes(5))
            )
              return credential.value
            return yield* credentials
              .refreshOAuth(credential.id, now + Duration.toMillis(Duration.minutes(5)), (current) =>
                clientConfigurations
                  .resolve(
                    { integrationID: implementation.integrationID, methodID: implementation.method.id },
                    implementation.method.client,
                  )
                  .pipe(
                    Effect.flatMap((clientAnswer) => authorize(refresh(current, clientAnswer))),
                    Effect.mapError((cause) =>
                      cause instanceof AuthorizationError ? cause : new AuthorizationError({ cause }),
                    ),
                  ),
              )
              .pipe(
                Effect.mapError((cause) =>
                  cause instanceof AuthorizationError ? cause : new AuthorizationError({ cause }),
                ),
              )
          }),
          key: Effect.fn("Integration.connection.key")(function* (input) {
            yield* requireWorkspaceAdmin(input.integrationID, input.scope)
            const entry = state.get().integrations.get(input.integrationID)
            const method = entry?.definitions.find((method) => method.type === "key")
            if (!method) return yield* Effect.die(new Error(`Key method not found: ${input.integrationID}`))
            const answer = input.answer ?? {}
            if (method.form) {
              const invalid = Form.validateFields(method.form) ?? Form.validateAnswer(method.form, answer)
              if (invalid) return yield* new AuthorizationError({ cause: new Error(invalid) })
            }
            if (!method.form && Object.keys(answer).length > 0) {
              return yield* new AuthorizationError({ cause: new Error("Key method does not accept a form answer") })
            }
            const bedrock = entry?.definitions.some(
              (definition) =>
                definition.type === "aws-sigv4" ||
                (definition.type === "env-group" && definition.authKind === "bedrock-bearer"),
            )
            const value = bedrock
              ? Option.getOrUndefined(
                  Schema.decodeUnknownOption(Credential.AwsBearer)({
                    type: "key",
                    key: input.key,
                    configuration: { type: "aws-region", region: answer.region },
                  }),
                )
              : Credential.Key.make({
                  type: "key",
                  key: input.key,
                  ...(Object.keys(answer).length > 0 ? { configuration: answer } : {}),
                })
            if (value === undefined) {
              return yield* new AuthorizationError({ cause: new Error("Invalid Bedrock bearer credential") })
            }
            yield* createCredential({
              integrationID: input.integrationID,
              scope: input.scope,
              label: input.label,
              value,
            })
            yield* publish(
              Integration.Event.ConnectionUpdated,
              { integrationID: input.integrationID },
              connectionScope(input.integrationID, input.scope),
            )
            yield* publish(Integration.Event.Updated, {}, connectionScope(input.integrationID, input.scope))
          }),
          awsSigV4: Effect.fn("Integration.connection.awsSigV4")(function* (input) {
            yield* requireWorkspaceAdmin(input.integrationID, input.scope)
            const method = state
              .get()
              .integrations.get(input.integrationID)
              ?.definitions.find((candidate) => candidate.type === "aws-sigv4")
            if (method?.type !== "aws-sigv4") {
              return yield* Effect.die(new Error(`AWS SigV4 method not found: ${input.integrationID}`))
            }
            const invalid =
              Form.validateFields([method.region]) ??
              Form.validateAnswer([method.region], {
                [method.region.key]: input.region,
              })
            if (invalid) return yield* new AuthorizationError({ cause: new Error(invalid) })
            const value = Option.getOrUndefined(
              Schema.decodeUnknownOption(Credential.AwsSigV4)({
                type: "aws-sigv4",
                region: input.region,
                accessKeyId: input.accessKeyId,
                secretAccessKey: input.secretAccessKey,
                ...(input.sessionToken === undefined ? {} : { sessionToken: input.sessionToken }),
              }),
            )
            if (value === undefined) {
              return yield* new AuthorizationError({ cause: new Error("Invalid AWS SigV4 credential") })
            }
            yield* createCredential({
              integrationID: input.integrationID,
              scope: input.scope,
              label: input.label,
              value,
            })
            yield* publish(
              Integration.Event.ConnectionUpdated,
              { integrationID: input.integrationID },
              connectionScope(input.integrationID, input.scope),
            )
            yield* publish(Integration.Event.Updated, {}, connectionScope(input.integrationID, input.scope))
          }),
          values: Effect.fn("Integration.connection.values")(function* (input) {
            const method = state
              .get()
              .integrations.get(input.integrationID)
              ?.definitions.find((candidate) => candidate.type === "values")
            if (method?.type !== "values")
              return yield* new ValuesError({ message: "This integration does not accept member values" })
            // Member values are always personal: never a shared Workspace Connection.
            if (!Option.isSome(binding))
              return yield* new ValuesError({ message: "Member values require a signed-in member" })
            const fields = new Set<string>(method.fields)
            for (const [name, value] of Object.entries(input.values)) {
              if (!fields.has(name)) return yield* new ValuesError({ message: `Unknown value: ${name}` })
              if (value.length === 0) return yield* new ValuesError({ message: `Value for ${name} is empty` })
              // Header values must not be able to start another header or request line.
              if (/[\u0000-\u001f\u007f]/.test(value))
                return yield* new ValuesError({ message: `Value for ${name} contains a line break or control character` })
            }
            const current = (yield* credentials.list(input.integrationID, "member")).find(
              (credential) => credential.active && credential.value.type === "values",
            )
            const previous = current?.value.type === "values" ? current.value.values : {}
            const merged = Object.fromEntries(
              method.fields.flatMap((name) => {
                const value = input.values[name] ?? previous[name]
                return value === undefined ? [] : [[name, value] as const]
              }),
            )
            const missing = method.fields.filter((name) => merged[name] === undefined)
            if (missing.length > 0) return yield* new ValuesError({ message: `Missing values: ${missing.join(", ")}` })
            const value = Credential.Values.make({ type: "values", values: merged })
            if (current === undefined)
              yield* createCredential({
                integrationID: input.integrationID,
                scope: "member",
                label: input.label,
                value,
              })
            else
              yield* credentials.update(current.id, {
                value,
                ...(input.label === undefined ? {} : { label: input.label }),
              })
            yield* publish(Integration.Event.ConnectionUpdated, { integrationID: input.integrationID }, "member")
            yield* publish(Integration.Event.Updated, {}, "member")
          }),
          activate: Effect.fn("Integration.connection.activate")(function* (credentialID) {
            const credential = yield* getCredential(credentialID)
            if (!credential) return
            yield* requireCredentialAdmin(credential.scope)
            const active = (yield* resolveConnections(
              state.get().integrations.get(credential.integrationID),
              (yield* credentials.list(credential.integrationID)).filter(
                (candidate) => candidate.scope === credential.scope,
              ),
            ))[0]
            if ((active?.type === "credential" || active?.type === "regional-credential") && active.id === credentialID)
              return
            yield* credentials.activate(credentialID)
            yield* publish(
              Integration.Event.ConnectionUpdated,
              { integrationID: credential.integrationID },
              credential.scope,
            )
            yield* publish(Integration.Event.Updated, {}, credential.scope)
          }),
          update: Effect.fn("Integration.connection.update")(function* (credentialID, updates) {
            const credential = yield* getCredential(credentialID)
            if (!credential || updates.label === credential.label) return
            yield* requireCredentialAdmin(credential.scope)
            yield* credentials.update(credentialID, updates)
            yield* publish(
              Integration.Event.ConnectionUpdated,
              { integrationID: credential.integrationID },
              credential.scope,
            )
            yield* publish(Integration.Event.Updated, {}, credential.scope)
          }),
          remove: Effect.fn("Integration.connection.remove")(function* (credentialID) {
            const credential = yield* getCredential(credentialID)
            if (!credential) return
            yield* requireCredentialAdmin(credential.scope)
            yield* credentials.remove(credentialID)
            yield* publish(
              Integration.Event.ConnectionUpdated,
              { integrationID: credential.integrationID },
              credential.scope,
            )
            yield* publish(Integration.Event.Updated, {}, credential.scope)
          }),
        },
        oauth: {
          connect: connectOAuth,
          status: Effect.fn("Integration.oauth.status")(function* (input) {
            const attempt = (yield* SynchronizedRef.get(attempts)).get(input.attemptID)
            if (!attempt || attempt.integrationID !== input.integrationID)
              return yield* Effect.die(new Error(`OAuth attempt not found: ${input.attemptID}`))
            if (attempt.status === "failed") {
              return { status: attempt.status, message: attempt.message ?? "Authorization failed", time: attempt.time }
            }
            return { status: attempt.status, time: attempt.time }
          }),
          complete: Effect.fn("Integration.oauth.complete")(function* (input) {
            const attempt = yield* SynchronizedRef.modify(attempts, (current) => {
              const match = current.get(input.attemptID)
              if (!match || match.integrationID !== input.integrationID) return [undefined, current]
              if (match.status !== "pending" || match.completing) return [match, current]
              if (match.authorization.mode === "code" && input.code === undefined) return [match, current]
              return [match, new Map(current).set(input.attemptID, { ...match, completing: true })]
            })
            if (!attempt) return yield* Effect.die(new Error(`OAuth attempt not found: ${input.attemptID}`))
            if (attempt.status !== "pending") return
            if (attempt.authorization.mode === "code" && input.code === undefined) {
              return yield* new CodeRequiredError({ attemptID: input.attemptID })
            }
            if (attempt.completing)
              return yield* Effect.die(new Error(`OAuth attempt already completing: ${input.attemptID}`))
            const callback =
              attempt.authorization.mode === "auto"
                ? attempt.authorization.callback
                : attempt.authorization.callback(input.code as string)
            const exit = yield* authorize(callback).pipe(Effect.exit)
            yield* settle(input.attemptID, exit)
            if (Exit.isFailure(exit)) return yield* exit
            return
          }),
          cancel: Effect.fn("Integration.oauth.cancel")(function* (input) {
            const attempt = yield* SynchronizedRef.modify(attempts, (current) => {
              const match = current.get(input.attemptID)
              if (
                !match ||
                match.integrationID !== input.integrationID ||
                match.status !== "pending" ||
                match.persisting
              )
                return [undefined, current]
              const next = new Map(current)
              next.delete(input.attemptID)
              return [match, next]
            })
            if (attempt) yield* Scope.close(attempt.scope, Exit.void)
          }),
        },
        command: {
          connect: connectCommand,
          status: Effect.fn("Integration.command.status")(function* (input) {
            const attempt = (yield* SynchronizedRef.get(commandAttempts)).get(input.attemptID)
            if (!attempt || attempt.integrationID !== input.integrationID)
              return yield* Effect.die(new Error(`Command attempt not found: ${input.attemptID}`))
            if (attempt.status === "pending") {
              return {
                status: attempt.status,
                ...(attempt.message ? { message: attempt.message } : {}),
                time: attempt.time,
              }
            }
            if (attempt.status === "failed") {
              return { status: attempt.status, message: attempt.message ?? "Authentication failed", time: attempt.time }
            }
            return { status: attempt.status, time: attempt.time }
          }),
          cancel: Effect.fn("Integration.command.cancel")(function* (input) {
            const attempt = yield* SynchronizedRef.modify(commandAttempts, (current) => {
              const match = current.get(input.attemptID)
              if (
                !match ||
                match.integrationID !== input.integrationID ||
                match.status !== "pending" ||
                match.persisting
              )
                return [undefined, current]
              const next = new Map(current)
              next.delete(input.attemptID)
              return [match, next]
            })
            if (attempt) yield* Scope.close(attempt.scope, Exit.void)
          }),
        },
      })
    }),
  )

export const layer = layerWith()

/** Canonical member Integration authority. */
export const node = makeWorkspaceNode({
  service: Service,
  layer: Layer.unwrap(Effect.map(State.Service, (coordinator) => layerWith(undefined, coordinator))),
  deps: [Credential.node, Bus.node, AppProcess.node, State.node, Actor.binding],
})

/** @deprecated Compose the canonical `node`; retained while callers migrate. */
export const workspaceNodes = <E>(
  workspaceID: Workspace.ID,
  bus: WorkspaceNode<Bus.Service, E>,
  publisher?: MutationPublisher,
) =>
  makeWorkspaceNode({
    service: Service,
    layer: layerWith(publisher),
    deps: [Credential.workspaceNodes(workspaceID), bus, AppProcess.node],
  })
