import { describe, expect, it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Agent } from "@bymorning/schema/agent"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Project } from "@bymorning/schema/project"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { Session as SessionSchema } from "@bymorning/schema/session"
import { LLMEvent } from "@opencode-ai/ai/schema/events"
import { Event } from "@bymorning/schema/event"
import { Auth } from "@opencode-ai/ai/route/auth"
import { configure } from "@opencode-ai/ai/providers/openai-compatible"
import type { HttpMiddleware } from "@opencode-ai/ai/route/executor"
import { Effect, Layer, Ref, Stream } from "effect"
import { Command } from "../src/command.js"
import { Bus } from "../src/bus.js"
import { Model } from "../src/model.js"
import { PluginHooks } from "../src/plugin/hooks.js"
import { Plugin } from "../src/plugin.js"
import { Provider } from "../src/provider.js"
import { Session } from "../src/session.js"
import { SessionOperations } from "../src/session-operations.js"
import { Permission } from "../src/permission.js"
import { ModelResolver } from "../src/model-resolver.js"
import { Database } from "../src/database.js"
import { Actor } from "../src/actor.js"
import { Service as UserService } from "../src/user.js"
import { ServiceAccount } from "../src/service-account.js"
import { Config } from "../src/config.js"
import { Usage } from "../src/usage.js"

const SOL = ModelSchema.Ref.make({ provider: ProviderSchema.DeepSeek, id: "deepseek-v4-pro" })
const TERRA = ModelSchema.Ref.make({ provider: ProviderSchema.DeepSeek, id: "deepseek-v4-flash" })
const sessionID = SessionSchema.ID.make("00000000-0000-4000-8000-000000000901")
const session = SessionSchema.Info.make({
  id: sessionID,
  projectID: Project.ID.make("prj_00000000000000000000000901"),
  title: SessionSchema.Title.make("Generate routing"),
  agent: Agent.ID.make("build"),
  model: SOL,
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  updatedAt: new Date("2026-08-28T00:00:00.000Z"),
})

describe("SessionOperations.generate", () => {
  it.effect("activates, routes, exposes provenance to context, and leaves the Session selection unchanged", () =>
    Effect.gen(function* () {
      const activationCount = yield* Ref.make(0)
      const requests = yield* Ref.make<ReadonlyArray<Provider.StreamInput>>([])
      const contexts = yield* Ref.make<ReadonlyArray<{ requestedModel: ModelSchema.Ref; model: ModelSchema.Ref }>>([])
      const sessions = Session.Service.of({
        get: () => Effect.succeed(session),
      } as unknown as Session.Interface)
      const provider = Provider.Service.of({
        get: (name) =>
          name === ProviderSchema.DeepSeek
            ? Effect.succeed(
                ProviderSchema.Info.make({
                  name,
                  displayName: "Bymorning",
                  api: ProviderSchema.API.make("https://api.deepseek.com"),
                  format: "oa-compat",
                  status: "enabled",
                }),
              )
            : Effect.fail(new Provider.NotFoundError({ provider: name })),
        list: Effect.succeed([]),
        stream: (input) =>
          Stream.fromEffect(Ref.update(requests, (items) => [...items, input])).pipe(
            Stream.drain,
            Stream.concat(Stream.make(LLMEvent.textDelta({ id: "text", text: "routed" }))),
          ),
      })
      const events = Layer.succeed(
        Bus.Service,
        Bus.Service.of({
          publish: ((definition: Event.Definition, data: unknown) =>
            Effect.succeed({
              id: Event.ID.make("00000000-0000-4000-8000-000000000902"),
              created: 0,
              type: definition.type,
              data,
            })) as Bus.Interface["publish"],
          subscribe: (() => Effect.succeed(Stream.empty)) as Bus.Subscribe,
        }),
      )
      const dependencies = Layer.mergeAll(
        Layer.succeed(Plugin.Service, Plugin.Service.of({} as Plugin.Interface)),
        Layer.succeed(Session.Service, sessions),
        Layer.succeed(Command.Service, {} as Command.Interface),
        NodeCrypto.layer,
        Model.layer,
        Layer.effect(
          ModelResolver.Service,
          Model.Service.use((models) =>
            Effect.succeed(
              ModelResolver.Service.of({
                native: () => Effect.die("unused"),
                prepare: () => Effect.die("unused"),
                resolve: (input) =>
                  models.get(input.model).pipe(
                    Effect.map((selection) => ({
                      ref: input.model,
                      selection,
                      runtimeModel: configure({
                        provider: input.model.provider,
                        baseURL: "https://example.test/v1",
                        auth: Auth.none,
                      }).model(selection.info.apiID),
                      authentication: ((request, handler) => handler(request)) satisfies HttpMiddleware,
                    })),
                    Effect.mapError(
                      () => new ModelResolver.ResolutionError({ model: input.model, reason: "unknown-model" }),
                    ),
                  ),
              }),
            ),
          ),
        ).pipe(Layer.provide(Model.layer)),
        Layer.succeed(Provider.Service, provider),
        // Session admission now reserves Budget Holders before Provider admission.
        // The Budget limit lookup finds no limits against this stub; any other
        // persistence access remains an unexpected path.
        Layer.succeed(
          Database.Service,
          Database.Service.of({
            use: (label, operation) =>
              label === "Budget.limits"
                ? operation({
                    select: () => ({ from: () => ({ where: () => Effect.succeed([]) }) }),
                  } as unknown as Database.Executor)
                : Effect.die(new Error(`Unexpected persistence: ${label}`)),
            transact: (effect) => effect,
            transactRoot: (effect) => effect,
            afterCommit: (effect) => Effect.asVoid(effect),
          } as Database.Interface),
        ),
        Layer.succeed(Actor.Binding.Service, {
          workspaceID: "wrk_test",
          accountID: "acc_test",
          userID: "usr_test",
        } as never),
        Layer.succeed(
          UserService,
          UserService.of({
            select: () =>
              Effect.succeed({
                type: "user",
                properties: { workspaceID: "wrk_test", accountID: "acc_test", userID: "usr_test", role: "admin" },
              } as never),
            invite: () => Effect.die("unused"),
            list: () => Effect.die("unused"),
            remove: () => Effect.die(new Error("unused")),
          }),
        ),
        Layer.succeed(ServiceAccount.Service, ServiceAccount.Service.of({} as ServiceAccount.Interface)),
        Layer.succeed(
          Config.Service,
          Config.Service.of({
            get: Effect.succeed({}),
            provider: { update: () => Effect.die("unused") },
          } as unknown as Config.Interface),
        ),
        Layer.succeed(
          Usage.Service,
          Usage.Service.of({ spend: () => Effect.succeed(0) } as unknown as Usage.Interface),
        ),
        PluginHooks.layer,
        events,
        Layer.succeed(
          Permission.Service,
          Permission.Service.of({
            ask: () => Effect.die("unused"),
            assert: () => Effect.die("unused"),
            reply: () => Effect.die("unused"),
            get: () => Effect.die("unused"),
            forSession: () => Effect.die("unused"),
            list: Effect.die("unused"),
            saved: Effect.die("unused"),
            forget: () => Effect.die("unused"),
          }),
        ),
      )
      const runtime = SessionOperations.layer(Ref.update(activationCount, (count) => count + 1)).pipe(
        Layer.provideMerge(dependencies),
      )

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const hooks = yield* PluginHooks.Service
          yield* hooks.register("session", "model.request", (request) =>
            Effect.sync(() => {
              expect(request.purpose).toBe("generate")
              expect(request.messageID).toBeUndefined()
              request.model = TERRA
            }),
          )
          yield* hooks.register("session", "context", (context) =>
            Ref.update(contexts, (items) => [
              ...items,
              { requestedModel: context.requestedModel, model: context.model },
            ]),
          )
          const operations = yield* SessionOperations.Service
          return yield* operations.generate({ sessionID, prompt: "Generate through hooks" })
        }),
      ).pipe(Effect.provide(runtime))

      expect(result).toBe("routed")
      expect(yield* Ref.get(activationCount)).toBe(1)
      expect(yield* Ref.get(contexts)).toEqual([{ requestedModel: SOL, model: TERRA }])
      expect((yield* Ref.get(requests))[0]).toMatchObject({
        context: { purpose: "generate", requestedModel: SOL, model: TERRA },
        selection: { info: { id: "deepseek-v4-flash" } },
      })
      expect(session.model).toEqual(SOL)
    }),
  )
})
