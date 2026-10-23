import { LayerNode } from "@bymorning/util/effect/layer-node"
import { describe, expect, it } from "@effect/vitest"
import type { Context as PluginContext } from "@bymorning/plugin/effect/plugin"
import { Agent as AgentSchema } from "@bymorning/schema/agent"
import * as Message from "@bymorning/schema/message"
import { Session } from "@bymorning/schema/session"
import { Tool as ToolSchema } from "@bymorning/schema/tool"
import { Workspace } from "@bymorning/schema/workspace"
import { Project } from "@bymorning/schema/project"
import { AwsRegion } from "@bymorning/schema/aws-region"
import {
  Cause,
  Clock,
  ConfigProvider,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  PubSub,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Config as ConfigSchema } from "@bymorning/schema/config"
import * as AppProcess from "../src/util/process.js"
import * as Bus from "../src/bus.js"
import * as Credential from "../src/credential.js"
import * as Integration from "../src/integration.js"
import type { Implementation, MethodSelector } from "../src/integration/definition.js"
import { Form } from "../src/form.js"
import * as Event from "@bymorning/schema/event"
import { Agent } from "../src/agent.js"
import { Permission } from "../src/permission.js"
import { WebSearchToolPlugin } from "../src/plugin/internal/tool/web-search.js"
import { WebSearchExa } from "../src/plugin/internal/websearch/exa.js"
import { WebSearch } from "../src/websearch.js"
import { Config } from "../src/config.js"
import { Tool } from "../src/tool.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { agentService, configService, minimalConfig } from "./service-fixtures.js"

const client: Credential.Client = {
  configured: () => Effect.succeed([]),
  resolve: () => Effect.succeed(Form.Answer.make({})),
  put: () => Effect.void,
  remove: () => Effect.succeed(false),
}

const credentialLayer = Layer.effect(
  Credential.Service,
  Effect.gen(function* () {
    const stored = yield* Ref.make<Credential.Info[]>([])
    return Credential.Service.of({
      client,
      all: () => Ref.get(stored),
      list: (integrationID) =>
        Ref.get(stored).pipe(Effect.map((items) => items.filter((item) => item.integrationID === integrationID))),
      get: (id) => Ref.get(stored).pipe(Effect.map((items) => items.find((item) => item.id === id))),
      create: (input) =>
        Ref.modify(stored, (items) => {
          const credential = new Credential.Info({
            id: Credential.ID.create(),
            integrationID: input.integrationID,
            label: input.label ?? "default",
            scope: input.scope ?? "workspace",
            value: input.value,
          })
          return [credential, [...items, credential]]
        }),
      activate: (id) =>
        Ref.update(stored, (items) => {
          const credential = items.find((item) => item.id === id)
          if (!credential) return items
          return [...items.filter((item) => item.id !== id), credential]
        }),
      update: (id, updates) =>
        Ref.update(stored, (items) =>
          items.map((item) =>
            item.id === id
              ? new Credential.Info({
                  ...item,
                  label: updates.label ?? item.label,
                  value: updates.value ?? item.value,
                })
              : item,
          ),
        ),
      updateOAuth: () => Effect.succeed(false),
      removeOAuth: () => Effect.succeed(false),
      refreshOAuth: () => Effect.die(new Error("OAuth refresh is not used by this fixture")),
      remove: (id) => Ref.update(stored, (items) => items.filter((item) => item.id !== id)),
      discard: () => Effect.void,
      connected: () => Effect.succeed([]),
    })
  }),
)

const failingCredentialLayer = Layer.succeed(
  Credential.Service,
  Credential.Service.of({
    client,
    all: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
    get: () => Effect.void.pipe(Effect.as(undefined)),
    create: () => Effect.die(new Error("credential persistence failed")),
    activate: () => Effect.void,
    update: () => Effect.void,
    updateOAuth: () => Effect.succeed(false),
    removeOAuth: () => Effect.succeed(false),
    refreshOAuth: () => Effect.die(new Error("credential persistence failed")),
    remove: () => Effect.void,
    discard: () => Effect.void,
    connected: () => Effect.succeed([]),
  }),
)

const busLayer = Layer.effect(
  Bus.Service,
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<Event.Payload>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(events))
    const publish = ((definition: Event.Definition, data: unknown) =>
      Effect.gen(function* () {
        const event = {
          id: Event.ID.make(crypto.randomUUID()),
          created: Date.now(),
          type: definition.type,
          data,
        } as Event.Payload<typeof definition>
        yield* PubSub.publish(events, event)
        return event
      })) as Bus.Interface["publish"]
    return Bus.Service.of({
      publish,
      subscribe: ((input?: Event.Definition | readonly Event.Definition[]) => {
        const types =
          input === undefined
            ? undefined
            : new Set((Array.isArray(input) ? input : [input]).map((definition) => definition.type))
        return PubSub.subscribe(events).pipe(
          Effect.map((subscription) =>
            Stream.fromSubscription(subscription).pipe(Stream.filter((event) => types === undefined || types.has(event.type))),
          ),
        )
      }) as Bus.Subscribe,
    })
  }),
)

const processLayer = LayerNode.compile(AppProcess.node)
const layer = Integration.layer.pipe(Layer.provideMerge(Layer.mergeAll(credentialLayer, busLayer, processLayer)))
const failingLayer = Integration.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(failingCredentialLayer, busLayer, processLayer)),
)

const refreshIntegrationID = Integration.ID.make("refresh-client")
const refreshMethodID = Integration.MethodID.make("oauth")
const refreshOAuthCredential = Credential.OAuth.make({
  type: "oauth",
  methodID: refreshMethodID,
  access: "access",
  refresh: "refresh",
  expires: 1,
})
const refreshCredential = new Credential.Info({
  id: Credential.ID.create(),
  integrationID: refreshIntegrationID,
  label: "Refresh",
  value: refreshOAuthCredential,
})

function refreshFailureLayer(resolve: Credential.Client["resolve"]) {
  return Integration.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          Credential.Service,
          Credential.Service.of({
            client: { ...client, resolve },
            all: () => Effect.succeed([refreshCredential]),
            list: () => Effect.succeed([refreshCredential]),
            get: () => Effect.succeed(refreshCredential),
            create: () => Effect.die("unused"),
            activate: () => Effect.void,
            update: () => Effect.void,
            updateOAuth: () => Effect.succeed(false),
            removeOAuth: () => Effect.succeed(false),
            refreshOAuth: (_id, _expiresBefore, refresh) => refresh(refreshOAuthCredential),
            remove: () => Effect.void,
            discard: () => Effect.void,
            connected: () => Effect.succeed([]),
          }),
        ),
        busLayer,
        processLayer,
      ),
    ),
  )
}

class EventuallyTimeoutError extends Schema.TaggedError<EventuallyTimeoutError>()("EventuallyTimeoutError", {}) {}

function eventually<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  predicate: (value: A) => boolean,
  remaining = 1000,
): Effect.Effect<A, E | EventuallyTimeoutError, R> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* new EventuallyTimeoutError()
    yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 1)))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

describe("Integration", () => {
  it.effect("prefers a member connection over newer workspace credentials and keeps selections independent", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("scoped-provider")
      yield* integrations.transform((editor) => editor.update(integrationID, () => {}))
      const member = yield* credentials.create({
        integrationID,
        scope: "member",
        value: Credential.Key.make({ type: "key", key: "personal" }),
      })
      const workspace = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "shared" }),
      })
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({
        id: member.id,
        scope: "member",
        active: true,
      })
      yield* integrations.connection.activate(workspace.id)
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({ id: member.id })
      yield* integrations.connection.remove(member.id)
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({
        id: workspace.id,
        scope: "workspace",
      })
    }).pipe(Effect.provide(layer)),
  )

  it.effect("excludes workspace credentials from personal integrations, including direct IDs", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("personal-mail")
      yield* integrations.transform((editor) => {
        editor.update(integrationID, (integration) => {
          integration.connectionPolicy = "member-only"
        })
        editor.method.update({ integrationID, method: { type: "key" } })
      })
      const shared = yield* credentials.create({
        integrationID,
        label: "Legacy account",
        value: Credential.Key.make({ type: "key", key: "shared" }),
      })
      expect((yield* integrations.get(integrationID))?.connections).toEqual([])
      expect((yield* integrations.list())[0]?.connections).toEqual([])
      expect(yield* integrations.connection.active(integrationID)).toBeUndefined()
      expect(
        yield* integrations.connection.resolve({ type: "credential", id: shared.id, label: shared.label }),
      ).toBeUndefined()
      yield* integrations.connection.update(shared.id, { label: "Changed" })
      yield* integrations.connection.activate(shared.id)
      yield* integrations.connection.remove(shared.id)
      expect(yield* credentials.get(shared.id)).toEqual(shared)
      yield* integrations.connection.key({ integrationID, key: "personal" })
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({ scope: "member" })
    }).pipe(Effect.provide(layer)),
  )

  it.effect("registers integrations through the editor", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const scope = yield* Scope.fork(yield* Scope.Scope)
      const openai = Integration.ID.make("openai")

      yield* integrations
        .transform((editor) => editor.update(openai, (integration) => (integration.name = "OpenAI")))
        .pipe(Scope.provide(scope))
      expect(yield* integrations.get(openai)).toEqual(
        Integration.Info.make({ id: openai, name: "OpenAI", methods: [], connections: [] }),
      )

      yield* Scope.close(scope, Exit.void)
      expect(yield* integrations.get(openai)).toBeUndefined()
    }).pipe(Effect.provide(layer)),
  )

  it.effect("reveals the previous registration when an override closes", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const id = Integration.ID.make("openai")
      const first = yield* Scope.fork(yield* Scope.Scope)
      const second = yield* Scope.fork(yield* Scope.Scope)

      yield* integrations
        .transform((editor) => editor.update(id, (integration) => (integration.name = "OpenAI")))
        .pipe(Scope.provide(first))
      yield* integrations
        .transform((editor) => editor.update(id, (integration) => (integration.name = "OpenAI Override")))
        .pipe(Scope.provide(second))
      expect((yield* integrations.get(id))?.name).toBe("OpenAI Override")

      yield* Scope.close(second, Exit.void)
      expect((yield* integrations.get(id))?.name).toBe("OpenAI")
      expect((yield* integrations.list()).map((integration) => integration.id)).toEqual([id])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("registers and overrides methods independently", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      const first = yield* Scope.fork(yield* Scope.Scope)
      const second = yield* Scope.fork(yield* Scope.Scope)
      const authorize = () =>
        Effect.succeed({
          mode: "auto" as const,
          url: "https://example.com/authorize",
          instructions: "Sign in",
          callback: Effect.never,
        })

      yield* integrations
        .transform((editor) =>
          editor.method.update({
            integrationID,
            method: { id: methodID, type: "oauth", label: "ChatGPT" },
            authorize,
          }),
        )
        .pipe(Scope.provide(first))
      yield* integrations
        .transform((editor) => {
          expect(editor.get(integrationID)).toEqual({ id: integrationID, name: "openai" })
          expect(editor.list()).toEqual([{ id: integrationID, name: "openai" }])
          expect(editor.method.list(integrationID)).toEqual([
            expect.objectContaining({ id: methodID, label: "ChatGPT" }),
          ])
          editor.method.update({
            integrationID,
            method: { id: methodID, type: "oauth", label: "ChatGPT Override" },
            authorize,
          })
        })
        .pipe(Scope.provide(second))

      expect((yield* integrations.get(integrationID))?.name).toBe("openai")
      expect((yield* integrations.get(integrationID))?.methods[0]).toMatchObject({ label: "ChatGPT Override" })

      yield* Scope.close(second, Exit.void)
      expect((yield* integrations.get(integrationID))?.methods[0]).toMatchObject({ label: "ChatGPT" })
      expect((yield* integrations.get(integrationID))?.methods).toEqual([expect.objectContaining({ id: methodID })])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("projects, configures, injects, and removes OAuth clients", () => {
    const configuredApplications = Layer.effect(
      Credential.Service,
      Effect.gen(function* () {
        const stored = yield* Ref.make<ReadonlyMap<string, Form.Answer>>(new Map())
        const id = (key: Credential.ClientKey) => `${key.integrationID}:${key.methodID}`
        const credentials = yield* Credential.Service
        return Credential.Service.of({
          ...credentials,
          client: {
            configured: (keys) =>
              Ref.get(stored).pipe(Effect.map((answers) => keys.filter((key) => answers.has(id(key))))),
            resolve: (key, fields) =>
              Effect.gen(function* () {
                const answer = (yield* Ref.get(stored)).get(id(key))
                if (!answer) return yield* new Credential.MissingError(key)
                if (fields && Form.validateAnswer(fields, answer)) {
                  return yield* new Credential.InvalidError(key)
                }
                return answer
              }),
            put: (key, fields, answer) =>
              Form.validateAnswer(fields, answer)
                ? Effect.fail(new Credential.InvalidError(key))
                : Ref.update(stored, (answers) => new Map(answers).set(id(key), answer)),
            remove: (key) =>
              Ref.modify(stored, (answers) => {
                const next = new Map(answers)
                const removed = next.delete(id(key))
                return [removed, next]
              }),
          },
        })
      }),
    ).pipe(Layer.provide(credentialLayer))
    const configuredLayer = Integration.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(busLayer, processLayer, configuredApplications)),
    )
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("mail-provider")
      const methodID = Integration.MethodID.make("oauth")
      const received = yield* Ref.make<ReadonlyArray<Form.Answer>>([])
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: {
            id: methodID,
            type: "oauth",
            label: "Google",
            form: [{ key: "account", type: "string", required: true }],
            client: [
              { key: "client_id", type: "string", required: true },
              { key: "client_secret", type: "string", required: true, secret: true },
            ],
          },
          authorize: (answer, clientAnswer) =>
            Ref.set(received, [answer, clientAnswer]).pipe(
              Effect.as({
                mode: "code" as const,
                url: "https://example.com",
                instructions: "Authorize",
                callback: () => Effect.never,
              }),
            ),
        }),
      )

      expect((yield* integrations.get(integrationID))?.methods[0]).toMatchObject({
        client: { configured: false },
      })
      expect(
        yield* integrations.client.put({ integrationID, methodID, answer: { client_id: "only" } }).pipe(Effect.flip),
      ).toBeInstanceOf(Integration.OAuthClientConfigurationInvalidError)
      yield* integrations.client.put({
        integrationID,
        methodID,
        answer: { client_id: "id", client_secret: "secret" },
      })
      expect((yield* integrations.get(integrationID))?.methods[0]).toMatchObject({
        client: { configured: true },
      })
      yield* integrations.oauth.connect({ integrationID, methodID, answer: { account: "team" } })
      expect(yield* Ref.get(received)).toEqual([{ account: "team" }, { client_id: "id", client_secret: "secret" }])
      yield* integrations.client.remove({ integrationID, methodID })
      expect((yield* integrations.get(integrationID))?.methods[0]).toMatchObject({
        client: { configured: false },
      })
      expect(
        yield* integrations.oauth.connect({ integrationID, methodID, answer: { account: "team" } }).pipe(Effect.flip),
      ).toBeInstanceOf(Integration.OAuthClientConfigurationNotConfiguredError)
    }).pipe(Effect.provide(configuredLayer))
  })

  it.effect("sanitizes OAuth client configuration failures during due refresh as AuthorizationError", () =>
    Effect.gen(function* () {
      const cases = [
        {
          resolve: (key: Credential.ClientKey) => Effect.fail(new Credential.MissingError(key)),
          cause: Integration.OAuthClientConfigurationNotConfiguredError,
        },
        {
          resolve: (key: Credential.ClientKey) => Effect.fail(new Credential.InvalidError(key)),
          cause: Integration.OAuthClientConfigurationInvalidError,
        },
        {
          resolve: (key: Credential.ClientKey) =>
            Effect.fail(new Credential.StorageError({ ...key, operation: "resolve" })),
          cause: Integration.OAuthClientConfigurationStorageError,
        },
      ] as const

      for (const testCase of cases) {
        const error = yield* Effect.gen(function* () {
          const integrations = yield* Integration.Service
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID: refreshIntegrationID,
              method: {
                id: refreshMethodID,
                type: "oauth",
                label: "OAuth",
                client: [
                  { key: "client_id", type: "string", required: true },
                  { key: "client_secret", type: "string", required: true, secret: true },
                ],
              },
              authorize: () => Effect.die("unused"),
              refresh: () => Effect.die("OAuth client validation must fail first"),
            }),
          )
          return yield* integrations.connection
            .resolve({ type: "credential", id: refreshCredential.id, label: refreshCredential.label })
            .pipe(Effect.flip)
        }).pipe(Effect.provide(refreshFailureLayer(testCase.resolve)))

        expect(error).toBeInstanceOf(Integration.AuthorizationError)
        expect(error.cause).toBeInstanceOf(testCase.cause)
      }
    }),
  )

  it.effect("connects with a key and stores the credential", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const bus = yield* Bus.Service
      const integrationID = Integration.ID.make("openai")
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: {
            type: "key",
            label: "API key",
            form: [{ type: "string", key: "accountId", title: "Account ID", required: true }],
          },
        }),
      )
      const updated = yield* (yield* bus
        .subscribe(Integration.Event.Updated))
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))

      expect(
        yield* integrations.connection.key({ integrationID, key: "secret" }).pipe(
          Effect.flip,
          Effect.map((error) => error.cause),
        ),
      ).toEqual(expect.objectContaining({ message: "Missing required form field: accountId" }))

      yield* integrations.connection.key({
        integrationID,
        key: "secret",
        answer: { accountId: "account" },
        label: "Work",
      })

      expect(yield* credentials.list(integrationID)).toEqual([
        expect.objectContaining({
          integrationID,
          label: "Work",
          value: Credential.Key.make({ type: "key", key: "secret", configuration: { accountId: "account" } }),
        }),
      ])
      expect((yield* Fiber.join(updated)).length).toBe(1)
    }).pipe(Effect.provide(layer)),
  )

  it.effect("names, activates, and removes multiple credentials like OpenCode", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      yield* integrations.transform((editor) => {
        editor.update(integrationID, (integration) => (integration.name = "OpenAI"))
        editor.method.update({ integrationID, method: { type: "key", label: "API key" } })
      })

      yield* integrations.connection.key({ integrationID, key: "first" })
      yield* integrations.connection.key({ integrationID, key: "second" })
      yield* integrations.connection.key({ integrationID, key: "duplicate", label: "OpenAI" })
      const connected = yield* integrations.get(integrationID)
      const saved = yield* credentials.list(integrationID)

      expect(saved.map((credential) => credential.label)).toEqual(["OpenAI", "OpenAI 2", "OpenAI"])
      expect(
        connected?.connections.map((connection) => (connection.type === "credential" ? connection.label : "env")),
      ).toEqual(["OpenAI", "OpenAI 2", "OpenAI"])
      expect(connected?.connections[0]).toMatchObject({ id: saved[2]?.id, label: "OpenAI" })

      yield* integrations.connection.activate(saved[0]!.id)
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({ id: saved[0]!.id })
      yield* integrations.connection.activate(saved[0]!.id)
      yield* integrations.connection.activate(Credential.ID.create())
      yield* integrations.connection.update(saved[0]!.id, { label: "Renamed" })
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({ id: saved[0]!.id, label: "Renamed" })
      yield* integrations.connection.update(saved[0]!.id, { label: "Renamed" })
      yield* integrations.connection.remove(Credential.ID.create())

      yield* integrations.connection.remove(saved[1]!.id)
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({ id: saved[0]!.id })
      yield* integrations.connection.remove(saved[0]!.id)
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({ id: saved[2]!.id })
      yield* integrations.connection.remove(saved[2]!.id)
      expect(yield* integrations.connection.active(integrationID)).toBeUndefined()
    }).pipe(Effect.provide(layer)),
  )

  it.live("runs command authentication and stores the final output line", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("company")
      const methodID = Integration.MethodID.make("login")
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: {
            id: methodID,
            type: "command",
            label: "Log in",
            command: [
              process.execPath,
              "-e",
              'console.error("https://example.com/login"); setTimeout(() => console.log("secret"), 100)',
            ],
          },
        }),
      )

      const attempt = yield* integrations.command.connect({ integrationID, methodID, label: "Work" })
      const pending = yield* eventually(
        integrations.command.status({ integrationID, attemptID: attempt.attemptID }),
        (status) => status.status === "pending" && status.message?.includes("https://example.com/login") === true,
      )
      expect(pending).toMatchObject({ status: "pending", message: "https://example.com/login\n" })

      expect(
        yield* eventually(
          integrations.command.status({ integrationID, attemptID: attempt.attemptID }),
          (status) => status.status === "complete",
        ),
      ).toEqual({ status: "complete", time: attempt.time })
      expect(yield* credentials.list(integrationID)).toEqual([
        expect.objectContaining({
          integrationID,
          label: "Work",
          value: Credential.Key.make({ type: "key", key: "secret" }),
        }),
      ])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("completes code OAuth once and stores the credential", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "ChatGPT" },
          authorize: () =>
            Effect.succeed({
              mode: "code" as const,
              url: "https://example.com/authorize",
              instructions: "Paste the code",
              callback: (code: string) =>
                Effect.succeed(
                  Credential.OAuth.make({
                    type: "oauth",
                    methodID,
                    access: "access",
                    refresh: "refresh",
                    expires: 1,
                    metadata: { code },
                  }),
                ),
            }),
        }),
      )

      const attempt = yield* integrations.oauth.connect({ integrationID, methodID, label: "Personal" })
      expect(attempt.mode).toBe("code")
      yield* integrations.oauth.complete({ integrationID, attemptID: attempt.attemptID, code: "1234" })

      expect((yield* credentials.list(integrationID))[0]).toEqual(
        expect.objectContaining({
          integrationID,
          label: "Personal",
          value: Credential.OAuth.make({
            type: "oauth",
            methodID,
            access: "access",
            refresh: "refresh",
            expires: 1,
            metadata: { code: "1234" },
          }),
        }),
      )
    }).pipe(Effect.provide(layer)),
  )

  it.effect("keeps code attempts open when the code is missing and closes them on cancel", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      let closed = false
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "ChatGPT" },
          authorize: () =>
            Effect.addFinalizer(() => Effect.sync(() => (closed = true))).pipe(
              Effect.as({
                mode: "code" as const,
                url: "https://example.com/authorize",
                instructions: "Paste the code",
                callback: () => Effect.die("unexpected callback"),
              }),
            ),
        }),
      )

      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      expect(
        yield* integrations.oauth.complete({ integrationID, attemptID: attempt.attemptID }).pipe(Effect.flip),
      ).toBeInstanceOf(Integration.CodeRequiredError)
      expect(closed).toBe(false)
      yield* integrations.oauth.cancel({
        integrationID: Integration.ID.make("other"),
        attemptID: attempt.attemptID,
      })
      expect(closed).toBe(false)
      yield* integrations.oauth.cancel({ integrationID, attemptID: attempt.attemptID })
      expect(closed).toBe(true)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }).pipe(Effect.provide(layer)),
  )

  it.effect("completes auto OAuth in the background", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("browser")
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Browser" },
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/authorize",
              instructions: "Sign in",
              callback: Effect.succeed(
                Credential.OAuth.make({ type: "oauth", methodID, access: "access", refresh: "refresh", expires: 1 }),
              ),
            }),
        }),
      )

      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      yield* Effect.yieldNow
      expect(yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).toEqual({
        status: "complete",
        time: attempt.time,
      })
      expect(yield* credentials.list(integrationID)).toHaveLength(1)
    }).pipe(Effect.provide(layer)),
  )

  it.effect("fails the attempt when credential persistence fails", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("chatgpt")
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "ChatGPT" },
          authorize: () =>
            Effect.succeed({
              mode: "code" as const,
              url: "https://example.com/authorize",
              instructions: "Paste the code",
              callback: () =>
                Effect.succeed(
                  Credential.OAuth.make({
                    type: "oauth",
                    methodID,
                    access: "access",
                    refresh: "refresh",
                    expires: 1,
                  }),
                ),
            }),
        }),
      )

      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      const exit = yield* integrations.oauth
        .complete({ integrationID, attemptID: attempt.attemptID, code: "1234" })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
      expect(yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).toEqual({
        status: "failed",
        message: "credential persistence failed",
        time: attempt.time,
      })
    }).pipe(Effect.provide(failingLayer)),
  )

  it.effect("expires abandoned OAuth attempts", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("browser")
      let closed = false
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "Browser" },
          authorize: () =>
            Effect.addFinalizer(() => Effect.sync(() => (closed = true))).pipe(
              Effect.as({
                mode: "auto" as const,
                url: "https://example.com/authorize",
                instructions: "Sign in",
                callback: Effect.never,
              }),
            ),
        }),
      )

      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      expect(attempt.time.expires - attempt.time.created).toBe(Duration.toMillis(Duration.minutes(10)))
      yield* TestClock.adjust(Duration.minutes(10))
      yield* Effect.yieldNow
      expect(yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).toEqual({
        status: "expired",
        time: attempt.time,
      })
      expect(closed).toBe(true)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(TestClock.layer())))),
  )

  it.effect("uses provider-defined OAuth attempt expirations", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make("openai")
      const created = yield* Clock.currentTimeMillis
      const expirations = [
        created + Duration.toMillis(Duration.minutes(5)),
        created + Duration.toMillis(Duration.minutes(20)),
      ]

      yield* Effect.forEach(expirations, (expiresAt, index) => {
        const methodID = Integration.MethodID.make(`browser-${index}`)
        return Effect.gen(function* () {
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID,
              method: { id: methodID, type: "oauth", label: "Browser" },
              authorize: () =>
                Effect.succeed({
                  mode: "auto" as const,
                  url: "https://example.com/authorize",
                  instructions: "Sign in",
                  expiresAt,
                  callback: Effect.never,
                }),
            }),
          )

          const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
          expect(attempt.time).toEqual({ created, expires: expiresAt })
        })
      })
    }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(TestClock.layer())))),
  )

  it.effect("projects credential and env connections", () => {
    const integrationID = Integration.ID.make("acme")
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env.INTEGRATION_TEST_ACME_KEY
        process.env.INTEGRATION_TEST_ACME_KEY = "secret"
        delete process.env.INTEGRATION_TEST_ACME_MISSING
        return previous
      }),
      () =>
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const credentials = yield* Credential.Service
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID,
              method: {
                type: "env",
                names: ["INTEGRATION_TEST_ACME_KEY", "INTEGRATION_TEST_ACME_MISSING"],
              },
            }),
          )
          const work = yield* credentials.create({
            integrationID,
            label: "Work",
            value: Credential.Key.make({ type: "key", key: "a" }),
          })
          const personal = yield* credentials.create({
            integrationID,
            label: "Personal",
            value: Credential.Key.make({ type: "key", key: "b" }),
          })

          expect((yield* integrations.get(integrationID))?.connections).toEqual([
            { type: "credential", id: personal.id, label: "Personal", scope: "workspace", active: true },
            { type: "credential", id: work.id, label: "Work", scope: "workspace", active: false },
            { type: "env", name: "INTEGRATION_TEST_ACME_KEY" },
          ])
          expect(yield* integrations.connection.active(integrationID)).toMatchObject({
            type: "credential",
            id: personal.id,
            label: "Personal",
          })
          expect(work.id).not.toBe(personal.id)
          expect(yield* integrations.connection.resolve({ type: "env", name: "INTEGRATION_TEST_ACME_KEY" })).toEqual(
            Credential.Key.make({ type: "key", key: "secret" }),
          )
          yield* integrations.connection.remove(personal.id)
          expect(yield* integrations.connection.active(integrationID)).toMatchObject({
            type: "credential",
            id: work.id,
            label: "Work",
          })
          yield* integrations.connection.remove(work.id)
          expect(yield* integrations.connection.active(integrationID)).toMatchObject({
            type: "env",
            name: "INTEGRATION_TEST_ACME_KEY",
          })
        }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.INTEGRATION_TEST_ACME_KEY
          else process.env.INTEGRATION_TEST_ACME_KEY = previous
        }),
    ).pipe(Effect.provide(layer))
  })

  it.effect("projects and resolves redacted Bedrock environment tuples", () => {
    const integrationID = Integration.ID.make("amazon-bedrock-env")
    const provider = ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        AWS_BEARER_TOKEN_BEDROCK: "bearer-secret",
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "access-key-id",
        AWS_SECRET_ACCESS_KEY: "secret-access-key",
        AWS_SESSION_TOKEN: "session-token",
      }),
    )
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => {
        for (const method of Integration.BedrockEnvMethods) editor.method.update({ integrationID, method })
      })

      const connections = (yield* integrations.get(integrationID))?.connections
      expect(connections).toEqual([
        { type: "regional-env", authKind: "bearer", region: "us-east-1" },
        { type: "regional-env", authKind: "sigv4", region: "us-east-1" },
      ])
      if (connections === undefined) return yield* Effect.die(new Error("Bedrock connections were not projected"))
      expect(JSON.stringify(connections)).not.toContain("secret")
      expect(JSON.stringify(connections)).not.toContain("access-key-id")
      const bearer = connections.at(0)
      const sigv4 = connections.at(1)
      if (bearer === undefined || sigv4 === undefined) return yield* Effect.die(new Error("Bedrock connection missing"))
      expect(yield* integrations.connection.resolve(bearer)).toEqual(
        Credential.AwsBearer.make({
          type: "key",
          key: "bearer-secret",
          configuration: { type: "aws-region", region: AwsRegion.make("us-east-1") },
        }),
      )
      expect(
        yield* integrations.connection.resolve(bearer).pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                AWS_BEARER_TOKEN_BEDROCK: "rotated-bearer-secret",
                AWS_REGION: "us-west-2",
              }),
            ),
          ),
        ),
      ).toEqual(
        Credential.AwsBearer.make({
          type: "key",
          key: "rotated-bearer-secret",
          configuration: { type: "aws-region", region: AwsRegion.make("us-west-2") },
        }),
      )
      expect(yield* integrations.connection.resolve(sigv4)).toEqual(
        Credential.AwsSigV4.make({
          type: "aws-sigv4",
          region: AwsRegion.make("us-east-1"),
          accessKeyId: "access-key-id",
          secretAccessKey: "secret-access-key",
          sessionToken: "session-token",
        }),
      )
    }).pipe(Effect.provide(Layer.merge(layer, provider)))
  })

  it.effect("discovers declared Bedrock environment connections without an activation switch", () => {
    const integrationID = Integration.ID.make("amazon-bedrock-env-default-off")
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => {
        for (const method of Integration.BedrockEnvMethods) editor.method.update({ integrationID, method })
      })

      const info = yield* integrations.get(integrationID)
      expect(info?.connections).toEqual([{ type: "regional-env", authKind: "bearer", region: "us-east-1" }])
      expect(info?.methods).toEqual([
        {
          id: Integration.BedrockBearerEnvMethodID,
          type: "env-group",
          authKind: "bedrock-bearer",
          available: true,
        },
        {
          id: Integration.BedrockSigV4EnvMethodID,
          type: "env-group",
          authKind: "aws-sigv4",
          available: false,
        },
      ])
    }).pipe(
      Effect.provide(
        Layer.merge(
          layer,
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              AWS_BEARER_TOKEN_BEDROCK: "ignored-secret",
              AWS_REGION: "us-east-1",
            }),
          ),
        ),
      ),
    )
  })

  it.effect("creates, rotates, activates, renames, and removes saved SigV4 credentials", () => {
    const integrationID = Integration.ID.make("amazon-bedrock-saved")
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      yield* integrations.transform((editor) => {
        editor.method.update({
          integrationID,
          method: {
            id: Integration.BedrockAwsSigV4MethodID,
            type: "aws-sigv4",
            label: "AWS credentials",
            region: { type: "string", key: "region", required: true },
          },
        })
        editor.method.update({
          integrationID,
          method: { type: "key", form: [{ type: "string", key: "region", required: true }] },
        })
        editor.method.update({ integrationID, method: Integration.BedrockEnvMethods[0] })
      })
      yield* integrations.connection.awsSigV4({
        integrationID,
        region: "us-east-1",
        accessKeyId: "first-access",
        secretAccessKey: "first-secret",
        sessionToken: "first-session",
        label: "First",
      })
      yield* integrations.connection.awsSigV4({
        integrationID,
        region: "us-west-2",
        accessKeyId: "second-access",
        secretAccessKey: "second-secret",
        label: "Second",
      })
      const saved = yield* credentials.list(integrationID)
      const first = saved.find((credential) => credential.label === "First")
      const second = saved.find((credential) => credential.label === "Second")
      if (first === undefined || second === undefined) return yield* Effect.die(new Error("Saved credentials missing"))
      expect(second.value).toEqual(
        Credential.AwsSigV4.make({
          type: "aws-sigv4",
          region: AwsRegion.make("us-west-2"),
          accessKeyId: "second-access",
          secretAccessKey: "second-secret",
        }),
      )
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({
        type: "regional-credential",
        id: second.id,
        label: "Second",
        authKind: "sigv4",
        region: "us-west-2",
      })
      expect(JSON.stringify(yield* integrations.get(integrationID))).not.toContain("second-secret")
      yield* integrations.connection.activate(first.id)
      yield* integrations.connection.update(first.id, { label: "Primary" })
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({ id: first.id, label: "Primary" })
      yield* integrations.connection.remove(first.id)
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({ id: second.id })
      yield* integrations.connection.remove(second.id)
      yield* integrations.connection.key({
        integrationID,
        key: "saved-bearer-secret",
        answer: { region: "us-west-2" },
        label: "Bearer",
      })
      const savedBearer = (yield* credentials.list(integrationID)).find((credential) => credential.label === "Bearer")
      if (savedBearer === undefined) return yield* Effect.die(new Error("Saved bearer credential missing"))
      expect(savedBearer.value).toEqual(
        Credential.Key.make({
          type: "key",
          key: "saved-bearer-secret",
          configuration: { type: "aws-region", region: "us-west-2" },
        }),
      )
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({
        type: "regional-credential",
        authKind: "bearer",
        region: "us-west-2",
      })
      yield* integrations.connection.remove(savedBearer.id)
      expect(yield* integrations.connection.active(integrationID)).toMatchObject({
        type: "regional-env",
        authKind: "bearer",
        region: "us-east-1",
      })
    }).pipe(
      Effect.provide(
        Layer.merge(
          layer,
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              AWS_BEARER_TOKEN_BEDROCK: "fallback-secret",
              AWS_REGION: "us-east-1",
            }),
          ),
        ),
      ),
    )
  })

  it.effect("omits partial Bedrock env tuples and keeps method IDs independent", () => {
    const integrationID = Integration.ID.make("amazon-bedrock-partial")
    return Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => {
        for (const method of Integration.BedrockEnvMethods) editor.method.update({ integrationID, method })
        editor.method.update({
          integrationID,
          method: { ...Integration.BedrockEnvMethods[0], optional: ["IGNORED"] },
        })
      })
      expect((yield* integrations.get(integrationID))?.methods).toHaveLength(2)
      expect((yield* integrations.get(integrationID))?.connections).toEqual([])
      yield* integrations.transform((editor) =>
        editor.method.remove(integrationID, { type: "env-group", id: Integration.BedrockBearerEnvMethodID }),
      )
      expect((yield* integrations.get(integrationID))?.methods).toEqual([
        {
          id: Integration.BedrockSigV4EnvMethodID,
          type: "env-group",
          authKind: "aws-sigv4",
          available: false,
        },
      ])
    }).pipe(
      Effect.provide(
        Layer.merge(
          layer,
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              AWS_BEARER_TOKEN_BEDROCK: "partial-token",
              AWS_ACCESS_KEY_ID: "partial-access-key",
              AWS_SESSION_TOKEN: "optional-only",
            }),
          ),
        ),
      ),
    )
  })

  it.effect("executes the websearch Tool through Integration credential resolution", () => {
    let apiKey: string | undefined
    const http = HttpClient.make((request) => {
      apiKey = new URL(request.url).searchParams.get("exaApiKey") ?? undefined
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify({
              result: {
                content: [
                  {
                    type: "text",
                    text: "Title: Integrated\nURL: https://example.com\nHighlights:\nintegrated result",
                    _meta: { searchTime: 1 },
                  },
                ],
              },
            }),
          ),
        ),
      )
    })
    const workspaceID = Workspace.ID.make("wrk_websearch_integration")
    const configured = Layer.mergeAll(
      layer,
      Tool.layer.pipe(Layer.provide(PluginHooks.layer)),
      WebSearch.layer.pipe(
        Layer.provide(Layer.mergeAll(busLayer, Layer.succeed(Config.Service, configService(minimalConfig)))),
      ),
      Layer.succeed(HttpClient.HttpClient, http),
    )

    return Effect.scoped(
      Effect.gen(function* () {
        const integrations = yield* Integration.Service
        const webSearch = yield* WebSearch.Service
        const tools = yield* Tool.Service
        const context = {
          app: { name: "ByMorning", version: "test", channel: "test" },
          tool: tools,
          integration: {
            transform: (callback: Parameters<PluginContext["integration"]["transform"]>[0]) =>
              integrations.transform((editor) =>
                callback({
                  list: editor.list,
                  get: (id) => editor.get(Integration.ID.make(id)),
                  update: (id, update) => editor.update(Integration.ID.make(id), update),
                  remove: (id) => editor.remove(Integration.ID.make(id)),
                  method: {
                    list: (id) =>
                      editor.method.list(Integration.ID.make(id)).filter((method) => method.type !== "values").map((method) =>
                        method.type === "env-group"
                          ? {
                              id: method.id,
                              type: method.type,
                              authKind: method.authKind,
                              available: false,
                            }
                          : method,
                      ),
                    update: (input) =>
                      editor.method.update({
                        ...input,
                        integrationID: Integration.ID.make(input.integrationID),
                      } as unknown as Implementation),
                    remove: (id, method) =>
                      editor.method.remove(Integration.ID.make(id), method as unknown as MethodSelector),
                  },
                }),
              ),
            connection: {
              active: (id: string) => integrations.connection.active(Integration.ID.make(id)),
              resolve: integrations.connection.resolve,
            },
          },
          websearch: { transform: webSearch.transform },
        } as unknown as PluginContext
        yield* WebSearchExa.Plugin.effect(context)
        yield* WebSearchToolPlugin.effect(context)
        const integrationID = Integration.ID.make("exa")
        yield* integrations.connection.key({ integrationID, key: "tool secret" })

        const program = yield* tools.snapshot()
        expect(program.definitions.map((definition) => definition.name)).toContain("websearch")
        const settled = yield* program
          .execute({
            call: {
              type: "tool-call",
              id: "call_websearch_integration",
              name: "websearch",
              input: { query: "Effect services" },
            },
            context: {
              caller: {
                type: "session",
                projectID: Project.ID.make("prj_00000000000000000000000802"),
                sessionID: Session.ID.make("00000000-0000-4000-8000-000000000801"),
                agent: AgentSchema.ID.make("build"),
                messageID: Message.ID.make("00000000-0000-4000-8000-000000000802"),
              },
              id: ToolSchema.CallID.make("call_websearch_integration"),
              progress: () => Effect.void,
              elicit: () => Effect.die("unused"),
              permission: () => Effect.void,
            },
          })
          .pipe(
            Effect.provideService(WebSearch.Service, webSearch),
            Effect.provideService(
              Agent.Service,
              agentService({
                list: Effect.die("unused"),
                get: () => Effect.die("unused"),
                resolve: Effect.die("unused"),
                create: () => Effect.die("unused"),
                update: () => Effect.die("unused"),
              }),
            ),
            Effect.provideService(
              Permission.Service,
              Permission.Service.of({ assert: () => Effect.void } as unknown as Permission.Interface),
            ),
          )

        expect(settled).toEqual({
          output: {
            provider: "exa",
            results: [
              {
                url: "https://example.com",
                title: "Integrated",
                content: "integrated result",
                time: {},
              },
            ],
          },
          content: [
            {
              type: "text",
              text: "## [Integrated](https://example.com)\n\nintegrated result",
            },
          ],
          metadata: { provider: "exa" },
        })
        expect(apiKey).toBe("tool secret")
        expect((yield* integrations.get(integrationID))?.connections).toEqual([
          expect.objectContaining({ type: "credential", label: "Exa" }),
        ])
      }),
    ).pipe(Effect.provide(configured))
  })
})
