import { layer as storageLayer } from "../fixture/storage.js"
import { Agent } from "@bymorning/core/agent"
import type { AgentEditor } from "@bymorning/plugin/effect/agent"
import type { Context as PluginContext, Plugin } from "@bymorning/plugin/effect/plugin"
import { Agent as AgentSchema } from "@bymorning/schema/agent"
import { NodeCrypto } from "@effect/platform-node"
import { PgClient } from "@effect/sql-pg"
import { Model as ModelSchema } from "@bymorning/schema/model"
import { Assistant, CompactionCompleted, ID as MessageID, User as UserMessage } from "@bymorning/schema/message"
import { Provider as ProviderSchema } from "@bymorning/schema/provider"
import { Plugin as PluginSchema } from "@bymorning/schema/plugin"
import { Project as ProjectSchema } from "@bymorning/schema/project"
import * as ConfigSchema from "@bymorning/schema/config"
import { Session as SessionSchema } from "@bymorning/schema/session"
import { SessionEvent } from "@bymorning/schema/session-event"
import { SessionError } from "@bymorning/schema/session-error"
import * as InstructionSchema from "@bymorning/schema/instruction"
import * as SkillSchema from "@bymorning/schema/skill"
import { Workspace } from "@bymorning/schema/workspace"
import { Account } from "@bymorning/schema/account"
import { Auth as AuthSchema } from "@bymorning/schema/auth"
import { User } from "@bymorning/schema/user"
import { ServiceAccount } from "@bymorning/schema/service-account"
import { Usage, empty as emptyUsage } from "@bymorning/schema/usage"
import * as CoreUsageSchema from "@bymorning/schema/usage"
import { Tool as ToolSchema } from "@bymorning/schema/tool"
import {
  Cause,
  Context,
  Crypto,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
  Scope,
  Stream,
  Types,
} from "effect"
import { TestClock } from "effect/testing"
import { it as effectIt } from "@effect/vitest"
import { LLMEvent } from "@opencode-ai/ai/schema/events"
import { AIError, RateLimitError } from "@opencode-ai/ai/schema/errors"
import { Auth } from "@opencode-ai/ai/route/auth"
import { configure } from "@opencode-ai/ai/providers/openai-compatible"
import type { HttpMiddleware } from "@opencode-ai/ai/route/executor"
import { Message, SystemPart, ToolCallPart } from "@opencode-ai/ai/schema/messages"
import { and, eq, inArray, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import { Bus } from "../../src/bus.js"
import { Config } from "../../src/config.js"
import {
  Database,
  AuthTable,
  ProjectTable,
  UserTable,
  WorkspaceTable,
  UsageTable,
} from "@bymorning/core/database"
import { ServiceAccountTable } from "../../src/database/schema/service-account.sql.js"
import { InstructionBlobTable, InstructionEntryTable } from "../../src/database/schema/instruction.sql.js"
import {
  InstructionTable,
  SessionInboxTable,
  SessionMessageTable,
  SessionTable,
} from "../../src/database/schema/session.sql.js"
import { Actor } from "../../src/actor.js"
import { Session } from "../../src/session.js"
import { User as UserService } from "../../src/user.js"
import { Usage as CoreUsage } from "../../src/usage.js"
import { Model } from "../../src/model.js"
import { Provider } from "../../src/provider.js"
import { ModelResolver } from "../../src/model-resolver.js"
import { Catalog } from "../../src/catalog.js"
import { Project } from "../../src/project.js"
import { Storage } from "../../src/storage.js"
import { ProjectDirectory } from "../../src/project-directory.js"
import { ProjectInstruction } from "../../src/project-instruction.js"
import { ConfigInstructionPlugin } from "../../src/config/plugin/instruction.js"
import { PluginHooks } from "../../src/plugin/hooks.js"
import { AddTool } from "../../src/plugin/internal/tool/add.js"
import { ExploreAgentPlugin } from "../../src/plugin/internal/agent/explore.js"
import { GeneralAgentPlugin } from "../../src/plugin/internal/agent/general.js"
import { makeRead, makeInstructions, Instructions } from "../../src/plugin/internal/tool/read.js"
import * as Binding from "../../src/plugin/internal/tool/binding.js"
import { WriteTool } from "../../src/plugin/internal/tool/write.js"
import { EditTool } from "../../src/plugin/internal/tool/edit.js"
import { ExecuteTool } from "../../src/plugin/internal/tool/execute.js"
import { makeGlob } from "../../src/plugin/internal/tool/glob.js"
import { GrepTool } from "../../src/plugin/internal/tool/grep.js"
import { makeSkill } from "../../src/plugin/internal/tool/skill.js"
import { makeWebSearch } from "../../src/plugin/internal/tool/web-search.js"
import { layer as permissionLayer } from "../../src/session/permission.js"
import { SessionInbox } from "../../src/session/inbox.js"
import { SessionExecution } from "../../src/session/execution.js"
import * as SessionMessage from "../../src/session/message.js"
import * as Runner from "../../src/session/runner.js"
import { prompt as maximumStepPrompt } from "../../src/session/limit.js"
import * as SessionTools from "../../src/session/tools.js"
import { CodeInterpreter } from "../../src/code-interpreter.js"
import * as SessionTitle from "../../src/session/title.js"
import { SessionRecorder } from "../../src/session/recorder.js"
import * as InstructionState from "../../src/session/instruction-state.js"
import { Instruction } from "../../src/instruction.js"
import { InstructionDiscovery } from "../../src/instruction-discovery.js"
import { Skill } from "../../src/skill.js"
import { SkillInstruction } from "../../src/skill-instruction.js"
import { InstructionEntry } from "../../src/instruction-entry.js"
import { Job } from "../../src/job.js"
import { WebSearch } from "../../src/websearch.js"
import { Tool } from "../../src/tool.js"
import { ToolOutput } from "../../src/tool-output.js"
import { Permission } from "../../src/permission.js"
import { Mcp } from "../../src/mcp.js"
import { Reference } from "../../src/reference.js"
import { Form } from "../../src/form.js"
import { CodeModeCatalog } from "../../src/codemode/catalog.js"
import { agentService, skillService } from "../service-fixtures.js"

const workspaceA = Workspace.ID.make("wrk_session_a")
const ownerA = { accountID: Account.ID.make("acc_session_a"), userID: User.ID.make("usr_session_a"), role: "admin" as const }
const workspaceB = Workspace.ID.make("wrk_session_b")
const ownerB = { accountID: Account.ID.make("acc_session_b"), userID: User.ID.make("usr_session_b"), role: "admin" as const }
const projectID = ProjectSchema.ID.make("prj_0000000000000000000session")
const sessionA = SessionSchema.ID.make("00000000-0000-4000-8000-000000000601")
const sessionB = SessionSchema.ID.make("00000000-0000-4000-8000-000000000602")
const initialModel = ModelSchema.Ref.make({ provider: ProviderSchema.Name.make("initial"), id: "initial" })
const selectedModel = ModelSchema.Ref.make({ provider: ProviderSchema.Name.make("selected"), id: "selected" })
const selectedAgent = AgentSchema.Info.make({
  id: AgentSchema.DefaultID,
  name: AgentSchema.Name.make("Default"),
  instructions: "",
  model: initialModel,
  mode: "primary",
  hidden: false,
  steps: null,
  permissions: [],
})
const requestedAgent = AgentSchema.Info.make({
  ...selectedAgent,
  id: AgentSchema.ID.make("selected"),
  name: AgentSchema.Name.make("Selected"),
  model: ModelSchema.Ref.make({ provider: ProviderSchema.Name.make("agent"), id: "agent" }),
})
const modelLessAgent = AgentSchema.Info.make({
  id: AgentSchema.ID.make("model-less"),
  name: AgentSchema.Name.make("Model less"),
  instructions: requestedAgent.instructions,
  mode: requestedAgent.mode,
  hidden: requestedAgent.hidden,
  steps: requestedAgent.steps,
  permissions: requestedAgent.permissions,
})
let layerA: Layer.Layer<
  | Session.Service
  | SessionInbox.Service
  | Project.Service
  | Bus.Service
  | Database.Service
  | Crypto.Crypto
  | InstructionEntry.Service
  | InstructionDiscovery.Service
  | Mcp.Service
  | Job.Service
  | Storage.Service
  | Permission.Service
  | Reference.Service
  | Config.Service
  | PluginHooks.Service
  | ToolOutput.Service,
  unknown
>
let layerB: Layer.Layer<
  | Session.Service
  | SessionInbox.Service
  | Project.Service
  | Bus.Service
  | Database.Service
  | Crypto.Crypto
  | InstructionEntry.Service
  | InstructionDiscovery.Service
  | Mcp.Service
  | Job.Service
  | Storage.Service
  | Permission.Service
  | Reference.Service
  | Config.Service
  | PluginHooks.Service
  | ToolOutput.Service,
  unknown
>
if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required for Core integration tests")
const databaseURL = process.env.DATABASE_URL

const agents = Layer.succeed(
  Agent.Service,
  agentService({
    list: Effect.die("unused"),
    get: (agent) =>
      Effect.succeed(
        agent === requestedAgent.id
          ? requestedAgent
          : agent === modelLessAgent.id
            ? modelLessAgent
            : agent === selectedAgent.id
              ? selectedAgent
              : undefined,
      ),
    resolve: Effect.succeed(selectedAgent),
    create: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
  }),
)
const websearch = Layer.mock(WebSearch.Service, {})
const skills = Layer.succeed(
  Skill.Service,
  skillService({
    list: Effect.succeed([]),
    get: () => Effect.die("unused"),
    create: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    delete: () => Effect.die("unused"),
  }),
)
const defaultInstruction = SkillInstruction.layer.pipe(Layer.provide(skills))
const references = Layer.succeed(
  Reference.Service,
  Reference.Service.of({
    transform: () => Effect.succeed({ dispose: Effect.void }),
    reload: () => Effect.void,
    list: () => Effect.succeed([]),
  }),
)
const outboundMCP = Layer.succeed(
  Mcp.Service,
  Mcp.Service.of({
    tools: () => Effect.succeed([]),
    callTool: ({ server }) => Effect.fail(new Mcp.NotFoundError({ server })),
    servers: () => Effect.succeed([]),
    instructions: () => Effect.succeed([]),
    authorize: () => Effect.die("unused"),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    test: () => Effect.void,
    transform: () => Effect.succeed({ dispose: Effect.void }),
    reload: () => Effect.void,
  }),
)
const defaultConfig = Schema.decodeUnknownSync(ConfigSchema.Info)({})
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    provider: { update: () => Effect.die("unused") },
    model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    get: Effect.succeed(defaultConfig),
    update: (input) => Schema.decodeUnknownEffect(ConfigSchema.Info)(input).pipe(Effect.orDie),
    refresh: Effect.succeed(defaultConfig),
    mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
    modelPolicy: {
      reconcile: () => Effect.die("unused"),
      initialize: () => Effect.die("unused"),
      toggle: () => Effect.die("unused"),
      setDefault: () => Effect.die("unused"),
    },
    plugin: Config.pluginUnavailable,
    entries: () => Effect.succeed([{ type: "document", info: defaultConfig }]),
    changes: () => Stream.never,
  }),
)
const titleModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
const titleAgent = AgentSchema.Info.make({ ...selectedAgent, model: titleModel })
const titleAgents = Layer.succeed(
  Agent.Service,
  agentService({
    list: Effect.succeed([titleAgent]),
    get: () => Effect.succeed(titleAgent),
    resolve: Effect.succeed(titleAgent),
    create: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
  }),
)
const withProviderStream = (stream: Provider.Interface["stream"]) =>
  Layer.effect(
    Provider.Service,
    Provider.Service.use((provider) => Effect.succeed(Provider.Service.of({ ...provider, stream }))),
  ).pipe(Layer.provide(Provider.layer))
const scopedTools = (workspaceID: Workspace.ID, get?: Parameters<typeof Binding.make>[1]) =>
  Layer.merge(
    Tool.layer,
    Layer.effectDiscard(
      Effect.gen(function* () {
        const tools = yield* Tool.Service
        const database = yield* Database.Service
        const binding = yield* Binding.make(
          workspaceID,
          get ??
            ((sessionID) =>
              database
                .use("builtinCaller", (db) =>
                  db
                    .select({ id: SessionTable.id, projectID: SessionTable.projectID })
                    .from(SessionTable)
                    .where(and(eq(SessionTable.workspaceID, workspaceID), eq(SessionTable.id, sessionID)))
                    .limit(1),
                )
                .pipe(
                  Effect.orDie,
                  Effect.flatMap((rows) =>
                    rows[0] === undefined
                      ? Effect.fail(new Tool.Error({ message: "Session Tool caller is unavailable" }))
                      : Effect.succeed(rows[0]),
                  ),
                )),
        )
        const instructions = yield* makeInstructions(workspaceID)
        const definitions = yield* Effect.all([
          Effect.succeed(AddTool),
          makeGlob,
          Binding.bind(GrepTool),
          makeRead,
          Binding.bind(WriteTool),
          Binding.bind(EditTool),
          Binding.bind(ExecuteTool),
          makeWebSearch,
          makeSkill,
        ]).pipe(Effect.provideService(Binding.Service, binding), Effect.provideService(Instructions, instructions))
        yield* tools.transform((editor) => {
          for (const tool of definitions) editor.add(tool)
        })
      }),
    ).pipe(Layer.provide(Tool.layer), Layer.orDie),
  ).pipe(Layer.provide(PluginHooks.layer))
const sessionEvents = (events: Bus.Interface, sessionID: SessionSchema.ID) =>
  events.subscribe(SessionEvent.Definitions).pipe(
    Effect.map((stream) => stream.pipe(Stream.filter((event) => event.data.sessionID === sessionID))),
  )
const followSession = (
  events: Bus.Interface,
  sessionID: SessionSchema.ID,
  stop: (event: SessionEvent.Payload) => boolean,
) =>
  Effect.gen(function* () {
    const stream = yield* sessionEvents(events, sessionID)
    return yield* stream.pipe(Stream.takeUntil(stop), Stream.runCollect, Effect.forkScoped)
  })
const failureOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.exit,
    Effect.flatMap((exit) =>
      Exit.isFailure(exit)
        ? Effect.succeed(Cause.squash(exit.cause))
        : Effect.die(new Error("Expected operation to fail")),
    ),
  )
const insertAssistant = (
  database: Database.Interface,
  session: SessionSchema.Info,
  id: MessageID,
  model: ModelSchema.Ref = session.model,
) =>
  database.transactRoot(
    database.use("sessionAssistantFixture", (db) =>
      Effect.gen(function* () {
        const [position] = yield* db
          .update(SessionTable)
          .set({ sequence: sql`${SessionTable.sequence} + 1` })
          .where(eq(SessionTable.id, session.id))
          .returning({ sequence: SessionTable.sequence })
        if (position === undefined) return yield* Effect.die(new Error("Session fixture missing"))
        const now = yield* DateTime.nowAsDate
        const message = Assistant.make({
          id,
          sessionID: session.id,
          sequence: position.sequence,
          type: "assistant",
          agent: session.agent,
          model,
          content: [],
          time: { created: now },
          usage: emptyUsage,
          createdAt: now,
        })
        yield* db.insert(SessionMessageTable).values({
          id,
          sessionID: session.id,
          sequence: message.sequence,
          type: message.type,
          data: message,
          timeCreated: now,
          timeUpdated: now,
        })
        return message
      }),
    ),
  )
const maximumStepHeading = maximumStepPrompt.slice(0, maximumStepPrompt.indexOf("\n"))

// Usage records deliberately outlive Sessions. Remove only this scenario's
// records at scope close so subsequent ranking/pagination fixtures stay isolated.
const cleanupUsage = (ids: ReadonlyArray<CoreUsageSchema.ID>) =>
  Database.Service.use((database) =>
    Effect.addFinalizer(() =>
      database
        .use("cleanupUsageFixture", (db) => db.delete(UsageTable).where(inArray(UsageTable.id, [...ids])))
        .pipe(Effect.orDie),
    ),
  )

const builtInAgent = (plugin: Plugin, id: AgentSchema.ID, model: ModelSchema.Ref) =>
  Effect.gen(function* () {
    const profile = {
      id,
      name: AgentSchema.Name.make(id),
      instructions: "",
      model,
      mode: "primary" as const,
      hidden: false,
      steps: 5,
      permissions: [],
    } satisfies Types.DeepMutable<AgentSchema.Info>
    // No saved Workspace record exists for the identity, so the plugin seeds
    // its shipped definition onto this profile.
    const editor = {
      list: () => [profile],
      get: () => undefined,
      default: () => undefined,
      update: (target: string, update: (agent: Types.DeepMutable<AgentSchema.Info>) => void) => {
        if (target === id) update(profile)
      },
      remove: () => undefined,
    } satisfies AgentEditor
    yield* plugin.effect({
      agent: {
        transform: (callback: (editor: AgentEditor) => void) =>
          Effect.sync(() => callback(editor)).pipe(Effect.as({ dispose: Effect.void })),
      },
    } as unknown as PluginContext)
    return AgentSchema.Info.make(profile)
  }).pipe(Effect.scoped)

/** The verified member the Session graph is constructed for; Usage reloads it through User before each request. */
const memberBinding = (workspaceID: Workspace.ID, owner: typeof ownerA) =>
  Layer.succeed(Actor.Binding.Service, { workspaceID, ...owner })

const makeLayer = (
  workspaceID: Workspace.ID,
  providerLayer: Layer.Layer<Provider.Service> = Provider.layer,
  agentLayer: Layer.Layer<Agent.Service> = agents,
  instructionLayer: Layer.Layer<SkillInstruction.Service> = defaultInstruction,
  skillLayer: Layer.Layer<Skill.Service> = skills,
  configLayer: Layer.Layer<Config.Service> = config,
  sessionToolsLayer?: Layer.Layer<SessionTools.Service>,
  interpreterLayer: Layer.Layer<CodeInterpreter.Service> = CodeInterpreter.unavailable,
) => {
  const database = Database.layer.pipe(Layer.provide(PgClient.layer({ url: Redacted.make(databaseURL) })))
  const owner = workspaceID === workspaceA ? ownerA : ownerB
  const binding = memberBinding(workspaceID, owner)
  const users = UserService.layer.pipe(Layer.provide(database))
  const entries = InstructionEntry.layer(workspaceID).pipe(Layer.provide(database))
  const busRuntime = Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
  const discovery = InstructionDiscovery.layer().pipe(Layer.provide(busRuntime))
  const permission = permissionLayer(workspaceID).pipe(
    Layer.provide(Layer.mergeAll(agentLayer, configLayer, database, busRuntime)),
  )
  const inbox = SessionInbox.layer(workspaceID).pipe(
    Layer.provide(busRuntime),
    Layer.provide(Layer.mergeAll(database, NodeCrypto.layer)),
  )
  const storage = storageLayer
  const project = Project.layer(workspaceID).pipe(Layer.provide(Layer.mergeAll(database, busRuntime, storage)))
  const toolOutput = ToolOutput.layer(workspaceID).pipe(Layer.provide(Layer.merge(configLayer, storage)))
  const hooks = PluginHooks.layer
  const jobs = Job.layer
  let sessionGetter: Session.Interface["get"] = () => Effect.die("Session fixture is not installed")
  const builtin = scopedTools(workspaceID, (id) =>
    Effect.suspend(() => sessionGetter(id)).pipe(
      Effect.mapError((error) => new Tool.Error({ message: "Session Tool caller is unavailable", error })),
    ),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        database,
        busRuntime,
        skillLayer,
        references,
        websearch,
        Form.layer.pipe(Layer.provide(busRuntime)),
        storage,
        interpreterLayer,
        NodeCrypto.layer,
      ),
    ),
  )
  const sessionTools =
    sessionToolsLayer ??
    SessionTools.layer(workspaceID).pipe(
      Layer.provide(interpreterLayer),
      Layer.provide(
        Layer.mergeAll(
          agentLayer,
          builtin,
          hooks,
          websearch,
          skillLayer,
          permission,
          busRuntime,
          database,
          NodeCrypto.layer,
          references,
          Form.layer.pipe(Layer.provide(busRuntime)),
          storage,
        ),
      ),
    )
  const resolver = Layer.effect(
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
              Effect.mapError(() => new ModelResolver.ResolutionError({ model: input.model, reason: "unknown-model" })),
            ),
        }),
      ),
    ),
  ).pipe(Layer.provide(Model.layer))
  const catalog = Layer.effect(
    Catalog.Service,
    Effect.gen(function* () {
      const workspaceConfig = yield* Config.Service
      const models = yield* Model.Service
      return Catalog.Service.of({
        transform: () => Effect.die("unused"),
        reload: () => Effect.die("unused"),
        provider: {
          get: () => Effect.die("unused"),
          all: () => Effect.die("unused"),
          available: () => Effect.die("unused"),
          directory: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        },
        model: {
          get: () => Effect.die("unused"),
          all: () => Effect.die("unused"),
          available: () => Effect.die("unused"),
          visible: () => Effect.die("unused"),
          requireAvailable: () => Effect.die("unused"),
          requireExecution: () => Effect.die("unused"),
          toggle: () => Effect.die("unused"),
          setDefault: () => Effect.die("unused"),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
          delete: () => Effect.die("unused"),
          default: () =>
            Effect.gen(function* () {
              const selected = (yield* workspaceConfig.get).default_model
              if (selected === undefined) return undefined
              const listed = yield* models.list
              const template = listed[0]
              return template === undefined ? undefined : { ...template, provider: selected.provider, id: selected.id }
            }),
        },
      })
    }),
  ).pipe(Layer.provide(Layer.merge(configLayer, Model.layer)))
  const execution = SessionExecution.layer(workspaceID).pipe(
    Layer.provide(
      Layer.mergeAll(
        agentLayer,
        binding,
        users,
        database,
        busRuntime,
        permission,
        sessionTools,
        instructionLayer,
        discovery,
        references,
        outboundMCP,
        entries,
        Model.layer,
        resolver,
        providerLayer,
        configLayer,
        storage,
        toolOutput,
        hooks,
        jobs,
      ),
    ),
  )
  const session = Session.layer(workspaceID, owner).pipe(
    Layer.provide(references),
    Layer.provide(outboundMCP),
    Layer.provide(
      Layer.mergeAll(
        execution,
        agentLayer,
        database,
        busRuntime,
        inbox,
        permission,
        project,
        sessionTools,
        instructionLayer,
        discovery,
        entries,
        Model.layer,
        resolver,
        catalog,
        providerLayer,
        configLayer,
        storage,
        toolOutput,
        hooks,
        jobs,
      ),
    ),
    Layer.provide(NodeCrypto.layer),
  )
  return Layer.mergeAll(
    session,
    Layer.effectDiscard(
      Session.Service.use((service) =>
        Effect.gen(function* () {
          sessionGetter = service.get
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              sessionGetter = () => Effect.die("Session fixture is closed")
            }),
          )
        }),
      ),
    ).pipe(Layer.provide(session)),
    builtin,
    inbox,
    project,
    entries,
    discovery,
    busRuntime,
    database,
    storage,
    permission,
    hooks,
    sessionTools,
    toolOutput,
    jobs,
    references,
    outboundMCP,
    configLayer,
    NodeCrypto.layer,
  )
}

const makeRunnerDependencies = (
  workspaceID: Workspace.ID,
  providerLayer: Layer.Layer<Provider.Service> = Provider.layer,
  agentLayer: Layer.Layer<Agent.Service> = agents,
  instructionLayer: Layer.Layer<SkillInstruction.Service> = defaultInstruction,
  sessionToolsLayer?: Layer.Layer<SessionTools.Service>,
  toolLayer?: Layer.Layer<Tool.Service, never, PluginHooks.Service>,
) => {
  const database = Database.layer.pipe(Layer.provide(PgClient.layer({ url: Redacted.make(databaseURL) })))
  const binding = memberBinding(workspaceID, workspaceID === workspaceA ? ownerA : ownerB)
  const users = UserService.layer.pipe(Layer.provide(database))
  const entries = InstructionEntry.layer(workspaceID).pipe(Layer.provide(database))
  const busRuntime = Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
  const discovery = InstructionDiscovery.layer().pipe(Layer.provide(busRuntime))
  const permission = permissionLayer(workspaceID).pipe(
    Layer.provide(Layer.mergeAll(agentLayer, config, database, busRuntime)),
  )
  const storage = storageLayer
  const project = Project.layer(workspaceID).pipe(Layer.provide(Layer.mergeAll(database, busRuntime, storage)))
  const toolOutput = ToolOutput.layer(workspaceID).pipe(Layer.provide(Layer.merge(config, storage)))
  const hooks = PluginHooks.layer
  const builtin =
    toolLayer ??
    scopedTools(workspaceID).pipe(
      Layer.provide(
        Layer.mergeAll(
          database,
          busRuntime,
          skills,
          references,
          websearch,
          Form.layer.pipe(Layer.provide(busRuntime)),
          storage,
          CodeInterpreter.unavailable,
          NodeCrypto.layer,
        ),
      ),
    )
  const sessionTools =
    sessionToolsLayer ??
    SessionTools.layer(workspaceID).pipe(
      Layer.provide(CodeInterpreter.unavailable),
      Layer.provide(
        Layer.mergeAll(
          agentLayer,
          builtin.pipe(Layer.provide(hooks)),
          hooks,
          websearch,
          skills,
          permission,
          busRuntime,
          database,
          NodeCrypto.layer,
          references,
          Form.layer.pipe(Layer.provide(busRuntime)),
          storage,
        ),
      ),
    )
  const inbox = SessionInbox.layer(workspaceID).pipe(
    Layer.provide(busRuntime),
    Layer.provide(Layer.mergeAll(database, NodeCrypto.layer)),
  )
  const resolver = Layer.effect(
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
              Effect.mapError(() => new ModelResolver.ResolutionError({ model: input.model, reason: "unknown-model" })),
            ),
        }),
      ),
    ),
  ).pipe(Layer.provide(Model.layer))
  return Layer.mergeAll(
    agentLayer,
    binding,
    users,
    database,
    busRuntime,
    inbox,
    permission,
    hooks,
    sessionTools,
    websearch,
    skills,
    instructionLayer,
    discovery,
    project,
    entries,
    references,
    outboundMCP,
    Model.layer,
    resolver,
    providerLayer,
    config,
    storage,
    toolOutput,
    NodeCrypto.layer,
  )
}

beforeAll(async () => {
  await Effect.runPromise(
    PgClient.PgClient.use((sql) =>
      sql.unsafe(
        `INSERT INTO workspace (id, name, status) VALUES
         ('${workspaceA}', 'Session A', 'active'),
         ('${workspaceB}', 'Session B', 'active');
       INSERT INTO account (id, status) VALUES
         ('${ownerA.accountID}', 'active'), ('${ownerB.accountID}', 'active');
       INSERT INTO "user" (id, workspace_id, account_id, role) VALUES
         ('${ownerA.userID}', '${workspaceA}', '${ownerA.accountID}', 'admin'),
         ('${ownerB.userID}', '${workspaceB}', '${ownerB.accountID}', 'admin');
       INSERT INTO project (workspace_id, id, name) VALUES
          ('${workspaceA}', '${projectID}', 'Default'),
          ('${workspaceB}', '${projectID}', 'Default');
        INSERT INTO session (id, workspace_id, user_id, project_id, agent, model) VALUES
           ('${sessionA}', '${workspaceA}', '${ownerA.userID}', '${projectID}', 'build', '{"provider":"initial","id":"initial"}'),
           ('${sessionB}', '${workspaceB}', '${ownerB.userID}', '${projectID}', 'build', '{"provider":"initial","id":"initial"}');`,
      ),
    ).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(databaseURL), maxConnections: 1 })), Effect.scoped),
  )
  layerA = makeLayer(workspaceA)
  layerB = makeLayer(workspaceB)
})

describe("PostgreSQL Session Workspace isolation", () => {
  effectIt.effect("admits the prompt prepared by a registered Session hook without mutating its caller", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const hooks = yield* PluginHooks.Service
        const created = yield* sessions.create({ projectID })
        const input = { sessionID: created.id, text: "original", metadata: { source: "caller" }, resume: false }
        yield* hooks.register("session", "prompt", (event) =>
          Effect.sync(() => {
            event.prompt.text = "prepared"
            event.prompt.metadata = { source: "plugin" }
          }),
        )

        const admitted = yield* sessions.prompt(input)
        expect(admitted).toMatchObject({ text: "prepared", metadata: { source: "plugin" } })
        expect(input).toEqual({ sessionID: created.id, text: "original", metadata: { source: "caller" }, resume: false })
        expect(yield* sessions.inbox(created.id)).toMatchObject([
          { id: admitted.id, payload: { text: "prepared", metadata: { source: "plugin" } } },
        ])
      }).pipe(Effect.provide(layerA)),
    ),
  )

  effectIt.effect("backgrounds only this session's blockers and admits exact unfinished-work guidance", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const events = yield* Bus.Service
      const parent = yield* sessions.create({ projectID })
      const other = yield* sessions.create({ projectID })
      const release = yield* Deferred.make<void>()
      const titled = yield* jobs.start({
        id: "background_titled",
        type: "subagent",
        title: "Review changes",
        run: Deferred.await(release).pipe(Effect.as("reviewed")),
      })
      const untitled = yield* jobs.start({
        id: "background_untitled",
        type: "shell",
        run: Deferred.await(release).pipe(Effect.as("built")),
      })
      const unrelated = yield* jobs.start({
        id: "background_unrelated",
        type: "subagent",
        title: "Other session",
        run: Deferred.await(release).pipe(Effect.as("other")),
      })
      const titledBlock = yield* jobs.block({ id: titled.id, sessionID: parent.id }).pipe(Effect.forkChild)
      const untitledBlock = yield* jobs.block({ id: untitled.id, sessionID: parent.id }).pipe(Effect.forkChild)
      const unrelatedBlock = yield* jobs.block({ id: unrelated.id, sessionID: other.id }).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      const admittedStream = yield* events.subscribe(SessionEvent.SyntheticAdmitted)
      const admitted = yield* admittedStream.pipe(
        Stream.filter((event) => event.data.sessionID === parent.id),
        Stream.take(1),
        Stream.runHead,
        Effect.forkChild,
      )

      yield* sessions.background(parent.id)

      expect(yield* Fiber.join(titledBlock)).toMatchObject({ type: "backgrounded", info: { id: titled.id } })
      expect(yield* Fiber.join(untitledBlock)).toMatchObject({ type: "backgrounded", info: { id: untitled.id } })
      expect(yield* jobs.backgroundAll({ sessionID: parent.id })).toEqual([])
      expect(yield* jobs.backgroundAll({ sessionID: other.id })).toMatchObject([{ id: unrelated.id }])
      expect(yield* Fiber.join(unrelatedBlock)).toMatchObject({ type: "backgrounded", info: { id: unrelated.id } })
      expect(Option.getOrUndefined(yield* Fiber.join(admitted))?.data).toMatchObject({
        sessionID: parent.id,
        item: {
          delivery: "steer",
          payload: {
          text: [
            "User requested that active blocking work be moved to the background.",
            "",
            "Backgrounded work:",
            "- subagent: Review changes",
            "- shell: background_untitled",
            "",
            "The backgrounded work is still unfinished. Move on to other work if you can. If there is nothing else useful to do, finish your response. Do not wait, sleep, poll, or report the backgrounded work as complete until a later completion notification is added to the conversation.",
          ].join("\n"),
          },
        },
      })

      const idle = yield* sessions.create({ projectID })
      yield* sessions.background(idle.id)
      expect(yield* sessions.inbox(idle.id)).toEqual([])
      yield* Deferred.succeed(release, undefined)
    }).pipe(Effect.provide(layerA)),
  )

  it("persists isolated Instruction Entry tombstones, resurrection, unchanged puts, and cascades", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const database = yield* Database.Service
        const created = yield* sessions.create({ projectID })
        const entries = yield* InstructionEntry.Service
        const key = InstructionEntry.Key.make("build.context")

        expect(yield* entries.list(created.id)).toEqual([])
        yield* entries.put({ sessionID: created.id, key, value: { b: 2, a: 1 } })
        const before = yield* database.use("instructionEntryBefore", (db) =>
          db
            .select()
            .from(InstructionEntryTable)
            .where(and(eq(InstructionEntryTable.sessionID, created.id), eq(InstructionEntryTable.key, key))),
        )
        yield* entries.put({ sessionID: created.id, key, value: { a: 1, b: 2 } })
        const unchanged = yield* database.use("instructionEntryUnchanged", (db) =>
          db
            .select()
            .from(InstructionEntryTable)
            .where(and(eq(InstructionEntryTable.sessionID, created.id), eq(InstructionEntryTable.key, key))),
        )
        expect(unchanged[0]?.timeUpdated).toEqual(before[0]?.timeUpdated)
        expect(yield* entries.list(created.id)).toEqual([{ key, value: { a: 1, b: 2 } }])

        const [active] = yield* entries.load(created.id)
        expect(active?.initial({ a: 1, b: 2 })).toBe(
          '<context key="build.context">\n{\n  "a": 1,\n  "b": 2\n}\n</context>',
        )
        yield* entries.remove({ sessionID: created.id, key })
        yield* entries.remove({ sessionID: created.id, key })
        expect(yield* entries.list(created.id)).toEqual([])
        expect(yield* (yield* entries.load(created.id))[0]?.read).toBe(Instruction.removed)
        yield* entries.put({ sessionID: created.id, key, value: "restored" })
        expect(yield* entries.list(created.id)).toEqual([{ key, value: "restored" }])

        const exact = "x".repeat(InstructionEntry.MaxBytes - 2)
        yield* entries.put({ sessionID: created.id, key, value: exact })
        expect((yield* entries.list(created.id))[0]?.value).toBe(exact)
        const oversized = yield* entries
          .put({ sessionID: created.id, key, value: "x".repeat(InstructionEntry.MaxBytes - 1) })
          .pipe(Effect.flip)
        expect(oversized).toMatchObject({
          _tag: "InstructionEntry.SizeError",
          actualBytes: InstructionEntry.MaxBytes + 1,
          maxBytes: InstructionEntry.MaxBytes,
        })

        const missing = SessionSchema.ID.make("00000000-0000-4000-8000-000000000699")
        for (const [sessionID, run] of [
          [missing, entries.list(missing)],
          [missing, entries.put({ sessionID: missing, key, value: "missing" })],
          [missing, entries.remove({ sessionID: missing, key })],
          [missing, entries.load(missing)],
          [sessionB, entries.list(sessionB)],
          [sessionB, entries.put({ sessionID: sessionB, key, value: "foreign" })],
          [sessionB, entries.remove({ sessionID: sessionB, key })],
          [sessionB, entries.load(sessionB)],
        ] as const) {
          const failure = yield* run.pipe(Effect.flip)
          expect(failure).toMatchObject({ _tag: "Session.NotFoundError", sessionID })
        }
        yield* database.use("instructionEntryCascade", (db) =>
          db.delete(SessionTable).where(eq(SessionTable.id, created.id)),
        )
        expect(
          yield* database.use("instructionEntryCascaded", (db) =>
            db.select().from(InstructionEntryTable).where(eq(InstructionEntryTable.sessionID, created.id)),
          ),
        ).toEqual([])
      }).pipe(Effect.provide(layerA)),
    )
  }, 20_000)

  it("supports Project CRUD, patch clears, stable listing, and Workspace isolation", async () => {
    const created = await Effect.runPromise(
      Project.Service.use((projects) =>
        projects.create({
          name: "Source",
          icon: {
            url: new URL("https://example.com/icon.svg"),
            override: new URL("https://example.com/override.svg"),
            color: "blue",
          },
        }),
      ).pipe(Effect.provide(layerA)),
    )
    const listed = await Effect.runPromise(
      Project.Service.use((projects) => projects.list()).pipe(Effect.provide(layerA)),
    )
    expect(created).toMatchObject({ time_created: expect.any(Number), time_updated: expect.any(Number) })
    expect(created).not.toHaveProperty("time")
    expect(listed.map((project) => project.id)).toContain(created.id)
    await expect(
      Effect.runPromise(Project.Service.use((projects) => projects.get(created.id)).pipe(Effect.provide(layerB))),
    ).rejects.toMatchObject({ _tag: "Project.NotFoundError", projectID: created.id })

    const renamed = await Effect.runPromise(
      Project.Service.use((projects) => projects.update({ projectID: created.id, name: "Renamed" })).pipe(
        Effect.provide(layerA),
      ),
    )
    expect(renamed.icon).toEqual(created.icon)

    const replaced = await Effect.runPromise(
      Project.Service.use((projects) => projects.update({ projectID: created.id, icon: { color: "green" } })).pipe(
        Effect.provide(layerA),
      ),
    )
    expect(replaced.name).toBe("Renamed")
    expect(replaced.icon).toEqual({ color: "green" })

    const updated = await Effect.runPromise(
      Project.Service.use((projects) => projects.update({ projectID: created.id, name: null, icon: null })).pipe(
        Effect.provide(layerA),
      ),
    )
    expect(updated.name).toBeUndefined()
    expect(updated.icon).toBeUndefined()
    await Effect.runPromise(Project.Service.use((projects) => projects.delete(created.id)).pipe(Effect.provide(layerA)))
    await expect(
      Effect.runPromise(Project.Service.use((projects) => projects.get(created.id)).pipe(Effect.provide(layerA))),
    ).rejects.toMatchObject({ _tag: "Project.NotFoundError", projectID: created.id })
  })

  effectIt.effect("archives a Project read-only and hidden with its Sessions, and restores it unchanged", () =>
    Effect.gen(function* () {
      const projects = yield* Project.Service
      const sessions = yield* Session.Service
      const project = yield* projects.create({ name: "Launch" })
      const session = yield* sessions.create({ projectID: project.id })
      const archivedSession = yield* sessions.create({ projectID: project.id })
      yield* sessions.update({ sessionID: archivedSession.id, archived: true })
      const listedIDs = (input?: Parameters<Session.Interface["list"]>[0]) =>
        sessions.list({ limit: 100, ...input }).pipe(Effect.map((page) => page.data.map((item) => item.id)))
      expect(yield* listedIDs()).toContain(session.id)

      const archived = yield* projects.update({ projectID: project.id, archived: true })
      expect(archived.archivedAt).toBeInstanceOf(Date)
      expect(archived.name).toBe("Launch")
      // Archiving again keeps the original archive time.
      expect((yield* projects.update({ projectID: project.id, archived: true })).archivedAt).toEqual(archived.archivedAt)
      // Still addressable, but hidden from the default list and shown only in the archived list.
      expect((yield* projects.get(project.id)).archivedAt).toEqual(archived.archivedAt)
      expect((yield* projects.list()).map((item) => item.id)).not.toContain(project.id)
      expect((yield* projects.list({ archived: false })).map((item) => item.id)).not.toContain(project.id)
      expect((yield* projects.list({ archived: true })).map((item) => item.id)).toEqual([project.id])

      // Its Sessions leave every Session list except the archived one, and stay addressable.
      expect(yield* listedIDs()).not.toContain(session.id)
      expect(yield* listedIDs({ archived: false, parentID: null })).not.toContain(session.id)
      expect(yield* listedIDs({ archived: true })).toContain(archivedSession.id)
      expect((yield* sessions.get(session.id)).id).toBe(session.id)

      // Read-only: no Session can be created in it and its Sessions accept no new Messages.
      expect(yield* failureOf(sessions.create({ projectID: project.id }))).toMatchObject({
        _tag: "Project.ArchivedError",
        projectID: project.id,
      })
      expect(yield* failureOf(sessions.prompt({ sessionID: session.id, text: "hello", resume: false }))).toMatchObject({
        _tag: "Project.ArchivedError",
        projectID: project.id,
      })
      expect(yield* sessions.inbox(session.id)).toEqual([])

      const restored = yield* projects.update({ projectID: project.id, archived: false })
      expect(restored.archivedAt).toBeUndefined()
      expect((yield* projects.list()).map((item) => item.id)).toContain(project.id)
      expect(yield* listedIDs()).toContain(session.id)
      expect(yield* listedIDs({ archived: true })).toContain(archivedSession.id)
      yield* sessions.prompt({ sessionID: session.id, text: "hello again", resume: false })
      expect((yield* sessions.inbox(session.id)).map((item) => item.payload)).toMatchObject([{ text: "hello again" }])
      expect((yield* sessions.create({ projectID: project.id })).projectID).toBe(project.id)
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("refuses to archive the Default Project", () =>
    Effect.gen(function* () {
      const projects = yield* Project.Service
      // The Workspace's first Project is its Default Project.
      expect(yield* failureOf(projects.update({ projectID, archived: true }))).toMatchObject({
        _tag: "Project.DefaultError",
        projectID,
      })
      expect((yield* projects.get(projectID)).archivedAt).toBeUndefined()
      expect((yield* projects.list()).map((item) => item.id)).toContain(projectID)
      // Restoring or renaming the Default Project is not refused.
      expect((yield* projects.update({ projectID, archived: false })).archivedAt).toBeUndefined()
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("keeps repeated null Instruction Entry puts active and unchanged", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const entries = yield* InstructionEntry.Service
      const created = yield* sessions.create({ projectID })
      const key = InstructionEntry.Key.make("null.context")

      yield* entries.put({ sessionID: created.id, key, value: null })
      yield* database.use("instructionEntryNullPinTime", (db) =>
        db
          .update(InstructionEntryTable)
          .set({ timeUpdated: new Date(0) })
          .where(and(eq(InstructionEntryTable.sessionID, created.id), eq(InstructionEntryTable.key, key))),
      )
      const [before] = yield* database.use("instructionEntryNullBefore", (db) =>
        db
          .select()
          .from(InstructionEntryTable)
          .where(and(eq(InstructionEntryTable.sessionID, created.id), eq(InstructionEntryTable.key, key))),
      )
      yield* entries.put({ sessionID: created.id, key, value: null })
      const [unchanged] = yield* database.use("instructionEntryNullUnchanged", (db) =>
        db
          .select()
          .from(InstructionEntryTable)
          .where(and(eq(InstructionEntryTable.sessionID, created.id), eq(InstructionEntryTable.key, key))),
      )

      expect(unchanged?.timeUpdated).toEqual(before?.timeUpdated)
      expect(unchanged).toMatchObject({ value: null, removed: false })
      expect(yield* entries.list(created.id)).toEqual([{ key, value: null }])
      expect(yield* (yield* entries.load(created.id))[0]?.read).toBeNull()
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("publishes each committed Project create and update once in its Workspace", () =>
    Effect.gen(function* () {
      const projects = yield* Project.Service
      const database = yield* Database.Service
      const storage = yield* Storage.Service
      const events = yield* Bus.Service
      const ownStream = yield* events.subscribe(ProjectSchema.Updated)
      const own = yield* ownStream.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
      yield* Effect.yieldNow

      const updated = yield* database.transact(
        Effect.gen(function* () {
          const created = yield* projects.create({ name: "Event source" })
          const updated = yield* projects.update({ projectID: created.id, name: "Event updated" })
          expect(own.pollUnsafe()).toBeUndefined()
          return updated
        }),
      )

      const published = [...(yield* Fiber.join(own))]
      expect(published.map((event) => event.type)).toEqual(["project.updated", "project.updated"])
      expect(published.map((event) => event.data.project.name)).toEqual(["Event source", "Event updated"])
      expect(published.map((event) => event.data.project.id)).toEqual([updated.id, updated.id])
      expect(Option.isSome(yield* storage.object.get([{ workspaces: workspaceA }, { projects: updated.id }]))).toBe(
        true,
      )
    }).pipe(Effect.scoped, Effect.provide(layerA)),
  )

  effectIt.effect("does not publish a Project update from a rolled-back transaction", () =>
    Effect.gen(function* () {
      const projects = yield* Project.Service
      const database = yield* Database.Service
      const storage = yield* Storage.Service
      const events = yield* Bus.Service
      const receivedStream = yield* events.subscribe(ProjectSchema.Updated)
      const received = yield* receivedStream.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
      yield* Effect.yieldNow

      const project = yield* database
        .transact(
          Effect.gen(function* () {
            const created = yield* projects.create({ name: "Rolled back" })
            return yield* Effect.fail(created)
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die), Effect.flip)
      yield* Effect.yieldNow

      expect(received.pollUnsafe()).toBeUndefined()
      expect(yield* projects.list()).not.toContainEqual(project)
      expect(Option.isNone(yield* storage.object.get([{ workspaces: workspaceA }, { projects: project.id }]))).toBe(
        true,
      )
    }).pipe(Effect.scoped, Effect.provide(layerA)),
  )

  effectIt.effect("publishes a Project deletion only after its transaction commits", () =>
    Effect.gen(function* () {
      const projects = yield* Project.Service
      const database = yield* Database.Service
      const events = yield* Bus.Service
      const project = yield* projects.create({ name: "Deleted event source" })
      const receivedStream = yield* events.subscribe(ProjectSchema.Deleted)
      const received = yield* receivedStream.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
      yield* Effect.yieldNow

      yield* database.transact(
        Effect.gen(function* () {
          yield* projects.delete(project.id)
          expect(received.pollUnsafe()).toBeUndefined()
        }),
      )

      expect([...(yield* Fiber.join(received))]).toEqual([
        expect.objectContaining({ type: "project.deleted", data: { projectID: project.id } }),
      ])
    }).pipe(Effect.scoped, Effect.provide(layerA)),
  )

  effectIt.effect("returns Project NotFound for missing and foreign Project Session creation", () =>
    Effect.gen(function* () {
      const foreign = yield* Project.Service.use((projects) =>
        projects.create({ name: "Foreign session project" }),
      ).pipe(Effect.provide(layerB))
      const missingID = ProjectSchema.ID.create()
      const errors = yield* Session.Service.use((sessions) =>
        Effect.all([
          failureOf(sessions.create({ projectID: missingID })),
          failureOf(sessions.create({ projectID: foreign.id })),
        ]),
      ).pipe(Effect.provide(layerA))

      expect(errors).toEqual([
        new Project.NotFoundError({ projectID: missingID }),
        new Project.NotFoundError({ projectID: foreign.id }),
      ])
    }),
  )

  effectIt.effect("retains a Project and Session when restricted Project deletion fails", () =>
    Effect.gen(function* () {
      const projects = yield* Project.Service
      const sessions = yield* Session.Service
      const events = yield* Bus.Service
      const database = yield* Database.Service
      const project = yield* projects.create({ name: "Referenced" })
      const session = yield* sessions.create({ projectID: project.id })
      const receivedStream = yield* events.subscribe(ProjectSchema.Deleted)
      const received = yield* receivedStream.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild)
      yield* Effect.yieldNow

      const deletion = yield* projects.delete(project.id).pipe(Effect.exit)
      yield* Effect.yieldNow

      expect(Exit.isFailure(deletion)).toBe(true)
      if (Exit.isFailure(deletion)) expect(Cause.hasDies(deletion.cause)).toBe(true)
      expect(received.pollUnsafe()).toBeUndefined()
      expect((yield* projects.get(project.id)).id).toBe(project.id)
      expect((yield* sessions.get(session.id)).projectID).toBe(project.id)
    }).pipe(Effect.scoped, Effect.provide(layerA)),
  )

  effectIt.effect("wakes active followers for admission, promotion, and execution start commits", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const events = yield* Bus.Service
      const inbox = yield* SessionInbox.Service
      const created = yield* sessions.create({ projectID })
      const log = yield* sessionEvents(events, created.id)
      const expected = new Set<string>([
        SessionEvent.InputAdmitted.type,
        SessionEvent.InputPromoted.type,
        SessionEvent.ExecutionStarted.type,
      ])
      const follower = yield* log.pipe(
        Stream.filter((item) => expected.has(item.type)),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkScoped,
      )

      yield* sessions.prompt({
        sessionID: created.id,
        id: MessageID.make(crypto.randomUUID()),
        text: "follow promptly",
        resume: false,
      })
      yield* inbox.deliver(created.id)

      const followed = yield* Fiber.join(follower)
      expect([...followed].map((event) => event.type)).toEqual([
        "session.input.admitted",
        "session.input.promoted",
        "session.execution.started",
      ])
    }).pipe(Effect.scoped, Effect.provide(layerA)),
  )

  it("generates a fresh Session ID on every execution of the reusable create Effect", async () => {
    const created = await Effect.runPromise(
      Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const create = sessions.create({ projectID })
          const first = yield* create
          const second = yield* create
          return [first, second] as const
        }),
      ).pipe(Effect.provide(layerA)),
    )

    expect(created[0].id).not.toBe(created[1].id)
    expect(created.map((session) => session.agent)).toEqual([AgentSchema.DefaultID, AgentSchema.DefaultID])
  })

  it("creates Sessions with selected Agent and Model fallback semantics without replacing unknown IDs", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const created = yield* Effect.all({
          defaults: sessions.create({ projectID }),
          agent: sessions.create({ projectID, agent: requestedAgent.id }),
          model: sessions.create({ projectID, model: selectedModel }),
          both: sessions.create({ projectID, agent: requestedAgent.id, model: selectedModel }),
        })
        const missingID = AgentSchema.ID.make("missing")
        const missingAgent = yield* sessions.create({ projectID, agent: missingID, model: initialModel })

        expect(created.defaults).toMatchObject({ agent: selectedAgent.id, model: initialModel })
        expect(created.agent).toMatchObject({ agent: requestedAgent.id, model: requestedAgent.model })
        expect(created.model).toMatchObject({ agent: selectedAgent.id, model: selectedModel })
        expect(created.both).toMatchObject({ agent: requestedAgent.id, model: selectedModel })
        expect(missingAgent).toMatchObject({ agent: missingID, model: initialModel })
        for (const session of Object.values(created)) {
          expect(yield* sessions.get(session.id)).toMatchObject({ agent: session.agent, model: session.model })
        }
        yield* sessions.prompt({ sessionID: missingAgent.id, text: "fail with the requested Agent" })
        yield* sessions.awaitIdle(missingAgent.id)
        expect(
          (yield* sessions.messages({ sessionID: missingAgent.id }))[0],
        ).toMatchObject({
          type: "assistant",
          agent: missingID,
          error: { message: `Agent selection not found: ${missingID}` },
        })
      }).pipe(Effect.provide(layerA)),
    )
  })

  effectIt.effect("uses Config default_model for a valid model-less selected Agent", () => {
    const configuredModel = ModelSchema.Ref.make({ provider: ProviderSchema.Name.make("configured"), id: "default" })
    const configured = ConfigSchema.Info.make({ ...defaultConfig, default_model: configuredModel })
    const configuredLayer = Layer.succeed(
      Config.Service,
      Config.Service.of({
        provider: { update: () => Effect.die("unused") },
        model: { put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
        get: Effect.succeed(configured),
        update: () => Effect.die(new Error("unused")),
        refresh: Effect.succeed(configured),
        mcp: { update: () => Effect.die("unused"), put: () => Effect.die("unused"), remove: () => Effect.die("unused") },
        modelPolicy: {
          reconcile: () => Effect.die("unused"),
          initialize: () => Effect.die("unused"),
          toggle: () => Effect.die("unused"),
          setDefault: () => Effect.die("unused"),
        },
        plugin: Config.pluginUnavailable,
        entries: () => Effect.succeed([{ type: "document", info: configured }]),
        changes: () => Stream.never,
      }),
    )
    return Session.Service.use((sessions) => sessions.create({ projectID, agent: modelLessAgent.id })).pipe(
      Effect.tap((created) =>
        Effect.sync(() => expect(created).toMatchObject({ agent: modelLessAgent.id, model: configuredModel })),
      ),
      Effect.provide(makeLayer(workspaceA, Provider.layer, agents, defaultInstruction, skills, configuredLayer)),
    )
  })

  effectIt.effect("returns the database-backed latest twenty Messages in descending order", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const created = yield* sessions.create({ projectID })
      const ids = Array.from({ length: 21 }, (_, index) =>
        MessageID.make(`00000000-0000-4000-8000-${(index + 920).toString().padStart(12, "0")}`),
      )
      const now = new Date("2026-09-01T00:00:00.000Z")
      const messages = ids.map((id, index) =>
        Assistant.make({
          id,
          sessionID: created.id,
          sequence: index + 1,
          type: "assistant",
          agent: selectedAgent.id,
          model: initialModel,
          content: [],
          finish: "stop",
          time: { created: now, completed: now },
          usage: emptyUsage,
          createdAt: now,
        }),
      )
      yield* database.use("sessionMessagePageFixture", (db) =>
        db.insert(SessionMessageTable).values(
          messages.map((message) => ({
            id: message.id,
            sessionID: message.sessionID,
            sequence: message.sequence,
            type: message.type,
            data: message,
            timeCreated: now,
            timeUpdated: now,
          })),
        ),
      )

      const page = yield* sessions.messages({
        sessionID: created.id,
        order: "desc",
        limit: 20,
      })
      expect(page.map((message) => message.id)).toEqual(ids.slice(1).reverse())
      expect(page.map((message) => message.sequence)).toEqual(
        page.map((message) => message.sequence).toSorted((left, right) => right - left),
      )
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("persists the bound User and gives children their parent's ownership", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const parent = yield* sessions.create({ projectID })
      const child = yield* sessions.createChild({
        parentID: parent.id,
        title: SessionSchema.Title.make("Owned child"),
        agent: requestedAgent.id,
        model: selectedModel,
      })
      const grandchild = yield* sessions.createChild({ parentID: child.id, title: "Grandchild" })
      const missing = SessionSchema.ID.make("00000000-0000-4000-8000-000000000699")
      const missingError = yield* failureOf(sessions.createChild({ parentID: missing }))
      const foreignError = yield* Session.Service.use((foreign) => failureOf(foreign.createChild({ parentID: parent.id }))).pipe(
        Effect.provide(layerB),
      )
      const owners = yield* database.use("Session.ownershipFixture", (db) =>
        db
          .select({ id: SessionTable.id, userID: SessionTable.userID })
          .from(SessionTable)
          .where(sql`${SessionTable.id} in (${parent.id}, ${child.id}, ${grandchild.id})`),
      )

      expect(child).toMatchObject({
        projectID: parent.projectID,
        parentID: parent.id,
        title: "Owned child",
        agent: requestedAgent.id,
        model: selectedModel,
      })
      expect((yield* sessions.list({ parentID: parent.id })).data.map((session) => session.id)).toEqual([child.id])
      expect((yield* sessions.list({ parentID: child.id })).data.map((session) => session.id)).toEqual([grandchild.id])
      expect(missingError).toEqual(new Session.NotFoundError({ sessionID: missing }))
      expect(foreignError).toEqual(new Session.NotFoundError({ sessionID: parent.id }))
      expect(owners).toHaveLength(3)
      expect(owners.every(({ userID }) => userID === ownerA.userID)).toBe(true)
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("recognizes child effective permissions from persisted parent identity", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const permissions = yield* Permission.Service
      const parent = yield* sessions.create({ projectID })
      const child = yield* sessions.createChild({ parentID: parent.id, title: "Permission child" })
      const ask = (sessionID: SessionSchema.ID, action: string) =>
        permissions.ask({ sessionID, action, resources: ["*"] })

      expect((yield* ask(child.id, "read")).effect).toBe("allow")
      expect((yield* ask(child.id, "subagent")).effect).toBe("deny")
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("keeps the activity time when a Session is archived or restored", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const created = yield* sessions.create({ projectID })
      yield* TestClock.adjust("1 minute")
      const archived = yield* sessions.update({ sessionID: created.id, archived: true })
      yield* TestClock.adjust("1 minute")
      const restored = yield* sessions.update({ sessionID: created.id, archived: false })
      const stored = yield* sessions.get(created.id)
      yield* TestClock.adjust("1 minute")
      const renamed = yield* sessions.update({ sessionID: created.id, title: "Renamed" })

      expect(archived.updatedAt).toEqual(created.updatedAt)
      expect(restored.updatedAt).toEqual(created.updatedAt)
      expect(stored.updatedAt).toEqual(created.updatedAt)
      expect(renamed.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("commits Session summary updates and deletion only within the owning Workspace", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const projects = yield* Project.Service
      const events = yield* Bus.Service
      const destination = yield* projects.create({ name: "Moved sessions" })
      const foreignProject = yield* Project.Service.use((service) =>
        service.create({ name: "Foreign destination" }),
      ).pipe(Effect.provide(layerB))
      const foreignSession = yield* Session.Service.use((service) =>
        service.create({ projectID: foreignProject.id }),
      ).pipe(Effect.provide(layerB))
      const receivedStream = yield* events.subscribe([SessionEvent.Created, SessionEvent.Updated, SessionEvent.Deleted])
      const received = yield* receivedStream.pipe(Stream.take(6), Stream.runCollect, Effect.forkChild)
      yield* Effect.yieldNow

      const created = yield* sessions.create({ projectID })
      const renamed = yield* sessions.update({ sessionID: created.id, title: "Renamed" })
      const moved = yield* sessions.update({ sessionID: created.id, projectID: destination.id })
      const archived = yield* sessions.update({ sessionID: created.id, archived: true })
      const unarchived = yield* sessions.update({ sessionID: created.id, archived: false })
      const beforeRejectedMove = yield* sessions.get(created.id)
      const rejectedMove = yield* failureOf(sessions.update({ sessionID: created.id, projectID: foreignProject.id }))
      const afterRejectedMove = yield* sessions.get(created.id)
      const rejectedForeignUpdate = yield* failureOf(sessions.update({ sessionID: foreignSession.id, title: "Not ours" }))
      const rejectedForeignDelete = yield* failureOf(sessions.delete(foreignSession.id))
      yield* sessions.delete(created.id)

      expect(renamed.title).toBe("Renamed")
      expect(moved).toMatchObject({ title: "Renamed", projectID: destination.id })
      expect(archived.archivedAt).toBeInstanceOf(Date)
      expect(unarchived.archivedAt).toBeUndefined()
      expect(rejectedMove).toEqual(new Project.NotFoundError({ projectID: foreignProject.id }))
      expect(rejectedForeignUpdate).toEqual(new Session.NotFoundError({ sessionID: foreignSession.id }))
      expect(rejectedForeignDelete).toEqual(new Session.NotFoundError({ sessionID: foreignSession.id }))
      expect(yield* failureOf(sessions.get(created.id))).toEqual(
        new Session.NotFoundError({ sessionID: created.id }),
      )
      expect(beforeRejectedMove).toMatchObject(unarchived)
      expect(afterRejectedMove).toEqual(beforeRejectedMove)

      const lifecycle = [...(yield* Fiber.join(received))]
      expect(lifecycle.map((event) => event.type)).toEqual([
        "session.created",
        "session.updated",
        "session.updated",
        "session.updated",
        "session.updated",
        "session.deleted",
      ])
      expect(lifecycle.slice(1, 5).map((event) => ("session" in event.data ? event.data.session : undefined))).toEqual([
        renamed,
        moved,
        archived,
        unarchived,
      ])
    }).pipe(Effect.scoped, Effect.provide(layerA)),
  )

  it("lists canonical root summaries with stable ID-ascending ties and query-bound cursors", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const database = yield* Database.Service
        const parent = yield* sessions.create({ projectID })
        const roots = yield* Effect.all([
          sessions.create({ projectID }),
          sessions.create({ projectID }),
          sessions.create({ projectID }),
        ])
        const archivedAt = new Date("2026-08-20T09:00:00.000Z")
        const updatedAt = new Date("2026-08-20T10:00:00.000Z")
        yield* database.use("sessionSummaryFixtures", (db) =>
          Effect.all(
            [
              ...roots.map((session, index) =>
                db
                  .update(SessionTable)
                  .set({ title: index === 2 ? "Other" : `Palette ${index}`, timeUpdated: updatedAt })
                  .where(eq(SessionTable.id, session.id)),
              ),
              db
                .update(SessionTable)
                .set({ title: "Palette child", parentID: parent.id, timeUpdated: updatedAt })
                .where(eq(SessionTable.id, parent.id)),
              db.update(SessionTable).set({ archivedAt }).where(eq(SessionTable.id, roots[1]!.id)),
            ],
            { discard: true },
          ),
        )

        const first = yield* sessions.list({ search: "palette", parentID: null, archived: false, limit: 1 })
        expect(first.data.map((session) => session.id)).toEqual([roots[0]!.id])
        expect(first.data[0]).toMatchObject({ title: "Palette 0" })
        expect(first.cursor).toBeUndefined()

        const allRoots = yield* sessions.list({ parentID: null, archived: false, limit: 100 })
        const tied = allRoots.data.filter((session) => roots.some((root) => root.id === session.id))
        expect(tied.map((session) => session.id)).toEqual(
          [roots[0]!.id, roots[2]!.id].sort((left, right) => left.localeCompare(right)),
        )

        const paged = yield* sessions.list({ parentID: null, archived: false, limit: 1 })
        expect(paged.cursor).toBeDefined()
        const invalid = yield* sessions
          .list({ cursor: paged.cursor, parentID: null, archived: true, limit: 1 })
          .pipe(Effect.flip)
        expect(invalid).toEqual(new Session.InvalidCursorError())
      }).pipe(Effect.provide(layerA)),
    )
  })

  it("interrupts an owned idle Session and rejects a foreign Session", async () => {
    await Effect.runPromise(
      Session.Service.use((sessions) => sessions.interrupt(sessionA, "user")).pipe(Effect.provide(layerA)),
    )
    const foreign = await Effect.runPromise(
      Session.Service.use((sessions) => sessions.interrupt(sessionB, "user")).pipe(Effect.flip, Effect.provide(layerA)),
    )

    expect(foreign).toEqual(new Session.NotFoundError({ sessionID: sessionB }))
  })

  it("switches an owned Model but cannot update or append children for a foreign Session", async () => {
    const own = await Effect.runPromise(
      Session.Service.use((sessions) =>
        Effect.gen(function* () {
          yield* sessions.switchModel({ sessionID: sessionA, model: selectedModel })
          return {
            detail: yield* sessions.get(sessionA),
            messages: yield* sessions.messages({ sessionID: sessionA }),
          }
        }),
      ).pipe(Effect.provide(layerA)),
    )
    const foreignError = await Effect.runPromise(
      Session.Service.use((sessions) => failureOf(sessions.switchModel({ sessionID: sessionB, model: selectedModel }))).pipe(
        Effect.provide(layerA),
      ),
    )
    const foreignOwner = await Effect.runPromise(
      Session.Service.use((sessions) =>
        Effect.all({
          detail: sessions.get(sessionB),
          messages: sessions.messages({ sessionID: sessionB }),
        }),
      ).pipe(Effect.provide(layerB)),
    )
    expect(own.detail.model).toEqual(selectedModel)
    expect(own.messages).toMatchObject([{ type: "model-switched", model: selectedModel }])
    expect(foreignError).toEqual(new Session.NotFoundError({ sessionID: sessionB }))
    expect(foreignOwner.detail.model).toEqual(initialModel)
    expect(foreignOwner.messages).toEqual([])
  })

  it("admits idempotently within the owning Workspace and maps admission failures", async () => {
    const messageID = MessageID.make("00000000-0000-4000-8000-000000000603")
    const foreignMessageID = MessageID.make("00000000-0000-4000-8000-000000000604")
    const input = {
      sessionID: sessionA,
      id: messageID,
      text: "Ask @not-catalogued",
      agents: [{ name: "not-catalogued", mention: { start: 4, end: 20, text: "@not-catalogued" } }],
      metadata: { source: "test" },
      delivery: "queue" as const,
      resume: false,
    }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const inbox = yield* SessionInbox.Service
        const admitted = yield* Effect.all([sessions.prompt(input), sessions.prompt(input)])
        const changed = yield* sessions.prompt({
          ...input,
          text: "changed",
          agents: [{ name: "also-not-catalogued" }],
          metadata: { source: "retry" },
          delivery: "steer",
        })
        yield* inbox.deliver(sessionA)
        const transcript = yield* sessions.messages({ sessionID: sessionA })
        const promotedRetry = yield* sessions.prompt({ ...input, agents: [], metadata: {}, delivery: "steer" })
        const other = yield* sessions.create({ projectID })
        const crossSession = yield* failureOf(sessions.prompt({ ...input, sessionID: other.id }))
        const differentType = yield* failureOf(sessions.compact({ sessionID: sessionA, id: messageID }))
        const generated = yield* sessions.prompt({ sessionID: other.id, text: "generated ID", resume: false })
        return {
          admitted,
          changed,
          transcript,
          promotedRetry,
          crossSession,
          differentType,
          generated,
          otherID: other.id,
        }
      }).pipe(Effect.provide(layerA)),
    )
    const missing = await Effect.runPromise(
      Session.Service.use((sessions) =>
        sessions.prompt({ sessionID: sessionB, id: foreignMessageID, text: "foreign" }),
        ).pipe(failureOf, Effect.provide(layerA)),
    )
    const owner = await Effect.runPromise(
      Session.Service.use((sessions) =>
        sessions.prompt({ sessionID: sessionB, id: foreignMessageID, text: "foreign" }),
      ).pipe(Effect.provide(layerB)),
    )

    expect(result.admitted[0]).toEqual(result.admitted[1])
    expect(result.changed).toEqual(result.admitted[0])
    expect(result.promotedRetry).toEqual(result.admitted[0])
    expect(result.transcript.find((message) => message.type === "user")).toMatchObject({
      text: input.text,
      agents: input.agents,
      metadata: input.metadata,
      delivery: input.delivery,
    })
    expect(result.admitted[0]).toMatchObject({
      id: input.id,
      sessionID: input.sessionID,
      text: input.text,
      agents: input.agents,
      metadata: input.metadata,
      delivery: input.delivery,
    })
    expect(result.crossSession).toEqual(new Session.PromptConflictError({ sessionID: result.otherID, messageID }))
    expect(result.differentType).toEqual(new Session.CompactionConflictError({ sessionID: sessionA, messageID }))
    expect(result.generated).toMatchObject({ text: "generated ID", delivery: "steer" })
    expect(result.generated.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(missing).toEqual(new Session.NotFoundError({ sessionID: sessionB }))
    expect(owner).toMatchObject({ sessionID: sessionB, id: foreignMessageID, text: "foreign" })
  })

  it("admits synthetic context separately and preserves the first payload through promotion", async () => {
    const messageID = MessageID.make(crypto.randomUUID())
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const inbox = yield* SessionInbox.Service
        const database = yield* Database.Service
        const created = yield* sessions.create({ projectID })
        const input = {
          sessionID: created.id,
          id: messageID,
          text: "Background work completed",
          description: "Research complete",
          metadata: { source: "subagent", childID: "child" },
          delivery: "steer" as const,
          resume: false,
        }
        const admitted = yield* inbox
          .admitSynthetic(input)
          .pipe(
            Effect.flatMap((value) =>
              value === undefined
                ? Effect.die(new Error("Synthetic admission unexpectedly missing"))
                : Effect.succeed(value),
            ),
          )
        const duplicate = yield* inbox
          .admitSynthetic({ ...input, text: "Different completion", delivery: "queue" })
          .pipe(
            Effect.flatMap((value) =>
              value === undefined
                ? Effect.die(new Error("Synthetic duplicate unexpectedly missing"))
                : Effect.succeed(value),
            ),
          )
        const discoverable = yield* inbox.list
        const before = yield* sessions.messages({ sessionID: created.id })
        const pending = yield* database.use("syntheticPending", (db) =>
          db.select().from(SessionInboxTable).where(eq(SessionInboxTable.id, messageID)),
        )
        yield* inbox.deliver(created.id)
        const after = yield* sessions.messages({ sessionID: created.id })
        const projected = yield* sessions.synthetic({ ...input, text: "Later retry", delivery: "queue" })
        return { sessionID: created.id, admitted, duplicate, discoverable, before, pending, after, projected }
      }).pipe(Effect.provide(layerA)),
    )

    expect(result.admitted).toEqual(result.duplicate)
    expect(result.discoverable).toContain(result.sessionID)
    expect(result.before.filter((message) => message.type === "synthetic")).toEqual([])
    expect(result.pending).toMatchObject([
      {
        id: messageID,
        type: "synthetic",
        delivery: "steer",
        payload: {
          text: "Background work completed",
          description: "Research complete",
          metadata: { source: "subagent", childID: "child" },
        },
      },
    ])
    expect(result.after.filter((message) => message.type === "synthetic")).toMatchObject([
      {
        id: messageID,
        type: "synthetic",
        text: "Background work completed",
        description: "Research complete",
        metadata: { source: "subagent", childID: "child" },
      },
    ])
    expect(result.projected.payload).toEqual(result.admitted.payload)
  })

  effectIt.effect("does not interrupt an Assistant owned by another Workspace", () =>
    Effect.gen(function* () {
      const created = yield* Session.Service.use((sessions) => sessions.create({ projectID })).pipe(
        Effect.provide(layerB),
      )
      const messageID = MessageID.make("00000000-0000-4000-8000-000000000617")
      const runtimeB = makeRunnerDependencies(workspaceB)
      yield* Database.Service.use((database) =>
        insertAssistant(database, created, messageID, selectedModel),
      ).pipe(Effect.provide(runtimeB))

      const foreign = yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        return yield* SessionMessage.interrupt(database, events, workspaceA, messageID)
      }).pipe(Effect.provide(makeRunnerDependencies(workspaceA)))
      const beforeOwner = yield* Database.Service.use((database) =>
        SessionMessage.context(database, workspaceB, created.id),
      ).pipe(Effect.provide(runtimeB))
      const owned = yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        return yield* SessionMessage.interrupt(database, events, workspaceB, messageID)
      }).pipe(Effect.provide(runtimeB))
      const afterOwner = yield* Database.Service.use((database) =>
        SessionMessage.context(database, workspaceB, created.id),
      ).pipe(Effect.provide(runtimeB))

      expect(foreign).toBe(false)
      expect(beforeOwner[0]).not.toHaveProperty("error")
      expect(owned).toBe(true)
      expect(afterOwner[0]).toMatchObject({
        id: messageID,
        error: { _tag: "SessionError.AbortedError" },
        time: { completed: expect.any(Date) },
      })
    }),
  )
})

describe("PostgreSQL Session persistence and execution", () => {
  effectIt.effect("lists completed Assistant usage only from the bound Workspace", () =>
    Effect.gen(function* () {
      const usageService = yield* CoreUsage.Service
      const database = yield* Database.Service
      const usageWorkspace = Workspace.ID.make("wrk_session_usage")
      const usageSessionID = SessionSchema.ID.make(crypto.randomUUID())
      yield* database.use("sessionUsageWorkspaceFixture", (db) =>
        db.transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction
              .insert(WorkspaceTable)
              .values({ id: usageWorkspace, name: "Usage fixture", status: "active" })
            yield* transaction
              .insert(ProjectTable)
              .values({ workspaceID: usageWorkspace, id: projectID, name: "Usage fixture" })
            yield* transaction.insert(UserTable).values({
              id: ownerA.userID,
              workspaceId: usageWorkspace,
              accountId: ownerA.accountID,
              role: "admin",
            })
            yield* transaction.insert(SessionTable).values({
              id: usageSessionID,
              workspaceID: usageWorkspace,
              userID: ownerA.userID,
              projectID,
              agent: selectedAgent.id,
              model: initialModel,
            })
          }),
        ),
      )
      const older = new Date("2026-08-26T10:00:00.000Z")
      const newer = new Date("2026-08-26T11:00:00.000Z")
      const usage = Usage.make({
        cost: 0.25,
        costComplete: false,
        tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } },
      })
      const messages = [
        Assistant.make({
          id: MessageID.make("00000000-0000-4000-8000-000000000691"),
          sessionID: usageSessionID,
          sequence: 2,
          type: "assistant",
          agent: selectedAgent.id,
          model: initialModel,
          content: [],
          time: { created: older, completed: older },
          usage,
          createdAt: older,
        }),
        Assistant.make({
          id: MessageID.make("00000000-0000-4000-8000-000000000692"),
          sessionID: usageSessionID,
          sequence: 3,
          type: "assistant",
          agent: selectedAgent.id,
          model: selectedModel,
          content: [],
          time: { created: newer, completed: newer },
          usage,
          createdAt: newer,
        }),
        Assistant.make({
          id: MessageID.make("00000000-0000-4000-8000-000000000693"),
          sessionID: usageSessionID,
          sequence: 4,
          type: "assistant",
          agent: selectedAgent.id,
          model: initialModel,
          content: [],
          time: { created: new Date("2026-08-26T12:00:00.000Z") },
          usage,
          createdAt: new Date("2026-08-26T12:00:00.000Z"),
        }),
      ]
      yield* database.use("sessionUsageFixture", (db) =>
        db.insert(SessionMessageTable).values(
          messages.map((message) => ({
            id: message.id,
            sessionID: message.sessionID,
            sequence: message.sequence,
            type: message.type,
            data: message,
            timeCreated: message.createdAt,
            timeUpdated: message.time.completed ?? message.createdAt,
          })),
        ),
      )
      const foreign = yield* Session.Service.use((service) => service.create({ projectID })).pipe(
        Effect.provide(layerB),
      )
      yield* Database.Service.use((db) =>
        db.use("foreignSessionUsageFixture", (tx) => {
          const message = Assistant.make({
            ...messages[0]!,
            id: MessageID.make("00000000-0000-4000-8000-000000000694"),
            sessionID: foreign.id,
            sequence: 2,
          })
          return tx.insert(SessionMessageTable).values({
            id: message.id,
            sessionID: message.sessionID,
            sequence: message.sequence,
            type: message.type,
            data: message,
            timeCreated: message.createdAt,
            timeUpdated: message.time.completed ?? message.createdAt,
          })
        }),
      ).pipe(Effect.provide(layerB))

      const first = yield* usageService.list({ limit: 1 })
      const second = yield* usageService.list({ limit: 1, cursor: first.cursor })

      expect(first.data).toEqual([expect.objectContaining({ id: messages[1]!.id, model: selectedModel, usage })])
      expect(first.cursor).toBeDefined()
      expect(second.data).toEqual([expect.objectContaining({ id: messages[0]!.id, model: initialModel, usage })])
      expect(second.cursor).toBeUndefined()
    }).pipe(Effect.provide(Layer.provideMerge(CoreUsage.layer(Workspace.ID.make("wrk_session_usage")), layerA))),
  )

  effectIt.effect("summarizes persisted observations by UTC day, user, and effective model", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const usage = yield* CoreUsage.Service
      const today = yield* DateTime.nowAsDate
      const yesterday = new Date(today)
      yesterday.setUTCDate(yesterday.getUTCDate() - 1)
      yield* cleanupUsage([
        CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000701"),
        CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000702"),
      ])
      yield* database.use("usageOverviewFixture", (db) =>
        db.insert(UsageTable).values([
          {
            id: CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000701"),
            workspaceID: workspaceA,
            userID: ownerA.userID,
            sessionID: sessionA,
            model: "effective-b",
            input: 1,
            output: 2,
            reasoning: 3,
            cacheRead: 4,
            cacheWrite: 5,
            cost: "1.25",
            occurredAt: today,
          },
          {
            id: CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000702"),
            workspaceID: workspaceA,
            userID: ownerA.userID,
            sessionID: sessionA,
            model: "effective-a",
            input: 10,
            output: 20,
            reasoning: 30,
            cacheRead: 40,
            cacheWrite: 50,
            cost: "2.5",
            costComplete: false,
            occurredAt: yesterday,
          },
        ]),
      )

      const overview = yield* usage.overview({ days: CoreUsageSchema.Days.make(2) })

      expect(overview.total).toMatchObject({ invocations: 2, cost: 3.75, costComplete: false, tokens: { total: 165 } })
      expect(overview.daily).toHaveLength(2)
      expect(overview.daily.map((bucket) => bucket.usage.invocations)).toEqual([1, 1])
      expect(overview.users).toEqual([expect.objectContaining({ userID: ownerA.userID })])
      expect(overview.models.map((group) => group.model)).toEqual(["effective-a", "effective-b"])
    }).pipe(Effect.scoped, Effect.provide(Layer.provideMerge(CoreUsage.layer(workspaceA), layerA))),
  )

  effectIt.effect("builds complete, isolated leaderboard rankings for users and all model principals", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const usage = yield* CoreUsage.Service
      const today = yield* DateTime.nowAsDate
      const old = new Date(today)
      old.setUTCDate(old.getUTCDate() - 7)
      const fallbackUserID = User.ID.make("usr_leaderboard_fallback")
      const serviceAccountID = ServiceAccount.ID.make("sva_leaderboard_service")
      yield* cleanupUsage([
        CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000741"),
        CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000742"),
        CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000743"),
        CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000744"),
        CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000745"),
      ])
      yield* database.use("usageLeaderboardFixture", (db) =>
        db.transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction.insert(AuthTable).values([
              {
                id: AuthSchema.ID.make("aut_leaderboard_owner"),
                provider: AuthSchema.Provider.make("email"),
                subject: AuthSchema.Sub.make("owner@example.com"),
                accountId: ownerA.accountID,
              },
              {
                id: AuthSchema.ID.make("aut_leaderboard_owner_alias"),
                provider: AuthSchema.Provider.make("email"),
                subject: AuthSchema.Sub.make("owner-alias@example.com"),
                accountId: ownerA.accountID,
              },
            ])
            yield* transaction.insert(UserTable).values({
              id: fallbackUserID,
              workspaceId: workspaceA,
              role: "member",
            })
            yield* transaction.insert(ServiceAccountTable).values({
              id: serviceAccountID,
              workspaceID: workspaceA,
              name: "Leaderboard service",
              status: "active",
            })
            yield* transaction.insert(UsageTable).values([
              {
                id: CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000741"),
                workspaceID: workspaceA,
                userID: ownerA.userID,
                model: "openai/gpt-5",
                input: 10,
                output: 0,
                reasoning: 0,
                cacheRead: 0,
                cacheWrite: 0,
                cost: "5",
                costComplete: false,
                occurredAt: today,
              },
              {
                id: CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000742"),
                workspaceID: workspaceA,
                userID: fallbackUserID,
                model: "anthropic/claude",
                input: 5,
                output: 5,
                reasoning: 0,
                cacheRead: 0,
                cacheWrite: 0,
                cost: "5",
                occurredAt: today,
              },
              {
                id: CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000743"),
                workspaceID: workspaceA,
                serviceAccountID,
                // Service Account usage is Gateway inference; Session usage requires a User.
                source: "inference",
                model: "openai/gpt-5",
                input: 20,
                output: 0,
                reasoning: 0,
                cacheRead: 0,
                cacheWrite: 0,
                cost: "20",
                occurredAt: today,
              },
              {
                id: CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000744"),
                workspaceID: workspaceA,
                userID: ownerA.userID,
                model: "excluded-old-model",
                input: 100,
                output: 0,
                reasoning: 0,
                cacheRead: 0,
                cacheWrite: 0,
                cost: "100",
                occurredAt: old,
              },
              {
                id: CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000745"),
                workspaceID: workspaceB,
                userID: ownerB.userID,
                model: "excluded-foreign-model",
                input: 100,
                output: 0,
                reasoning: 0,
                cacheRead: 0,
                cacheWrite: 0,
                cost: "100",
                occurredAt: today,
              },
            ])
          }),
        ),
      )

      const leaderboard = yield* usage.leaderboard({ days: CoreUsageSchema.Days.make(7) })

      expect(leaderboard.users.map((user) => user.userID)).toEqual([fallbackUserID, ownerA.userID])
      expect(leaderboard.users).toEqual([
        expect.objectContaining({ userID: fallbackUserID, usage: expect.objectContaining({ cost: 5 }) }),
        expect.objectContaining({
          userID: ownerA.userID,
          email: "owner@example.com",
          usage: expect.objectContaining({ invocations: 1, cost: 5, costComplete: false }),
          models: [expect.objectContaining({ model: "openai/gpt-5" })],
        }),
      ])
      expect(leaderboard.users[0]).not.toHaveProperty("email")
      expect(leaderboard.models).toEqual([
        expect.objectContaining({
          model: "openai/gpt-5",
          users: 1,
          usage: expect.objectContaining({
            cost: 25,
            costComplete: false,
            tokens: expect.objectContaining({ total: 30 }),
          }),
        }),
        expect.objectContaining({ model: "anthropic/claude", users: 1 }),
      ])
    }).pipe(Effect.scoped, Effect.provide(Layer.provideMerge(CoreUsage.layer(workspaceA), layerA))),
  )

  effectIt.effect("lists persisted usage observations in stable cursor pages", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const usage = yield* CoreUsage.Service
      yield* database.use("usageListFixture", (db) =>
        db.insert(UsageTable).values([
          {
            id: CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000711"),
            workspaceID: workspaceA,
            userID: ownerA.userID,
            sessionID: sessionA,
            model: "older-model",
            input: 1,
            output: 2,
            reasoning: 3,
            cacheRead: 0,
            cacheWrite: 4,
            cost: "1.25",
            costComplete: false,
            occurredAt: new Date("2026-08-30T12:00:00.000Z"),
          },
          {
            id: CoreUsageSchema.ID.make("00000000-0000-4000-8000-000000000712"),
            workspaceID: workspaceA,
            userID: ownerA.userID,
            sessionID: sessionA,
            model: "newer-model",
            input: 10,
            output: 20,
            reasoning: 30,
            cacheRead: 40,
            cacheWrite: 50,
            cost: "2.5",
            occurredAt: new Date("2026-08-31T12:00:00.000Z"),
          },
        ]),
      )

      const first = yield* usage.records({ limit: 1 })
      expect(first.data).toEqual([
        expect.objectContaining({
          model: "newer-model",
          createdAt: new Date("2026-08-31T12:00:00.000Z"),
          usage: {
            cost: 2.5,
            costComplete: true,
            tokens: { input: 10, output: 20, reasoning: 30, cache: { read: 40, write: 50 } },
          },
        }),
      ])
      expect(first.cursor).toBeTypeOf("string")
      const cursor = first.cursor
      if (cursor === undefined) return yield* Effect.die(new Error("Expected another usage page"))

      const second = yield* usage.records({ limit: 1, cursor })
      expect(second.data.map((record) => record.model)).toEqual(["older-model"])
      expect(second.cursor).toBeUndefined()
      expect(yield* usage.records({ cursor: "not-a-cursor" }).pipe(Effect.flip)).toBeInstanceOf(
        CoreUsage.InvalidCursorError,
      )
    }).pipe(Effect.provide(Layer.provideMerge(CoreUsage.layer(workspaceA), layerA))),
  )

  effectIt.effect("promotes admitted inputs in FIFO order with contiguous user and execution provenance", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const busScope = yield* Bus.Service
      // A child Session: startup recovery and periodic discovery wake roots only,
      // so nothing but the explicit resumes below can start a run.
      const parent = yield* sessions.create({ projectID })
      const created = yield* sessions.createChild({ parentID: parent.id, title: "FIFO child" })
      const log = yield* sessionEvents(busScope, created.id)
      const completed = yield* log.pipe(
        Stream.take(12),
        Stream.runCollect,
        Effect.forkScoped,
      )
      const first = MessageID.make("00000000-0000-4000-8000-000000000607")
      const second = MessageID.make("00000000-0000-4000-8000-000000000608")
      // Admit both before any run so the second admission cannot race the first
      // run's persisted Messages; each resume then delivers exactly one input.
      yield* sessions.prompt({ sessionID: created.id, id: first, text: "first", resume: false })
      yield* sessions.prompt({ sessionID: created.id, id: second, text: "second", resume: false })
      expect(yield* sessions.resume(created.id).pipe(Effect.flip)).toBeInstanceOf(Runner.RunError)
      expect(yield* sessions.resume(created.id).pipe(Effect.flip)).toBeInstanceOf(Runner.RunError)

      const items = [...(yield* Fiber.join(completed))]
      expect(items.map((event) => event.type)).toEqual([
        "session.input.admitted",
        "session.input.admitted",
        "session.run.started",
        "session.input.promoted",
        "session.execution.started",
        "session.execution.failed",
        "session.run.failed",
        "session.run.started",
        "session.input.promoted",
        "session.execution.started",
        "session.execution.failed",
        "session.run.failed",
      ])
      expect(
        items.filter((event) => event.type === SessionEvent.RunFailed.type).map((event) => event.data.error),
      ).toEqual(items.filter((event) => event.type === SessionEvent.Failed.type).map((event) => event.data.error))
      const page = yield* sessions.messages({ sessionID: created.id, order: "asc" })
      expect(page).toMatchObject([
        { id: first, type: "user", text: "first", admittedSequence: 1 },
        { type: "assistant", agent: selectedAgent.id, model: initialModel },
        { id: second, type: "user", text: "second", admittedSequence: 2 },
        { type: "assistant", agent: selectedAgent.id, model: initialModel },
      ])
    }).pipe(Effect.scoped, Effect.provide(layerA)),
  )

  effectIt.effect("publishes one successful run lifecycle and run facts do not change Session recency", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die(new Error("unused")),
          update: () => Effect.die(new Error("unused")),
        }),
      )
      const calls = yield* Ref.make(0)
      const provider = withProviderStream((input) =>
        input.context.purpose === "title"
          ? Stream.make(LLMEvent.textDelta({ id: "title", text: "Lifecycle" }))
          : Ref.getAndUpdate(calls, (count) => count + 1).pipe(
              Effect.map((index) =>
                index === 0
                  ? [
                      LLMEvent.toolCall({ id: "unavailable", name: "missing", input: {} }),
                      LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
                    ]
                  : [LLMEvent.finish({ reason: { normalized: "stop" } })],
              ),
              Stream.fromEffect,
              Stream.flatMap(Stream.fromIterable),
            ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* Session.Service
        const events = yield* Bus.Service
        const database = yield* Database.Service
        const created = yield* sessions.create({ projectID, agent: executableAgent.id, model: executableModel })
        const following = yield* followSession(
          events,
          created.id,
          (event) => event.type === SessionEvent.RunSucceeded.type,
        )
        yield* sessions.prompt({ sessionID: created.id, text: "finish normally", resume: false })
        yield* sessions.resume(created.id)
        const replay = yield* Fiber.join(following)
        const lifecycle = [...replay].filter((event) => event.type.startsWith("session.run."))
        expect(lifecycle.map((event) => event.type)).toEqual(["session.run.started", "session.run.succeeded"])
        expect([...replay].filter((event) => event.type === SessionEvent.ExecutionStarted.type)).toHaveLength(2)
        expect([...replay].filter((event) => event.type === SessionEvent.ToolFailed.type)).toHaveLength(1)
        expect([...replay].filter((event) => event.type === SessionEvent.RunFailed.type)).toHaveLength(0)
        const before = yield* database.use("runProjectionBefore", (db) =>
          Effect.all([
            db.select().from(SessionTable).where(eq(SessionTable.id, created.id)),
            db.select().from(SessionMessageTable).where(eq(SessionMessageTable.sessionID, created.id)),
            db.select().from(SessionInboxTable).where(eq(SessionInboxTable.sessionID, created.id)),
          ]),
        )
        yield* events.publish(SessionEvent.RunStarted, { sessionID: created.id })
        yield* events.publish(SessionEvent.RunSucceeded, { sessionID: created.id })
        const after = yield* database.use("runProjectionAfter", (db) =>
          Effect.all([
            db.select().from(SessionTable).where(eq(SessionTable.id, created.id)),
            db.select().from(SessionMessageTable).where(eq(SessionMessageTable.sessionID, created.id)),
            db.select().from(SessionInboxTable).where(eq(SessionInboxTable.sessionID, created.id)),
          ]),
        )
        expect(after).toEqual(before)
      }).pipe(Effect.provide(makeLayer(workspaceA, provider, executableAgents)))
    }),
  )

  effectIt.effect("delivers steering prompts before queued compaction with idempotent coalescing", () =>
    Effect.gen(function* () {
      const sessionID = SessionSchema.ID.make("00000000-0000-4000-8000-000000000628")
      const promptA = MessageID.make("00000000-0000-4000-8000-000000000624")
      const compactionID = MessageID.make("00000000-0000-4000-8000-000000000625")
      const coalescedID = MessageID.make("00000000-0000-4000-8000-000000000626")
      const promptB = MessageID.make("00000000-0000-4000-8000-000000000627")
      const databaseLayer = Database.layer.pipe(Layer.provide(PgClient.layer({ url: Redacted.make(databaseURL) })))
      const busLayer = Bus.layer.pipe(Layer.provide(NodeCrypto.layer), Layer.orDie)
      const inboxLayer = SessionInbox.layer(workspaceA).pipe(
        Layer.provide(busLayer),
        Layer.provide(Layer.mergeAll(databaseLayer, NodeCrypto.layer)),
      )

      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const inbox = yield* SessionInbox.Service
        yield* database.use("sessionInboxContractSession", (db) =>
          db.execute(sql`insert into session (id, workspace_id, user_id, project_id, agent, model)
            values (${sessionID}, ${workspaceA}, ${ownerA.userID}, ${projectID}, ${selectedAgent.id}, ${JSON.stringify(initialModel)}::jsonb)`),
        )
        yield* inbox.admitPrompt({ sessionID, id: promptA, text: "prompt A" })
        const compaction = yield* inbox.admitCompaction({ sessionID, id: compactionID })
        const coalesced = yield* inbox.admitCompaction({ sessionID, id: coalescedID })
        yield* inbox.admitPrompt({ sessionID, id: promptB, text: "prompt B" })

        expect(compaction).toMatchObject({ id: compactionID, sessionID })
        expect(coalesced).toEqual(compaction)

        const first = yield* inbox.deliver(sessionID)
        const second = yield* inbox.deliver(sessionID)
        const beforeCompaction = yield* SessionMessage.context(database, workspaceA, sessionID)
        const repeated = yield* inbox.admitCompaction({ sessionID, id: compactionID })
        const third = yield* inbox.deliver(sessionID)
        const afterCompaction = yield* SessionMessage.context(database, workspaceA, sessionID)

        expect([first?.type, second?.type, third?.type]).toEqual(["prompt", "prompt", "compaction"])
        expect(third).toMatchObject({ type: "compaction", compaction: { id: compactionID } })
        expect(beforeCompaction.map((message) => message.type)).toEqual(["user", "assistant", "user", "assistant"])
        expect(afterCompaction.map((message) => message.type)).toEqual([
          "user",
          "assistant",
          "user",
          "assistant",
          "compaction",
        ])
        expect(repeated).toMatchObject({ id: compactionID, sessionID })
        expect((yield* SessionMessage.context(database, workspaceA, sessionID)).map((message) => message.id)).toEqual([
          promptA,
          first?.type === "prompt" ? first.assistant.id : undefined,
          promptB,
          second?.type === "prompt" ? second.assistant.id : undefined,
          compactionID,
        ])
        expect(yield* inbox.deliver(sessionID)).toBeUndefined()
      }).pipe(Effect.provide(Layer.mergeAll(databaseLayer, busLayer, inboxLayer)))
    }),
  )

  effectIt.effect("retains interruption at the promotion and continuation commit boundary", () =>
    Effect.gen(function* () {
      for (const mode of ["promotion", "continuation"] as const) {
        const created = yield* Session.Service.use((sessions) => sessions.create({ projectID })).pipe(
          Effect.provide(layerA),
        )
        const inputID = MessageID.make(
          mode === "promotion" ? "00000000-0000-4000-8000-000000000615" : "00000000-0000-4000-8000-000000000618",
        )
        if (mode === "promotion") {
          yield* SessionInbox.Service.use((inbox) =>
            inbox.admitPrompt({ sessionID: created.id, id: inputID, text: "interrupt at commit" }),
          ).pipe(Effect.provide(makeRunnerDependencies(workspaceA)))
        } else {
          yield* Database.Service.use((database) =>
            Effect.gen(function* () {
              const events = yield* Bus.Service
              yield* insertAssistant(database, created, inputID, selectedModel)
              yield* SessionMessage.complete(database, events, workspaceA, created.id, inputID, "unknown")
            }),
          ).pipe(Effect.provide(makeRunnerDependencies(workspaceA)))
        }

        const activating = yield* Deferred.make<void>()
        const interrupting = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const events = yield* Bus.Service
          const inbox = yield* SessionInbox.Service
          const runner = yield* Runner.make(database, events, workspaceA, inbox, {
            beforeActivate: () => Deferred.succeed(activating, undefined).pipe(Effect.andThen(Deferred.await(release))),
          })
          const worker = yield* runner.run(created.id).pipe(Effect.forkChild)
          yield* Deferred.await(activating)

          const physicallyCommitted = yield* SessionMessage.context(database, workspaceA, created.id)
          expect(physicallyCommitted.at(-1)).toMatchObject({ type: "assistant" })
          expect(physicallyCommitted.at(-1)).not.toHaveProperty("error")

          const interruption = yield* Deferred.succeed(interrupting, undefined).pipe(
            Effect.andThen(Fiber.interrupt(worker)),
            Effect.forkChild,
          )
          yield* Deferred.await(interrupting)
          yield* Effect.yieldNow
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(interruption)
          yield* Fiber.await(worker)
        }).pipe(Effect.scoped, Effect.provide(makeRunnerDependencies(workspaceA)))

        const result = yield* Session.Service.use((sessions) =>
          Effect.gen(function* () {
            const page = yield* sessions.messages({ sessionID: created.id, order: "asc" })
            return { page }
          }),
        ).pipe(Effect.scoped, Effect.provide(makeLayer(workspaceA)))
        expect(
          result.page.find(
            (message) => message.type === "assistant" && message.error?._tag === "SessionError.AbortedError",
          ),
        ).toMatchObject({
          type: "assistant",
          error: { _tag: "SessionError.AbortedError" },
          time: { completed: expect.any(Date) },
        })
      }
    }),
  )

  effectIt.effect("interrupts a root blocked on a foreground subagent and resumes it after restart", () =>
    Effect.gen(function* () {
      const created = yield* Session.Service.use((sessions) => sessions.create({ projectID })).pipe(
        Effect.provide(layerA),
      )
      const messageID = MessageID.make("00000000-0000-4000-8000-000000000616")

      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const assistant = yield* insertAssistant(database, created, messageID, selectedModel)
        const recorder = yield* SessionRecorder.make({ database, events, assistant, workspaceID: workspaceA })
        yield* recorder.write(
          LLMEvent.toolCall({
            id: "call_restart_subagent",
            name: "subagent",
            input: { agent: "explore", description: "inspect restart", prompt: "inspect" },
          }),
        )
      }).pipe(Effect.provide(makeRunnerDependencies(workspaceA)))

      const recovered = yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const events = yield* Bus.Service
          yield* sessions.awaitIdle(created.id)
          return {
            page: yield* sessions.messages({ sessionID: created.id, order: "asc" }),
          }
        }),
      ).pipe(Effect.provide(makeLayer(workspaceA)))
      expect(recovered.page).toMatchObject([
        {
          id: messageID,
          type: "assistant",
          content: [
            {
              type: "tool",
              name: "subagent",
              state: { status: "error", error: { _tag: "SessionError.AbortedError" } },
            },
          ],
          error: { _tag: "SessionError.AbortedError" },
          time: { completed: expect.any(Date) },
        },
        {
          type: "synthetic",
          text: "The server restarted while you were working. Continue from where you left off without repeating completed work.",
          description: "Continuing after restart",
        },
        {
          type: "assistant",
          error: { message: expect.any(String) },
          time: { completed: expect.any(Date) },
        },
      ])
    }),
  )

  effectIt.effect("excludes child Sessions from independent startup recovery", () =>
    Effect.gen(function* () {
      const created = yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const parent = yield* sessions.create({ projectID })
          return yield* sessions.createChild({ parentID: parent.id, title: "Process-owned child" })
        }),
      ).pipe(Effect.provide(layerA))
      const inputID = MessageID.make("00000000-0000-4000-8000-000000000698")
      const assistantID = MessageID.make(crypto.randomUUID())
      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const inbox = yield* SessionInbox.Service
        yield* inbox.admitPrompt({ sessionID: created.id, id: inputID, text: "owned by a process-local Job" })
        yield* insertAssistant(database, created, assistantID, selectedModel)
      }).pipe(Effect.provide(makeRunnerDependencies(workspaceA)))
      const calls = yield* Ref.make(0)
      const countedProvider = withProviderStream(() =>
        Stream.fromEffect(Ref.update(calls, (count) => count + 1)).pipe(Stream.drain),
      )

      const pending = yield* Effect.gen(function* () {
        const inbox = yield* SessionInbox.Service
        yield* Effect.yieldNow
        return yield* inbox.list
      }).pipe(Effect.provide(makeLayer(workspaceA, countedProvider)))

      expect(pending).toContain(created.id)
      expect(yield* Ref.get(calls)).toBe(0)
      const childMessages = yield* Session.Service.use((sessions) =>
        sessions.messages({ sessionID: created.id }),
      ).pipe(Effect.provide(makeLayer(workspaceA, countedProvider)))
      const childAssistant = childMessages.find((message) => message.id === assistantID)
      expect(childAssistant).toMatchObject({ type: "assistant" })
      expect(childAssistant?.type === "assistant" ? childAssistant.time.completed : "missing").toBeUndefined()
    }),
  )

  effectIt.effect("does not treat historical run facts or delivered manual compaction as recovery work", () =>
    Effect.gen(function* () {
      const created = yield* Session.Service.use((sessions) =>
        Effect.all({
          unmatched: sessions.create({ projectID }),
          compacting: sessions.create({ projectID }),
          completed: sessions.create({ projectID }),
        }),
      ).pipe(Effect.provide(layerA))
      // Build the historical facts outside the retained execution graph: its
      // execution delivers an admitted compaction itself, which would race the
      // fixture's own delivery.
      const fixtures = yield* Effect.gen(function* () {
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const database = yield* Database.Service
        const { unmatched, compacting, completed } = created
        yield* events.publish(SessionEvent.RunStarted, { sessionID: unmatched.id })

        const compaction = yield* inbox.admitCompaction({ sessionID: compacting.id })
        expect(compaction).toBeDefined()
        expect(yield* inbox.deliver(compacting.id)).toMatchObject({ type: "compaction" })
        expect(yield* inbox.list).not.toContain(compacting.id)
        expect((yield* SessionMessage.context(database, workspaceA, compacting.id)).at(-1)).toMatchObject({
          type: "compaction",
          status: "running",
        })

        const messageID = MessageID.make(crypto.randomUUID())
        const assistant = yield* insertAssistant(database, completed, messageID, selectedModel)
        const recorder = yield* SessionRecorder.make({ database, events, assistant, workspaceID: workspaceA })
        yield* recorder.fail(SessionError.Provider.make({ message: "already terminal" }))
        return { unmatched, compacting, completed }
      }).pipe(Effect.provide(makeRunnerDependencies(workspaceA)))
      yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          for (const session of Object.values(fixtures)) yield* sessions.awaitIdle(session.id)
        }),
      ).pipe(Effect.scoped, Effect.provide(makeLayer(workspaceA)))

      expect(yield* Session.Service.use((sessions) => sessions.active).pipe(Effect.provide(layerA))).toEqual(new Set())
    }),
  )

  effectIt.effect("joins prompt execution through resume and waits for provider settlement", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const settled = yield* Deferred.make<void>()
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die(new Error("unused")),
          update: () => Effect.die(new Error("unused")),
        }),
      )
      const provider = withProviderStream(() =>
        Stream.fromEffect(Deferred.succeed(started, undefined)).pipe(
          Stream.drain,
          Stream.concat(
            Stream.fromEffect(Deferred.await(release).pipe(Effect.ensuring(Deferred.succeed(settled, undefined)))).pipe(
              Stream.drain,
            ),
          ),
        ),
      )

      yield* Effect.gen(function* () {
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ projectID })
        const child = yield* sessions.createChild({
          parentID: parent.id,
          title: "Resume child",
          agent: executableAgent.id,
          model: executableModel,
        })
        expect(yield* sessions.active).toEqual(new Set())
        yield* sessions.prompt({
          sessionID: child.id,
          id: MessageID.make("00000000-0000-4000-8000-000000000697"),
          text: "resume immediately",
        })
        const resumed = yield* sessions.resume(child.id).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const snapshot = yield* sessions.active
        expect(snapshot).toEqual(new Set([child.id]))
        if (!(snapshot instanceof Set)) throw new Error("expected copied active Set")
        snapshot.clear()
        expect(yield* sessions.active).toEqual(new Set([child.id]))
        expect(yield* Deferred.isDone(settled)).toBe(false)
        yield* Deferred.succeed(release, undefined)
        const failure = yield* Fiber.join(resumed).pipe(Effect.flip)

        expect(yield* Deferred.isDone(settled)).toBe(true)
        expect(yield* sessions.active).toEqual(new Set())
        expect(failure).toEqual(
          new Runner.RunError({
            error: SessionError.Provider.make({ message: "Provider stream ended without finish" }),
          }),
        )
        expect(yield* sessions.get(child.id)).not.toHaveProperty("activity")
      }).pipe(Effect.scoped, Effect.provide(makeLayer(workspaceA, provider, executableAgents)))
    }),
  )

  effectIt.effect("interrupts active descendants before recursively deleting a Session tree", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die(new Error("unused")),
          update: () => Effect.die(new Error("unused")),
        }),
      )
      const provider = withProviderStream(() =>
        Stream.fromEffect(
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Deferred.succeed(interrupted, undefined).pipe(Effect.andThen(Deferred.await(release))),
            ),
          ),
        ),
      )

      yield* Effect.gen(function* () {
        const sessions = yield* Session.Service
        const events = yield* Bus.Service
        const parent = yield* sessions.create({ projectID })
        const child = yield* sessions.createChild({
          parentID: parent.id,
          title: "Active child",
          agent: executableAgent.id,
          model: executableModel,
        })
        const grandchild = yield* sessions.createChild({ parentID: child.id, title: "Nested child" })
        const lifecycleStream = yield* events.subscribe([
          SessionEvent.RunSucceeded,
          SessionEvent.RunFailed,
          SessionEvent.RunInterrupted,
          SessionEvent.Deleted,
        ])
        const lifecycle = yield* lifecycleStream.pipe(
          Stream.takeUntil(
            (event) => event.type === SessionEvent.Deleted.type && event.data.sessionID === parent.id,
          ),
          Stream.runCollect,
          Effect.forkChild,
        )
        const deletedStream = yield* events.subscribe(SessionEvent.Deleted)
        const deleted = yield* deletedStream.pipe(
          Stream.filter((event) => [parent.id, child.id, grandchild.id].includes(event.data.sessionID)),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild,
        )
        yield* sessions.prompt({
          sessionID: child.id,
          id: MessageID.make("00000000-0000-4000-8000-000000000696"),
          text: "run until deleted",
        })
        yield* Deferred.await(started)
        const removing = yield* sessions.delete(parent.id).pipe(Effect.forkChild)
        yield* Deferred.await(interrupted)

        expect(yield* sessions.get(parent.id)).toMatchObject({ id: parent.id })
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(removing)
        const observed = yield* Fiber.join(lifecycle)
        const childTerminals = [...observed].filter(
          (event) => event.type.startsWith("session.run.") && event.data.sessionID === child.id,
        )
        expect(childTerminals).toEqual([
          expect.objectContaining({
            type: SessionEvent.RunInterrupted.type,
            data: { sessionID: child.id, reason: "superseded" },
          }),
        ])
        expect(
          [...observed].findIndex(
            (event) => event.type === SessionEvent.RunInterrupted.type && event.data.sessionID === child.id,
          ),
        ).toBeLessThan(
          [...observed].findIndex(
            (event) => event.type === SessionEvent.Deleted.type && event.data.sessionID === child.id,
          ),
        )

        expect([...(yield* Fiber.join(deleted))].map((event) => event.data.sessionID)).toEqual([
          grandchild.id,
          child.id,
          parent.id,
        ])
        for (const sessionID of [parent.id, child.id, grandchild.id]) {
          expect(yield* sessions.get(sessionID).pipe(Effect.flip)).toEqual(new Session.NotFoundError({ sessionID }))
        }
      }).pipe(Effect.scoped, Effect.provide(makeLayer(workspaceA, provider, executableAgents)))
    }),
  )

  effectIt.effect("publishes exact user and shutdown interruption lifecycles after Assistant cleanup", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )

      for (const reason of ["user", "shutdown"] as const) {
        const started = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const calls = yield* Ref.make(0)
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(
          makeLayer(
            workspaceA,
            withProviderStream((input) =>
              input.context.purpose === "title"
                ? Stream.make(LLMEvent.textDelta({ id: "title", text: "Interrupted" }))
                : Stream.fromEffect(Ref.getAndUpdate(calls, (count) => count + 1)).pipe(
                    Stream.flatMap((index) =>
                      index === 0
                        ? Stream.fromEffect(
                            Deferred.succeed(started, undefined).pipe(
                              Effect.andThen(Effect.never),
                              Effect.onInterrupt(() =>
                                Deferred.succeed(interrupted, undefined).pipe(Effect.andThen(Deferred.await(release))),
                              ),
                            ),
                          )
                        : Stream.make(LLMEvent.finish({ reason: { normalized: "stop" } })),
                    ),
                  ),
            ),
            executableAgents,
          ),
          scope,
        )
        const sessions = Context.get(context, Session.Service)
        const events = Context.get(context, Bus.Service)
        const created = yield* sessions.create({ projectID, agent: executableAgent.id, model: executableModel })
        const following = yield* followSession(
          events,
          created.id,
          (event) => event.type === SessionEvent.RunInterrupted.type,
        )
        yield* sessions.prompt({ sessionID: created.id, text: reason })
        yield* Deferred.await(started)

        if (reason === "user") {
          yield* sessions.interrupt(created.id, "user")
          yield* Deferred.await(interrupted)
          yield* Deferred.succeed(release, undefined)
          yield* sessions.awaitIdle(created.id)
        } else {
          const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
          yield* Deferred.await(interrupted)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(closing)
        }

        const replay = yield* Fiber.join(following)
        const terminalTypes: ReadonlySet<string> = new Set([
          SessionEvent.RunSucceeded.type,
          SessionEvent.RunFailed.type,
          SessionEvent.RunInterrupted.type,
        ])
        const terminals = [...replay].filter((event) => terminalTypes.has(event.type))
        expect(terminals).toEqual([
          expect.objectContaining({
            type: SessionEvent.RunInterrupted.type,
            data: { sessionID: created.id, reason },
          }),
        ])
        expect([...replay].findIndex((event) => event.type === SessionEvent.RunInterrupted.type)).toBeGreaterThan(
          [...replay].findIndex((event) => event.type === SessionEvent.Interrupted.type),
        )

        if (reason === "user") {
          const successor = yield* followSession(
            events,
            created.id,
            (event) => event.type === SessionEvent.RunSucceeded.type,
          )
          yield* sessions.prompt({ sessionID: created.id, text: "successor" })
          yield* sessions.awaitIdle(created.id)
          const successorReplay = yield* Fiber.join(successor)
          expect(
            [...successorReplay].filter((event) => event.type.startsWith("session.run.")).map((event) => event.type),
          ).toEqual([
            SessionEvent.RunStarted.type,
            SessionEvent.RunSucceeded.type,
          ])
          yield* Scope.close(scope, Exit.void)
        }
      }
    }),
  )

  effectIt.effect("settles initial unavailable Instructions without calling the Provider", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die(new Error("unused")),
          update: () => Effect.die(new Error("unused")),
        }),
      )
      const calls = yield* Ref.make(0)
      const countedProvider = Layer.effect(
        Provider.Service,
        Provider.Service.use((provider) =>
          Effect.succeed(
            Provider.Service.of({
              ...provider,
              stream: () => Stream.fromEffect(Ref.update(calls, (count) => count + 1)).pipe(Stream.drain),
            }),
          ),
        ),
      ).pipe(Layer.provide(Provider.layer))
      const unavailableInstruction = Layer.succeed(
        SkillInstruction.Service,
        SkillInstruction.Service.of({
          load: () =>
            Effect.succeed(
              Instruction.make({
                key: InstructionSchema.Key.make("test/unavailable-runner"),
                codec: Schema.String,
                read: Effect.succeed(Instruction.unavailable),
                render: { initial: String, changed: (_, current) => current },
              }),
            ),
        }),
      )
      const created = yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const created = yield* sessions.create({ projectID })
          yield* sessions.switchModel({ sessionID: created.id, model: executableModel })
          return created
        }),
      ).pipe(Effect.provide(layerA))
      const inputID = MessageID.make("00000000-0000-4000-8000-000000000620")
      const messages = yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const following = yield* followSession(
          events,
          created.id,
          (event) => event.type === SessionEvent.Failed.type,
        )
        yield* inbox.admitPrompt({ sessionID: created.id, id: inputID, text: "temporarily unavailable" })
        const runner = yield* Runner.make(database, events, workspaceA, inbox)
        const failure = yield* runner.run(created.id).pipe(Effect.flip)
        expect(failure).toEqual(
          new Runner.RunError({
            error: SessionError.Internal.make({ message: "Instructions are temporarily unavailable" }),
          }),
        )
        return yield* SessionMessage.context(database, workspaceA, created.id)
      }).pipe(
        Effect.provide(makeRunnerDependencies(workspaceA, countedProvider, executableAgents, unavailableInstruction)),
      )

      expect(yield* Ref.get(calls)).toBe(0)
      expect(messages.at(-1)).toMatchObject({
        type: "assistant",
        error: {
          _tag: "SessionError.InternalError",
          message: "Instructions are temporarily unavailable",
        },
        time: { completed: expect.any(Date) },
      })
    }),
  )

  effectIt.effect("preserves exact Assistant errors across Runner and run lifecycle terminal families", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: (id) => Effect.succeed(id === executableAgent.id ? executableAgent : undefined),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const cases = [
        {
          name: "resolution",
          stream: () => Stream.empty,
          prepare: (database: Database.Interface, sessionID: SessionSchema.ID) =>
            database
              .use("runFailureUnknownAgent", (db) =>
                db
                  .update(SessionTable)
                  .set({ agent: AgentSchema.ID.make("missing") })
                  .where(eq(SessionTable.id, sessionID)),
              )
              .pipe(Effect.asVoid),
          error: SessionError.Provider.make({ message: "Agent selection not found: missing" }),
        },
        {
          name: "provider stream",
          stream: () =>
            Stream.fail(
              new Provider.FailureError({
                cause: "provider unavailable",
                message: "Invalid API key",
                category: "auth",
                status: 401,
                provider: "fireworks",
                model: "accounts/fireworks/models/test",
                requestID: "req_123",
                responseBody: '{"error":{"message":"Invalid API key"}}',
                bodyTruncated: false,
              }),
            ),
          prepare: () => Effect.void,
          error: SessionError.Provider.make({
            message: "Fireworks: authentication failed (401): Invalid API key",
            category: "auth",
            status: 401,
            provider: "fireworks",
            model: "accounts/fireworks/models/test",
            requestID: "req_123",
            responseBody: '{"error":{"message":"Invalid API key"}}',
            bodyTruncated: false,
          }),
        },
        {
          name: "provider error finish",
          stream: () => Stream.make(LLMEvent.finish({ reason: { normalized: "error" } })),
          prepare: () => Effect.void,
          error: SessionError.Provider.make({ message: "Provider execution failed" }),
        },
        {
          name: "content filter finish",
          stream: () => Stream.make(LLMEvent.finish({ reason: { normalized: "content-filter" } })),
          prepare: () => Effect.void,
          error: SessionError.Provider.make({ message: "The response was blocked by the provider's content filter" }),
        },
        {
          name: "recorder structure",
          stream: () =>
            Stream.fromIterable([
              LLMEvent.textStart({ id: "open" }),
              LLMEvent.finish({ reason: { normalized: "stop" } }),
            ]),
          prepare: () => Effect.void,
          error: SessionError.Provider.make({ message: "Provider stream ended before text end: open" }),
        },
      ] as const

      for (const testCase of cases) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const events = yield* Bus.Service
            const database = yield* Database.Service
            const created = yield* sessions.create({
              projectID,
              agent: executableAgent.id,
              model: executableModel,
            })
            yield* testCase.prepare(database, created.id)
            const following = yield* followSession(
              events,
              created.id,
              (event) => event.type === SessionEvent.RunFailed.type,
            )
            yield* sessions.prompt({ sessionID: created.id, text: testCase.name, resume: false })
            const failure = yield* sessions.resume(created.id).pipe(Effect.flip)
            expect(failure).toEqual(new Runner.RunError({ error: testCase.error }))
            const replay = yield* Fiber.join(following)
            const terminal = [...replay].filter(
              (event) => event.type === SessionEvent.Failed.type || event.type === SessionEvent.RunFailed.type,
            )
            expect(terminal.map((event) => event.type)).toEqual([SessionEvent.Failed.type, SessionEvent.RunFailed.type])
            expect(terminal.map((event) => event.data.error)).toEqual([testCase.error, testCase.error])
            expect([...replay].some((event) => event.type === SessionEvent.RunSucceeded.type)).toBe(false)
          }).pipe(Effect.provide(makeLayer(workspaceA, withProviderStream(testCase.stream), executableAgents))),
        )
      }
    }),
  )


  effectIt.live("honors a Session retry hook delay before retrying an Assistant", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const calls = yield* Ref.make(0)
      const failure = new AIError({
        reason: new RateLimitError({ message: "limited" }),
      })
      const provider = withProviderStream(() =>
        Stream.unwrap(
          Ref.modify(
            calls,
            (count) =>
              [
                count % 2 === 0
                  ? Stream.fail(new Provider.FailureError({ cause: failure }))
                  : Stream.fromIterable([
                      LLMEvent.stepStart({ index: 0 }),
                      LLMEvent.textStart({ id: "answer" }),
                      LLMEvent.textDelta({ id: "answer", text: "Recovered" }),
                      LLMEvent.textEnd({ id: "answer" }),
                      LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
                      LLMEvent.finish({ reason: { normalized: "stop" } }),
                    ]),
                count + 1,
              ] as const,
          ),
        ),
      )
      const created = yield* Session.Service.use((sessions) =>
        sessions.create({ projectID, agent: executableAgent.id, model: executableModel }),
      ).pipe(Effect.provide(layerA))
      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const hooks = yield* PluginHooks.Service
        const decisions: Array<{ readonly attempt: number; readonly delay: number }> = []
        yield* hooks.register("session", "retry", (event) =>
          Effect.sync(() => {
            event.decision = { retry: true, delay: 0 }
            decisions.push({ attempt: event.attempt, delay: event.decision.delay })
          }),
        )
        yield* inbox.admitPrompt({ sessionID: created.id, text: "retry" })
        yield* events.publish(SessionEvent.RunStarted, { sessionID: created.id })
        const scheduledStream = yield* events.subscribe(SessionEvent.RetryScheduled)
        const scheduled = yield* scheduledStream.pipe(
          Stream.filter((event) => event.data.sessionID === created.id),
          Stream.take(1),
          Stream.runHead,
          Effect.forkChild,
        )
        const attemptStream = yield* events.subscribe([
          SessionEvent.ExecutionModelRouted,
          SessionEvent.ExecutionStreamed,
        ])
        const attempts = yield* attemptStream.pipe(
          Stream.filter((event) => event.data.sessionID === created.id),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild,
        )
        const runner = yield* Runner.make(database, events, workspaceA, inbox)
        yield* runner.run(created.id)
        const retry = Option.getOrThrow(yield* Fiber.join(scheduled))
        const observed = [...(yield* Fiber.join(attempts))]

        expect(retry.data.attempt).toBe(2)
        expect(decisions).toEqual([{ attempt: 2, delay: 0 }])
        expect(yield* Ref.get(calls)).toBe(2)
        const routed = observed.filter((event) => event.type === SessionEvent.ExecutionModelRouted.type)
        expect(routed).toHaveLength(2)
        const streamed = observed.filter((event) => event.type === SessionEvent.ExecutionStreamed.type)
        expect(streamed).toHaveLength(1)
        expect(streamed[0]?.data).toMatchObject({ attempt: 2 })
        const messages = yield* SessionMessage.context(database, workspaceA, created.id)
        expect(messages.filter((message) => message.type === "assistant")).toMatchObject([
          {
            id: retry.data.messageID,
            content: [{ type: "text", text: "Recovered" }],
            time: { streamed: expect.any(Date), completed: expect.any(Date) },
          },
        ])
        expect(messages.at(-1)).toMatchObject({ retry: { attempt: 2 } })

        // A later proposal reaches the same runner boundary. The hook can
        // veto it, so no second physical request is made for that Session.
        const vetoed = yield* Session.Service.use((sessions) =>
          sessions.create({ projectID, agent: executableAgent.id, model: executableModel }),
        ).pipe(Effect.provide(layerA))
        let veto = true
        yield* hooks.register("session", "retry", (event) =>
          Effect.sync(() => {
            if (veto) event.decision = { retry: false }
          }),
        )
        yield* inbox.admitPrompt({ sessionID: vetoed.id, text: "veto" })
        expect(yield* runner.run(vetoed.id).pipe(Effect.flip)).toMatchObject({ _tag: "Session.Runner.RunError" })
        expect(yield* Ref.get(calls)).toBe(3)
        veto = false
      }).pipe(Effect.provide(makeRunnerDependencies(workspaceA, provider, executableAgents)))
    }),
  )

  effectIt.effect("classifies declined, failed Tool-success publication, and finishTools failures exactly", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const cases = [
        {
          name: "declined",
          providerEvents: [
            LLMEvent.toolCall({ id: "call", name: "focused", input: {} }),
            LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
          ],
          execute: Effect.die(new Permission.RejectedError({})),
          hooks: undefined,
          error: SessionError.Aborted.make({ message: "Step interrupted" }),
        },
        {
          name: "failed Tool-success publication",
          providerEvents: [
            LLMEvent.toolCall({ id: "call", name: "focused", input: {} }),
            LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
          ],
          execute: Effect.succeed({ output: {}, content: [], metadata: {} }),
          hooks: {
            succeedTool: (id: string) =>
              Effect.fail(new SessionRecorder.OrderError({ message: `Tool success publication failed: ${id}` })),
          },
          error: SessionError.Internal.make({ message: "Tool success publication failed: call" }),
        },
        {
          name: "finishTools",
          providerEvents: [
            LLMEvent.toolCall({ id: "call", name: "focused", input: {} }),
            LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
          ],
          execute: Effect.succeed({ output: {}, content: [], metadata: {} }),
          hooks: {
            beforeFinishTools: (recorder: SessionRecorder.Interface) =>
              recorder.write(LLMEvent.toolCall({ id: "late", name: "focused", input: {} })).pipe(Effect.orDie),
          },
          error: SessionError.Provider.make({ message: "Tool call did not settle: late" }),
        },
      ] as const

      for (const testCase of cases) {
        const sessionTools = Layer.succeed(
          SessionTools.Service,
          SessionTools.Service.of({
            resolve: () =>
              Effect.succeed({
                definitions: [
                  { type: "tool" as const, name: "focused", description: "Focused lifecycle fixture", inputSchema: { type: "object" } },
                ],
                execute: () => testCase.execute,
              }),
          }),
        )
        const provider = withProviderStream(() => Stream.fromIterable(testCase.providerEvents))
        const created = yield* Session.Service.use((sessions) =>
          sessions.create({ projectID, agent: executableAgent.id, model: executableModel }),
        ).pipe(Effect.provide(layerA))
        yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const events = yield* Bus.Service
          const inbox = yield* SessionInbox.Service
          const runner = yield* Runner.make(database, events, workspaceA, inbox, testCase.hooks)
          const following = yield* followSession(
            events,
            created.id,
            (event) => event.type === SessionEvent.RunFailed.type,
          )
          yield* inbox.admitPrompt({ sessionID: created.id, text: testCase.name })
          yield* events.publish(SessionEvent.RunStarted, { sessionID: created.id })
          const failure = yield* runner.run(created.id).pipe(Effect.flip)
          expect(failure).toEqual(new Runner.RunError({ error: testCase.error }))
          yield* events.publish(SessionEvent.RunFailed, { sessionID: created.id, error: failure.error })
          const replay = yield* Fiber.join(following)
          const assistantIndex = [...replay].findIndex((event) => event.type === SessionEvent.Failed.type)
          const runIndex = [...replay].findIndex((event) => event.type === SessionEvent.RunFailed.type)
          expect(assistantIndex).toBeGreaterThan(-1)
          expect(runIndex).toBeGreaterThan(assistantIndex)
          expect(replay[assistantIndex]).toMatchObject({ data: { error: testCase.error } })
          expect(replay[runIndex]).toMatchObject({ data: { error: testCase.error } })
          expect([...replay].filter((event) => event.type === SessionEvent.RunSucceeded.type)).toHaveLength(0)
        }).pipe(
          Effect.scoped,
          Effect.provide(
            makeRunnerDependencies(workspaceA, provider, executableAgents, defaultInstruction, sessionTools),
          ),
        )
      }
    }),
  )

  effectIt.effect("sanitizes a Runner defect in the failed run event", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const defect = new Error("run exploded")
      yield* Effect.gen(function* () {
        const sessions = yield* Session.Service
        const events = yield* Bus.Service
        const created = yield* sessions.create({ projectID, agent: executableAgent.id, model: executableModel })
        const following = yield* followSession(
          events,
          created.id,
          (event) => event.type === SessionEvent.RunFailed.type,
        )
        yield* sessions.prompt({ sessionID: created.id, text: "explode", resume: false })
        const exit = yield* sessions.resume(created.id).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        const replay = yield* Fiber.join(following)
        const failed = [...replay].findLast((event) => event.type === SessionEvent.RunFailed.type)
        expect(failed).toMatchObject({
          data: { error: { _tag: "SessionError.InternalError", message: "Session run failed" } },
        })
        expect(JSON.stringify(failed)).not.toContain(defect.message)
      }).pipe(
        Effect.scoped,
        Effect.provide(
          makeLayer(
            workspaceA,
            withProviderStream(() => Stream.die(defect)),
            executableAgents,
          ),
        ),
      )
    }),
  )

  effectIt.effect("propagates every manual-compaction outcome through the run lifecycle", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const cases = [
        {
          name: "nothing to compact",
          seed: false,
          route: true,
          compact: Stream.make(LLMEvent.textDelta({ id: "summary", text: "unused" })),
          error: SessionError.Internal.make({ message: "Nothing to compact yet" }),
        },
        {
          name: "routing failure",
          seed: true,
          route: false,
          compact: Stream.empty,
          error: SessionError.Provider.make({ message: "Compaction model routing failed" }),
        },
        {
          name: "provider failure",
          seed: true,
          route: true,
          compact: Stream.fail(
            new Provider.FailureError({ cause: "compaction failed", message: "compaction failed", category: "transport" }),
          ),
          error: SessionError.Provider.make({
            message: "Provider: transport failed: compaction failed",
            category: "transport",
          }),
        },
        {
          name: "empty summary",
          seed: true,
          route: true,
          compact: Stream.empty,
          error: SessionError.Internal.make({ message: "Compaction produced no summary" }),
        },
      ] as const

      for (const testCase of cases) {
        // The first prompt forks a background title request; only the compaction
        // request may receive the case's stream, or the title fiber consumes it
        // and races the asserted run.
        const provider = withProviderStream((input) =>
          input.context.purpose === "assistant"
            ? Stream.make(LLMEvent.finish({ reason: { normalized: "stop" } }))
            : input.context.purpose === "compaction"
              ? testCase.compact
              : Stream.empty,
        )
        yield* Effect.scoped(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const inbox = yield* SessionInbox.Service
            const events = yield* Bus.Service
            const database = yield* Database.Service
            const created = yield* sessions.create({
              projectID,
              agent: executableAgent.id,
              model: executableModel,
            })
            if (testCase.seed) {
              yield* sessions.prompt({ sessionID: created.id, text: "content to compact", resume: false })
              yield* sessions.resume(created.id)
            }
            if (!testCase.route)
              yield* database
                .use("manualCompactionRoutingFailure", (db) =>
                  db
                    .update(SessionTable)
                    .set({ model: { provider: ProviderSchema.Name.make("missing"), id: "missing" } })
                    .where(eq(SessionTable.id, created.id)),
                )
                .pipe(Effect.asVoid)
            // Admission publishes CompactionRequested, which wakes the Coordinator
            // and starts the run before this fiber continues. Subscribe first so
            // the follower sees the whole lifecycle, and settle through awaitIdle:
            // `resume` is "start or join", so once the woken run has settled it
            // would start a fresh empty run that succeeds instead of joining.
            const following = yield* followSession(
              events,
              created.id,
              (event) => event.type === SessionEvent.RunFailed.type,
            )
            const compaction = yield* inbox.admitCompaction({ sessionID: created.id })
            expect(compaction).toBeDefined()
            const replay = yield* Fiber.join(following)
            yield* sessions.awaitIdle(created.id)
            const runStarted = [...replay].find((event) => event.type === SessionEvent.RunStarted.type)
            const compactionStarted = [...replay].find(
              (event) => event.type === SessionEvent.CompactionStarted.type && event.data.message.id === compaction?.id,
            )
            const compactionFailed = [...replay].find(
              (event) => event.type === SessionEvent.CompactionFailed.type && event.data.message.id === compaction?.id,
            )
            const runFailed = [...replay].findLast((event) => event.type === SessionEvent.RunFailed.type)
            expect(runStarted).toBeDefined()
            expect(compactionStarted).toBeDefined()
            expect(compactionFailed).toMatchObject({ data: { message: { error: testCase.error } } })
            expect(runFailed).toEqual(
              expect.objectContaining({
                type: SessionEvent.RunFailed.type,
                data: { sessionID: created.id, error: testCase.error },
              }),
            )
            expect(replay.indexOf(runStarted!)).toBeLessThan(replay.indexOf(compactionStarted!))
            expect(replay.indexOf(compactionStarted!)).toBeLessThan(replay.indexOf(compactionFailed!))
            expect(replay.indexOf(compactionFailed!)).toBeLessThan(replay.indexOf(runFailed!))
            expect([...replay].filter((event) => event.type === SessionEvent.RunSucceeded.type)).toHaveLength(0)
            expect([...replay].filter((event) => event.type === SessionEvent.RunStarted.type)).toHaveLength(1)
            // Other Sessions in the shared database may be recovering under this layer.
            expect([...(yield* sessions.active)]).not.toContain(created.id)
          }).pipe(Effect.provide(makeLayer(workspaceA, provider, executableAgents))),
        )
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const inbox = yield* SessionInbox.Service
          const events = yield* Bus.Service
          const created = yield* sessions.create({ projectID, agent: executableAgent.id, model: executableModel })
          yield* sessions.prompt({ sessionID: created.id, text: "content", resume: false })
          yield* sessions.resume(created.id)
          const following = yield* followSession(
            events,
            created.id,
            (event) => event.type === SessionEvent.RunSucceeded.type,
          )
          const compaction = yield* inbox.admitCompaction({ sessionID: created.id })
          expect(compaction).toBeDefined()
          const replay = yield* Fiber.join(following)
          yield* sessions.awaitIdle(created.id)
          expect([...(yield* sessions.active)]).not.toContain(created.id)
          expect(
            [...replay].filter(
              (event) => event.type === SessionEvent.CompactionEnded.type && event.data.message.id === compaction?.id,
            ),
          ).toHaveLength(1)
          expect([...replay].filter((event) => event.type === SessionEvent.ExecutionStarted.type)).toHaveLength(0)
          expect(
            [...replay].findLast(
              (event) => event.type.startsWith("session.run.") && event.type !== SessionEvent.RunStarted.type,
            )?.type,
          ).toBe(SessionEvent.RunSucceeded.type)
        }).pipe(
          Effect.provide(
            makeLayer(
              workspaceA,
              withProviderStream((input) =>
                input.context.purpose === "assistant"
                  ? Stream.make(LLMEvent.finish({ reason: { normalized: "stop" } }))
                  : Stream.make(LLMEvent.textDelta({ id: "summary", text: "## Objective\n- done" })),
              ),
              executableAgents,
            ),
          ),
        ),
      )
    }),
  )

  effectIt.effect("keeps resume joined until a Tool continuation persists its final response", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die(new Error("unused")),
          update: () => Effect.die(new Error("unused")),
        }),
      )
      const continuationStarted = yield* Deferred.make<void>()
      const releaseContinuation = yield* Deferred.make<void>()
      const calls = yield* Ref.make(0)
      const firstEvents: ReadonlyArray<LLMEvent> = [
        LLMEvent.toolCall({ id: "call_missing", name: "missing", input: {} }),
        LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
      ]
      const finalEvents: ReadonlyArray<LLMEvent> = [
        LLMEvent.textStart({ id: "final" }),
        LLMEvent.textDelta({ id: "final", text: "final response" }),
        LLMEvent.textEnd({ id: "final" }),
        LLMEvent.finish({ reason: { normalized: "stop" } }),
      ]
      const provider = withProviderStream((input) => {
        if (input.context.purpose === "title")
          return Stream.make(LLMEvent.textDelta({ id: "title", text: "Continuation" }))
        return Stream.fromEffect(Ref.getAndUpdate(calls, (count) => count + 1)).pipe(
          Stream.flatMap((index) => {
            if (index === 0) return Stream.fromIterable(firstEvents)
            return Stream.fromEffect(
              Deferred.succeed(continuationStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseContinuation)),
              ),
            ).pipe(Stream.flatMap(() => Stream.fromIterable(finalEvents)))
          }),
        )
      })

      yield* Effect.gen(function* () {
        const sessions = yield* Session.Service
        const created = yield* sessions.create({ projectID, agent: executableAgent.id, model: executableModel })
        yield* sessions.prompt({ sessionID: created.id, text: "run the tool", resume: false })
        const resumeDone = yield* Deferred.make<void>()
        const resumed = yield* sessions
          .resume(created.id)
          .pipe(Effect.ensuring(Deferred.succeed(resumeDone, undefined)), Effect.forkChild)

        yield* Deferred.await(continuationStarted)
        expect(yield* Deferred.isDone(resumeDone)).toBe(false)

        yield* Deferred.succeed(releaseContinuation, undefined)
        yield* Fiber.join(resumed)
        const messages = yield* sessions.messages({ sessionID: created.id, order: "asc" })
        const final = messages.at(-1)
        expect(final).toMatchObject({ type: "assistant", time: { completed: expect.any(Date) } })
        expect(final?.type === "assistant" ? final.content : []).toContainEqual(
          expect.objectContaining({ type: "text", text: "final response" }),
        )
        expect(yield* Ref.get(calls)).toBe(2)
      }).pipe(Effect.scoped, Effect.provide(makeLayer(workspaceA, provider, executableAgents)))
    }),
  )

  effectIt.effect("continues a tool step after a durable instruction update is persisted mid-run", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die(new Error("unused")),
          update: () => Effect.die(new Error("unused")),
        }),
      )
      // Non-title provider calls, in order: establish the baseline, answer a tool step, then the
      // continuation that must still run after a durable instruction update is persisted as a
      // trailing `system` message during the tool step.
      const calls = yield* Ref.make(0)
      const provider = withProviderStream((input) => {
        if (input.context.purpose === "title")
          return Stream.make(LLMEvent.textDelta({ id: "title", text: "Durable update" }))
        return Stream.fromEffect(Ref.getAndUpdate(calls, (count) => count + 1)).pipe(
          Stream.flatMap((index): Stream.Stream<LLMEvent> => {
            if (index === 0) return Stream.make(LLMEvent.finish({ reason: { normalized: "stop" } }))
            if (index === 1)
              return Stream.fromIterable([
                LLMEvent.toolCall({ id: "call_missing", name: "missing", input: {} }),
                LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
              ])
            return Stream.fromIterable([
              LLMEvent.textStart({ id: "final" }),
              LLMEvent.textDelta({ id: "final", text: "final response" }),
              LLMEvent.textEnd({ id: "final" }),
              LLMEvent.finish({ reason: { normalized: "stop" } }),
            ])
          }),
        )
      })
      const messages = yield* Effect.scoped(
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const entries = yield* InstructionEntry.Service
          const created = yield* sessions.create({ projectID, agent: executableAgent.id, model: executableModel })
          // First prompt establishes the durable instruction baseline (initial, no system text).
          yield* sessions.prompt({ sessionID: created.id, text: "first", resume: false })
          yield* sessions.resume(created.id)
          // A durable delta the next execution's first step observes and persists as a system update.
          yield* entries.put({ sessionID: created.id, key: InstructionEntry.Key.make("build.context"), value: "delta" })
          // Second prompt: a tool step followed by the continuation.
          yield* sessions.prompt({ sessionID: created.id, text: "second", resume: false })
          yield* sessions.resume(created.id)
          return yield* sessions.messages({ sessionID: created.id })
        }),
      ).pipe(Effect.provide(makeLayer(workspaceA, provider, executableAgents)))

      // The delta was persisted as a durable system update during the second run.
      expect(messages.some((message) => message.type === "system")).toBe(true)
      // The run continued past the tool step: baseline + tool step + continuation = three calls.
      expect(yield* Ref.get(calls)).toBe(3)
      // The continuation produced the final answer instead of stopping at the tool step.
      expect(
        messages.some(
          (message) =>
            message.type === "assistant" &&
            message.content.some((part) => part.type === "text" && part.text.includes("final response")),
        ),
      ).toBe(true)
    }),
  )

  effectIt.effect("executes each captured Tool snapshot locally and continues through failures and hosted calls", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const requests = yield* Ref.make<ReadonlyArray<Provider.StreamInput>>([])
      const executions = yield* Ref.make<ReadonlyArray<{ readonly generation: number; readonly name: string }>>([])
      const resolutions = yield* Ref.make(0)
      const provider = withProviderStream((input) =>
        Stream.fromEffect(
          Ref.modify(requests, (current) => {
            const index = current.length
            return [index, [...current, input]] as const
          }),
        ).pipe(
          Stream.flatMap((index) => {
            if (index === 0)
              return Stream.fromIterable([
                LLMEvent.toolCall({ id: "call_local_snapshot", name: "snapshot", input: { value: 1 } }),
                LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
              ])
            if (index === 1)
              return Stream.fromIterable([
                LLMEvent.toolCall({ id: "call_unknown_snapshot", name: "missing", input: {} }),
                LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
              ])
            if (index === 2)
              return Stream.fromIterable([
                LLMEvent.toolCall({
                  id: "call_hosted_snapshot",
                  name: "snapshot",
                  input: { value: 3 },
                  providerExecuted: true,
                }),
                LLMEvent.toolResult({
                  id: "call_hosted_snapshot",
                  name: "snapshot",
                  result: { type: "json", value: { hosted: true } },
                  providerExecuted: true,
                }),
                LLMEvent.finish({ reason: { normalized: "stop" } }),
              ])
            return Stream.make(LLMEvent.finish({ reason: { normalized: "stop" } }))
          }),
        ),
      )
      const sessionTools = Layer.succeed(
        SessionTools.Service,
        SessionTools.Service.of({
          resolve: () =>
            Ref.updateAndGet(resolutions, (generation) => generation + 1).pipe(
              Effect.map((generation) => ({
                definitions: [
                  {
                    name: "snapshot",
                    type: "tool" as const,
                    description: `snapshot-${generation}`,
                    inputSchema: { type: "object" },
                  },
                ],
                execute: ({ call }) =>
                  Ref.update(executions, (current) => [...current, { generation, name: call.name }]).pipe(
                    Effect.andThen(
                      call.name === "snapshot"
                        ? Effect.succeed({
                            output: { generation },
                            content: [{ type: "text" as const, text: "x".repeat(60_000) }],
                            metadata: { generation },
                          })
                        : Effect.fail(new ToolSchema.Error({ message: `Unknown tool: ${call.name}` })),
                    ),
                  ),
              })),
            ),
        }),
      )
      const created = yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const created = yield* sessions.create({ projectID })
          yield* sessions.switchModel({ sessionID: created.id, model: executableModel })
          return created
        }),
      ).pipe(Effect.provide(layerA))
      const runtime = makeRunnerDependencies(workspaceA, provider, executableAgents, defaultInstruction, sessionTools)

      const messages = yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        yield* inbox.admitPrompt({
          sessionID: created.id,
          id: MessageID.make("00000000-0000-4000-8000-000000000629"),
          text: "run snapshot tools",
        })
        yield* (yield* Runner.make(database, events, workspaceA, inbox)).run(created.id)
        return yield* SessionMessage.context(database, workspaceA, created.id)
      }).pipe(Effect.provide(runtime))

      expect(yield* Ref.get(executions)).toEqual([{ generation: 1, name: "snapshot" }])
      expect((yield* Ref.get(requests)).map((request) => request.tools?.[0]?.description)).toEqual([
        "snapshot-1",
        "snapshot-2",
        "snapshot-3",
      ])
      const toolParts = messages
        .filter((message) => message.type === "assistant")
        .flatMap((message) => message.content.filter((part) => part.type === "tool"))
      expect(toolParts).toMatchObject([
        {
          id: "call_local_snapshot",
          state: {
            status: "completed",
            result: { generation: 1 },
            metadata: { generation: 1, truncated: true, outputID: expect.any(String) },
          },
        },
        {
          id: "call_unknown_snapshot",
          state: {
            status: "error",
            error: { message: "Tool is unavailable for this model request: missing" },
          },
        },
        {
          id: "call_hosted_snapshot",
          providerExecuted: true,
          state: { status: "completed" },
        },
      ])
      expect(toolParts[0]?.state.status === "completed" ? toolParts[0].state.content[0] : undefined).toMatchObject({
        type: "text",
        text: expect.not.stringMatching(/^x{60000}$/),
      })
    }),
  )

  effectIt.effect("fails malformed Tool input without blocking four valid siblings or exposing raw input", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const raw = '{"first":1}{"second":2}'
      const requests = yield* Ref.make<ReadonlyArray<Provider.StreamInput>>([])
      const provider = withProviderStream((input) =>
        Stream.fromEffect(Ref.modify(requests, (current) => [current.length, [...current, input]] as const)).pipe(
          Stream.flatMap((index) =>
            index === 0
              ? Stream.fromIterable([
                  LLMEvent.toolInputStart({ id: "call_malformed", name: "parallel" }),
                  LLMEvent.toolInputDelta({ id: "call_malformed", name: "parallel", text: raw }),
                  LLMEvent.toolInputError({ id: "call_malformed", name: "parallel", raw }),
                  ...Array.from({ length: 4 }, (_, sibling) =>
                    LLMEvent.toolCall({ id: `call_valid_${sibling}`, name: "parallel", input: { sibling } }),
                  ),
                  LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
                ])
              : Stream.make(LLMEvent.finish({ reason: { normalized: "stop" } })),
          ),
        ),
      )
      const executions = yield* Ref.make<ReadonlyArray<string>>([])
      const sessionTools = Layer.succeed(
        SessionTools.Service,
        SessionTools.Service.of({
          resolve: () =>
            Effect.succeed({
              definitions: [{ type: "tool" as const, name: "parallel", description: "parallel test", inputSchema: { type: "object" } }],
              execute: ({ call }) =>
                Ref.update(executions, (current) => [...current, call.id]).pipe(
                  Effect.as({ content: [{ type: "text" as const, text: call.id }] }),
                ),
            }),
        }),
      )
      const created = yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const created = yield* sessions.create({ projectID })
          yield* sessions.switchModel({ sessionID: created.id, model: executableModel })
          return created
        }),
      ).pipe(Effect.provide(layerA))

      const result = yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const following = yield* followSession(events, created.id, (event) => event.type === SessionEvent.Succeeded.type)
        yield* inbox.admitPrompt({
          sessionID: created.id,
          id: MessageID.make("00000000-0000-4000-8000-000000000633"),
          text: "run all tools",
        })
        yield* (yield* Runner.make(database, events, workspaceA, inbox)).run(created.id)
        const retained = yield* Fiber.join(following)
        return { messages: yield* SessionMessage.context(database, workspaceA, created.id), retained: [...retained] }
      }).pipe(
        Effect.provide(
          makeRunnerDependencies(workspaceA, provider, executableAgents, defaultInstruction, sessionTools),
        ),
      )

      expect(yield* Ref.get(executions)).toHaveLength(4)
      expect(yield* Ref.get(executions)).toEqual(
        expect.arrayContaining(Array.from({ length: 4 }, (_, i) => `call_valid_${i}`)),
      )
      const failed = result.retained.filter((event) => event.type === SessionEvent.ToolFailed.type)
      expect(failed).toHaveLength(1)
      expect(failed[0]).toMatchObject({
        data: {
          callID: "call_malformed",
          name: "parallel",
          input: {},
          error: { _tag: "SessionError.ToolError", message: "Tool arguments were not valid JSON" },
        },
      })
      const assistants = result.messages.filter((message) => message.type === "assistant")
      const tools = assistants.flatMap((message) => message.content.filter((part) => part.type === "tool"))
      expect(tools).toHaveLength(5)
      expect(tools.find((part) => part.id === "call_malformed")).toMatchObject({
        name: "parallel",
        state: {
          status: "error",
          input: {},
          error: { _tag: "SessionError.ToolError", message: "Tool arguments were not valid JSON" },
        },
      })
      expect(tools.filter((part) => part.state.status === "completed")).toHaveLength(4)
      expect(assistants.every((message) => message.error === undefined)).toBe(true)
      expect(yield* Ref.get(requests)).toHaveLength(2)
      expect(JSON.stringify((yield* Ref.get(requests))[1]?.messages)).not.toContain(raw)
      expect(JSON.stringify((yield* Ref.get(requests))[1]?.messages)).toContain("Tool arguments were not valid JSON")
    }),
  )

  effectIt.effect("executes five local Tool calls exactly once and settles out of order", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const providerCalls = yield* Ref.make(0)
      const provider = withProviderStream(() =>
        Stream.unwrap(
          Ref.getAndUpdate(providerCalls, (count) => count + 1).pipe(
            Effect.map((index) =>
              index === 0
                ? Stream.fromIterable([
                    ...Array.from({ length: 5 }, (_, call) =>
                      LLMEvent.toolCall({ id: `call_parallel_${call}`, name: "parallel", input: { call } }),
                    ),
                    LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
                  ])
                : Stream.make(LLMEvent.finish({ reason: { normalized: "stop" } })),
            ),
          ),
        ),
      )
      const active = yield* Ref.make(0)
      const maxActive = yield* Ref.make(0)
      const executions = yield* Ref.make<ReadonlyArray<string>>([])
      const completions = yield* Ref.make<ReadonlyArray<string>>([])
      const allStarted = yield* Deferred.make<void>()
      const releases = yield* Effect.forEach(Array.from({ length: 5 }), () => Deferred.make<void>())
      const sessionTools = Layer.succeed(
        SessionTools.Service,
        SessionTools.Service.of({
          resolve: () =>
            Effect.succeed({
              definitions: [{ type: "tool" as const, name: "parallel", description: "parallel test", inputSchema: { type: "object" } }],
              execute: ({ call }) =>
                Effect.gen(function* () {
                  const index = Number(call.id.slice("call_parallel_".length))
                  yield* Ref.update(executions, (current) => [...current, call.id])
                  const count = yield* Ref.updateAndGet(active, (current) => current + 1)
                  yield* Ref.update(maxActive, (current) => Math.max(current, count))
                  if (count === 5) yield* Deferred.succeed(allStarted, undefined)
                  yield* Deferred.await(releases[index]!)
                  yield* Ref.update(completions, (current) => [...current, call.id])
                  yield* Ref.update(active, (current) => current - 1)
                  return { content: [{ type: "text" as const, text: call.id }] }
                }),
            }),
        }),
      )
      const created = yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const created = yield* sessions.create({ projectID })
          yield* sessions.switchModel({ sessionID: created.id, model: executableModel })
          return created
        }),
      ).pipe(Effect.provide(layerA))

      const messages = yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        yield* inbox.admitPrompt({
          sessionID: created.id,
          id: MessageID.make("00000000-0000-4000-8000-000000000632"),
          text: "run all five tools",
        })
        const running = yield* (yield* Runner.make(database, events, workspaceA, inbox))
          .run(created.id)
          .pipe(Effect.forkChild)
        yield* Deferred.await(allStarted)
        for (const release of [...releases].reverse()) {
          yield* Deferred.succeed(release, undefined)
          yield* Effect.yieldNow
        }
        yield* Fiber.join(running)
        return yield* SessionMessage.context(database, workspaceA, created.id)
      }).pipe(
        Effect.provide(
          makeRunnerDependencies(workspaceA, provider, executableAgents, defaultInstruction, sessionTools),
        ),
      )

      expect(yield* Ref.get(maxActive)).toBe(5)
      expect(yield* Ref.get(executions)).toHaveLength(5)
      expect(new Set(yield* Ref.get(executions)).size).toBe(5)
      expect(yield* Ref.get(completions)).toEqual(Array.from({ length: 5 }, (_, index) => `call_parallel_${4 - index}`))
      expect(yield* Ref.get(providerCalls)).toBe(2)
      expect(
        messages
          .filter((message) => message.type === "assistant")
          .flatMap((message) => message.content.filter((part) => part.type === "tool"))
          .map((part) => part.state.status),
      ).toEqual(Array.from({ length: 5 }, () => "completed"))
    }),
  )

  effectIt.effect("resolves persisted child Tool and runtime permissions through the Runner", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({
        ...selectedAgent,
        model: executableModel,
        permissions: [{ action: "restricted", resource: "*", effect: "deny" }],
      })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const captured = yield* Ref.make<ReadonlyArray<string>>([])
      const provider = withProviderStream((input) =>
        Stream.fromEffect(Ref.set(captured, input.tools?.map((tool) => tool.name) ?? [])).pipe(
          Stream.drain,
          Stream.concat(Stream.make(LLMEvent.finish({ reason: { normalized: "stop" } }))),
        ),
      )
      const tools = Tool.layer
      const registration = Layer.effectDiscard(
        Tool.Service.use((service) =>
          service.transform((editor) => {
            for (const name of ["ordinary", "restricted", "subagent"])
              editor.add({
                name,
                description: `${name} test tool`,
                input: Schema.Struct({}),
                execute: () => Effect.succeed({ content: name }),
              })
          }),
        ),
      ).pipe(Layer.provide(tools), Layer.orDie)
      const child = yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const parent = yield* sessions.create({ projectID })
          return yield* sessions.createChild({
            parentID: parent.id,
            title: "Runner permission child",
            agent: executableAgent.id,
            model: executableModel,
          })
        }),
      ).pipe(Effect.provide(layerA))
      const runtime = makeRunnerDependencies(
        workspaceA,
        provider,
        executableAgents,
        defaultInstruction,
        undefined,
        Layer.merge(tools, registration),
      )

      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const permissions = yield* Permission.Service
        yield* inbox.admitPrompt({
          sessionID: child.id,
          id: MessageID.make("00000000-0000-4000-8000-000000000631"),
          text: "inspect child tools",
        })
        yield* (yield* Runner.make(database, events, workspaceA, inbox)).run(child.id)

        expect(yield* Ref.get(captured)).toEqual(["execute"])
        expect((yield* permissions.ask({ sessionID: child.id, action: "ordinary", resources: ["*"] })).effect).toBe(
          "allow",
        )
        expect((yield* permissions.ask({ sessionID: child.id, action: "restricted", resources: ["*"] })).effect).toBe(
          "deny",
        )
        expect((yield* permissions.ask({ sessionID: child.id, action: "subagent", resources: ["*"] })).effect).toBe(
          "deny",
        )
      }).pipe(Effect.provide(runtime))
    }),
  )

  effectIt.effect("continues after a feedback-bearing Permission rejection", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({
        ...selectedAgent,
        model: executableModel,
        permissions: [{ action: "add", resource: "*", effect: "ask" }],
      })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const requests = yield* Ref.make<ReadonlyArray<Provider.StreamInput>>([])
      const toolCalled = yield* Deferred.make<void>()
      const provider = withProviderStream((input) =>
        Stream.fromEffect(
          Ref.modify(requests, (current) => {
            const index = current.length
            return [index, [...current, input]] as const
          }),
        ).pipe(
          Stream.flatMap((index) => {
            if (index === 0)
              return Stream.fromIterable([
                LLMEvent.toolCall({
                  id: "call_feedback_rejection",
                  name: "add",
                  input: { left: 1, right: 2 },
                }),
                LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
              ]).pipe(
                Stream.tap((event) =>
                  event.type === "tool-call" ? Deferred.succeed(toolCalled, undefined) : Effect.void,
                ),
              )
            return Stream.make(LLMEvent.finish({ reason: { normalized: "stop" } }))
          }),
        ),
      )
      const created = yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const created = yield* sessions.create({ projectID })
          yield* sessions.switchModel({ sessionID: created.id, model: executableModel })
          return created
        }),
      ).pipe(Effect.provide(layerA))
      const result = yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const permissions = yield* Permission.Service
        const following = yield* followSession(events, created.id, (event) => event.type === SessionEvent.Succeeded.type)
        yield* inbox.admitPrompt({
          sessionID: created.id,
          id: MessageID.make("00000000-0000-4000-8000-000000000630"),
          text: "run the addition",
        })
        const runner = yield* Runner.make(database, events, workspaceA, inbox)
        const running = yield* runner.run(created.id).pipe(Effect.forkChild)
        yield* Deferred.await(toolCalled)
        const requestID = yield* Effect.gen(function* () {
          while (true) {
            const request = (yield* permissions.forSession(created.id))[0]
            if (request !== undefined) return request.id
            yield* Effect.yieldNow
          }
        })
        yield* permissions.reply({
          sessionID: created.id,
          requestID,
          reply: "reject",
          message: "Use the cached total",
        })
        yield* Fiber.join(running)
        const retained = yield* Fiber.join(following)
        return {
          messages: yield* SessionMessage.context(database, workspaceA, created.id),
          retained: [...retained],
        }
      }).pipe(Effect.scoped, Effect.provide(makeRunnerDependencies(workspaceA, provider, executableAgents)))

      expect(result.retained.filter((event) => event.type === SessionEvent.ToolFailed.type)).toMatchObject([
        { data: { callID: "call_feedback_rejection", error: { message: "Use the cached total" } } },
      ])
      expect(result.retained.some((event) => event.type === SessionEvent.Interrupted.type)).toBe(false)
      expect(result.messages.filter((message) => message.type === "assistant")).toMatchObject([
        {
          content: [
            {
              type: "tool",
              id: "call_feedback_rejection",
              state: {
                status: "error",
                error: { message: "Use the cached total" },
              },
            },
          ],
        },
        { content: [], time: { completed: expect.any(Date) } },
      ])
      expect(yield* Ref.get(requests)).toHaveLength(2)
      expect((yield* Ref.get(requests))[1]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "tool",
            content: expect.arrayContaining([
              expect.objectContaining({
                result: { type: "error", value: "Use the cached total" },
              }),
            ]),
          }),
        ]),
      )
    }),
  )

  effectIt.effect("runs persisted Instruction Entries through production Session context", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({
        ...selectedAgent,
        instructions: "Agent guidance",
        model: executableModel,
      })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const calls = yield* Ref.make<ReadonlyArray<Provider.StreamInput>>([])
      const recordingProvider = Layer.effect(
        Provider.Service,
        Provider.Service.use((provider) =>
          Effect.succeed(
            Provider.Service.of({
              ...provider,
              stream: (input) =>
                Stream.fromEffect(Ref.update(calls, (current) => [...current, input])).pipe(Stream.drain),
            }),
          ),
        ),
      ).pipe(Layer.provide(Provider.layer))
      const skillInstructions = Layer.succeed(
        SkillInstruction.Service,
        SkillInstruction.Service.of({
          load: () =>
            Effect.succeed(
              Instruction.make({
                key: Instruction.Key.make("core/skill-instructions"),
                codec: Schema.String,
                read: Effect.succeed("Skill guidance"),
                render: { initial: String, changed: (_previous, current) => current },
              }),
            ),
        }),
      )
      const runtime = makeRunnerDependencies(workspaceA, recordingProvider, executableAgents, skillInstructions)
      const created = yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const created = yield* sessions.create({ projectID })
          yield* sessions.switchModel({ sessionID: created.id, model: executableModel })
          return created
        }),
      ).pipe(Effect.provide(layerA))
      const key = InstructionEntry.Key.make("build.context")
      const added = InstructionEntry.Key.make("review.notes")
      yield* Effect.gen(function* () {
        const entries = yield* InstructionEntry.Service
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const storage = yield* Storage.Service
        const runner = yield* Runner.make(database, events, workspaceA, inbox)
        const discovery = yield* InstructionDiscovery.Service
        yield* ConfigInstructionPlugin.Plugin.effect({
          location: { workspaceID: workspaceA },
          instruction: {
            list: (projectID: ProjectSchema.ID | undefined) =>
              discovery.list(projectID).pipe(Effect.map((files) => (Array.isArray(files) ? files : []))),
            transform: discovery.transform,
            reload: discovery.reload,
          },
        } as unknown as PluginContext)
        const directory = yield* ProjectDirectory.Service.pipe(
          Effect.provide(ProjectDirectory.layer(workspaceA, projectID)),
          Effect.provideService(Storage.Service, storage),
          Effect.provideService(Bus.Service, events),
        )
        const run = Effect.fnUntraced(function* (id: MessageID, text: string) {
          yield* inbox.admitPrompt({ sessionID: created.id, id, text })
          yield* runner.run(created.id).pipe(Effect.flip)
        })

        yield* entries.put({ sessionID: created.id, key, value: "initial" })
        yield* directory.write(ProjectDirectory.Path.make("AGENTS.md"), {
          content: Stream.fromIterable([new TextEncoder().encode("Initial project guidance")]),
        })
        yield* TestClock.adjust("1 second")
        yield* run(MessageID.make("00000000-0000-4000-8000-000000000621"), "first")
        yield* Effect.all([
          entries.put({ sessionID: created.id, key, value: "updated" }),
          entries.put({ sessionID: created.id, key: added, value: { focus: "tests" } }),
          directory.write(ProjectDirectory.Path.make("AGENTS.md"), {
            content: Stream.fromIterable([new TextEncoder().encode("Updated project guidance")]),
          }),
        ])
        yield* TestClock.adjust("1 second")
        yield* run(MessageID.make("00000000-0000-4000-8000-000000000622"), "second")
        yield* entries.remove({ sessionID: created.id, key })
        yield* storage.object.remove([{ workspaces: workspaceA }, { projects: projectID }, "AGENTS.md"])
        yield* events.publish(ProjectSchema.FileChanged, { projectID, path: ProjectInstruction.path })
        yield* TestClock.adjust("1 day")
        yield* run(MessageID.make("00000000-0000-4000-8000-000000000623"), "third")
      }).pipe(Effect.provide(runtime))

      for (const system of (yield* Ref.get(calls)).map(({ system }) => system)) {
        const parts = yield* Schema.decodeUnknownEffect(Schema.Array(SystemPart))(system)
        expect(system).toMatchObject([
          { type: "text", text: "Agent guidance" },
          {
            type: "text",
            text: expect.stringContaining("The Code Mode tool catalog below is complete."),
          },
        ])
        expect(parts[1]?.text).toContain('<context key="build.context">\ninitial\n</context>')
      }
      const baseline =
        (yield* Schema.decodeUnknownEffect(Schema.Array(SystemPart))((yield* Ref.get(calls))[0]?.system))[1]?.text ?? ""
      const ordered = [
        "Here is some useful information about the environment you are running in:",
        "Today's date:",
        "The Code Mode tool catalog below is complete.",
        "Instructions from: AGENTS.md",
        "Skill guidance",
        '<context key="build.context">',
      ].map((section) => baseline.indexOf(section))
      expect(ordered.every((index) => index >= 0)).toBe(true)
      expect(ordered).toEqual(ordered.toSorted((left, right) => left - right))
      const durable = (yield* Session.Service.use((sessions) =>
        sessions.messages({ sessionID: created.id, order: "asc" }),
      ).pipe(Effect.provide(layerA))).filter((message) => message.type === "system")
      expect(durable).toHaveLength(2)
      expect(durable[0]?.text).toContain("The instructions changed:\nInstructions from: AGENTS.md")
      expect(durable[0]?.text).toContain('The context under "build.context" changed and supersedes the previous value:')
      expect(durable[0]?.text).toContain('<context key="review.notes">')
      expect(durable[1]?.text).toContain("Previously loaded instructions no longer apply.")
      expect(durable[1]?.text).toContain("Today's date is now:")
      expect(durable[1]?.text).toContain('The context under "build.context" no longer applies. Disregard it.')
    }),
  )

  effectIt.effect("persists Code Mode catalog changes and execute removal as system messages", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({ ...selectedAgent, model: executableModel })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const generation = yield* Ref.make(0)
      const notes: CodeModeCatalog.Namespace = {
        type: "namespace",
        name: "notes",
        tools: [
          { type: "tool", name: "echo", description: "Echo text", signature: "tools.notes.echo(): Promise<void>" },
        ],
      }
      const catalogs: ReadonlyArray<CodeModeCatalog.Inventory> = [
        { tools: [notes] },
        {
          tools: [
            notes,
            {
              type: "namespace",
              name: "orders",
              tools: [
                {
                  type: "tool",
                  name: "lookup",
                  description: "Look up an order",
                  signature: "tools.orders.lookup(): Promise<void>",
                },
              ],
            },
          ],
        },
      ]
      const sessionTools = Layer.succeed(
        SessionTools.Service,
        SessionTools.Service.of({
          resolve: () =>
            Ref.getAndUpdate(generation, (current) => current + 1).pipe(
              Effect.map((current) => ({
                ...(catalogs[current] === undefined ? {} : { codeModeCatalog: catalogs[current] }),
                definitions:
                  catalogs[current] === undefined
                    ? []
                    : [{ type: "tool" as const, name: "execute", description: "Execute", inputSchema: { type: "object" } }],
                execute: () => Effect.die("unused"),
              })),
            ),
        }),
      )
      const provider = withProviderStream(() => Stream.empty)
      const created = yield* Session.Service.use((sessions) =>
        sessions.create({ projectID, agent: executableAgent.id, model: executableModel }),
      ).pipe(Effect.provide(layerA))

      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const runner = yield* Runner.make(database, events, workspaceA, inbox)
        for (const text of ["first", "second", "third"]) {
          yield* inbox.admitPrompt({ sessionID: created.id, id: MessageID.make(crypto.randomUUID()), text })
          yield* runner.run(created.id).pipe(Effect.flip)
        }
      }).pipe(Effect.provide(makeRunnerDependencies(workspaceA, provider, executableAgents, undefined, sessionTools)))

      const messages = yield* Session.Service.use((sessions) =>
        sessions.messages({ sessionID: created.id }),
      ).pipe(Effect.provide(layerA))
      const systems = messages.filter((message) => message.type === "system").map((message) => message.text)
      expect(systems.some((text) => text.includes("New tools are available") && text.includes("orders.lookup"))).toBe(
        true,
      )
      expect(systems).toContain(
        "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
      )
    }),
  )

  effectIt.effect("keeps built-in General and Explore tools available after Step five", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const general = yield* builtInAgent(GeneralAgentPlugin, AgentSchema.ID.make("general"), executableModel)
      const explore = yield* builtInAgent(ExploreAgentPlugin, AgentSchema.ID.make("explore"), executableModel)

      for (const profile of [general, explore]) {
        const requests = yield* Ref.make<ReadonlyArray<Provider.StreamInput>>([])
        const provider = withProviderStream((input) =>
          Stream.unwrap(
            Ref.modify(requests, (current) => [current.length + 1, [...current, input]] as const).pipe(
              Effect.map((step) => {
                if (step >= 6) return Stream.empty
                const reason = { normalized: "tool-calls" as const }
                return Stream.make(
                  LLMEvent.stepStart({ index: 0 }),
                  LLMEvent.toolCall({
                    id: `call-${profile.id}-${step}`,
                    name: "execute",
                    input: { description: "List project files", code: 'return await tools.glob({ pattern: "**/*" })' },
                  }),
                  LLMEvent.stepFinish({ index: 0, reason }),
                  LLMEvent.finish({ reason }),
                )
              }),
            ),
          ),
        )
        const profileLayer = Layer.succeed(
          Agent.Service,
          agentService({
            list: Effect.succeed([profile]),
            get: () => Effect.succeed(profile),
            resolve: Effect.succeed(profile),
            create: () => Effect.die("unused"),
            update: () => Effect.die("unused"),
          }),
        )
        const created = yield* Session.Service.use((sessions) =>
          sessions.create({ projectID, agent: profile.id, model: executableModel }),
        ).pipe(Effect.provide(makeLayer(workspaceA, provider, profileLayer)))

        yield* Effect.gen(function* () {
          const database = yield* Database.Service
          const events = yield* Bus.Service
          const inbox = yield* SessionInbox.Service
          yield* inbox.admitPrompt({
            sessionID: created.id,
            id: MessageID.make(crypto.randomUUID()),
            text: `Run ${profile.name} beyond Step five`,
          })
          const runner = yield* Runner.make(database, events, workspaceA, inbox)
          yield* runner.run(created.id).pipe(Effect.flip)
        }).pipe(Effect.provide(makeRunnerDependencies(workspaceA, provider, profileLayer)))

        const captured = yield* Ref.get(requests)
        expect(captured).toHaveLength(6)
        for (const request of captured.slice(4, 6)) {
          expect(request.toolChoice).toMatchObject({ type: "auto" })
          expect(request.tools?.map(({ name }) => name)).toContain("execute")
          expect(JSON.stringify(request.system)).toContain("tools.glob")
          expect(JSON.stringify(request.messages)).not.toContain(maximumStepHeading)
        }
      }

      const capped = AgentSchema.Info.make({
        ...general,
        id: AgentSchema.ID.make("capped"),
        name: AgentSchema.Name.make("Capped"),
        steps: 5,
      })
      const cappedRequests = yield* Ref.make<ReadonlyArray<Provider.StreamInput>>([])
      const cappedProvider = withProviderStream((input) =>
        Stream.unwrap(
          Ref.modify(cappedRequests, (current) => [current.length + 1, [...current, input]] as const).pipe(
            Effect.map((step) => {
              if (step >= 5) return Stream.empty
              const reason = { normalized: "tool-calls" as const }
              return Stream.make(
                LLMEvent.stepStart({ index: 0 }),
                LLMEvent.toolCall({
                  id: `call-capped-${step}`,
                  name: "execute",
                  input: { description: "List project files", code: 'return await tools.glob({ pattern: "**/*" })' },
                }),
                LLMEvent.stepFinish({ index: 0, reason }),
                LLMEvent.finish({ reason }),
              )
            }),
          ),
        ),
      )
      const cappedLayer = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([capped]),
          get: () => Effect.succeed(capped),
          resolve: Effect.succeed(capped),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const created = yield* Session.Service.use((sessions) =>
        sessions.create({ projectID, agent: capped.id, model: executableModel }),
      ).pipe(Effect.provide(makeLayer(workspaceA, cappedProvider, cappedLayer)))
      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        yield* inbox.admitPrompt({
          sessionID: created.id,
          id: MessageID.make(crypto.randomUUID()),
          text: "Reach the configured Step limit",
        })
        const runner = yield* Runner.make(database, events, workspaceA, inbox)
        yield* runner.run(created.id).pipe(Effect.flip)
      }).pipe(Effect.provide(makeRunnerDependencies(workspaceA, cappedProvider, cappedLayer)))
      const cutoff = (yield* Ref.get(cappedRequests))[4]
      expect(cutoff?.toolChoice).toMatchObject({ type: "none" })
      expect(cutoff?.tools).toEqual([])
      expect(JSON.stringify(cutoff?.messages)).toContain(maximumStepHeading)
    }).pipe(Effect.scoped),
  )

  effectIt.effect("routes one production request before context without changing the Session selection", () =>
    Effect.gen(function* () {
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const routedModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.4-mini" })
      const executableAgent = AgentSchema.Info.make({
        ...selectedAgent,
        instructions: "Original system",
        model: executableModel,
      })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die(new Error("unused")),
          update: () => Effect.die(new Error("unused")),
        }),
      )
      const requests = yield* Ref.make<ReadonlyArray<Provider.StreamInput>>([])
      const provenance = yield* Ref.make<ReadonlyArray<{ requested: ModelSchema.Ref; effective: ModelSchema.Ref }>>([])
      const provider = withProviderStream((input) =>
        Stream.fromEffect(Ref.update(requests, (items) => [...items, input])).pipe(Stream.drain),
      )
      const created = yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          const created = yield* sessions.create({ projectID })
          yield* sessions.switchModel({ sessionID: created.id, model: executableModel })
          return created
        }),
      ).pipe(Effect.provide(layerA))

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const hooks = yield* PluginHooks.Service
          const calls = yield* Ref.make(0)
          yield* hooks.register("session", "model.request", (request) =>
            request.purpose !== "assistant"
              ? Effect.void
              : Effect.sync(() => {
                  request.model = routedModel
                }),
          )
          yield* hooks.register("session", "context", (context) =>
            Ref.update(calls, (count) => count + 1).pipe(
              Effect.tap(() =>
                Ref.update(provenance, (items) => [
                  ...items,
                  { requested: context.requestedModel, effective: context.model },
                ]),
              ),
              Effect.tap(() =>
                Effect.sync(() => {
                  context.system = [SystemPart.make("Hooked system")]
                  context.messages = [Message.user("Hooked message")]
                  const execute = context.tools.execute
                  if (execute === undefined) return
                  execute.description = "Hooked execute"
                  delete context.tools.execute
                  context.tools.orchestrate = execute
                }),
              ),
              Effect.asVoid,
            ),
          )
          const database = yield* Database.Service
          const events = yield* Bus.Service
          const inbox = yield* SessionInbox.Service
          const routeStream = yield* events.subscribe(SessionEvent.ExecutionModelRouted)
          const route = yield* routeStream.pipe(
            Stream.filter((event) => event.data.sessionID === created.id),
            Stream.take(1),
            Stream.runHead,
            Effect.forkChild,
          )
          yield* inbox.admitPrompt({
            sessionID: created.id,
            id: MessageID.make(crypto.randomUUID()),
            text: "original prompt",
          })
          const runner = yield* Runner.make(database, events, workspaceA, inbox)
          yield* runner.run(created.id).pipe(Effect.flip)

          expect(yield* Ref.get(calls)).toBe(1)
          const projected = yield* SessionMessage.context(database, workspaceA, created.id)
          const routes = Option.toArray(yield* Fiber.join(route))
          return { projected, routes }
        }).pipe(Effect.provide(makeRunnerDependencies(workspaceA, provider, executableAgents))),
      )

      const request = (yield* Ref.get(requests))[0]
      expect(request).toMatchObject({
        context: { requestedModel: executableModel, model: routedModel },
        selection: { info: { id: "gpt-5.4-mini" } },
        system: [{ type: "text", text: "Hooked system" }],
        messages: [{ role: "user", content: [{ type: "text", text: "Hooked message" }] }],
      })
      expect(request?.tools?.find((tool) => tool.name === "orchestrate")).toMatchObject({
        name: "orchestrate",
        description: "Hooked execute",
      })
      expect(request?.tools?.some((tool) => tool.name === "execute")).toBe(false)
      expect(yield* Ref.get(provenance)).toEqual([{ requested: executableModel, effective: routedModel }])
      expect(result.projected.find((message) => message.type === "assistant")).toMatchObject({
        type: "assistant",
        model: routedModel,
        requestedModel: executableModel,
      })
      expect(result.routes).toHaveLength(1)
      expect(result.routes[0]?.data).toMatchObject({ requestedModel: executableModel, model: routedModel })
      expect(
        yield* Session.Service.use((sessions) => sessions.get(created.id)).pipe(Effect.provide(layerA)),
      ).toMatchObject({ model: executableModel })
    }),
  )

  effectIt.effect("keeps an active partial provider stream alive across periodic discovery ticks", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const receivedSystem = yield* Deferred.make<Provider.StreamInput["system"]>()
      const executableModel = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.6" })
      const executableAgent = AgentSchema.Info.make({
        ...selectedAgent,
        instructions: "Agent base guidance",
        model: executableModel,
      })
      const executableAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([executableAgent]),
          get: () => Effect.succeed(executableAgent),
          resolve: Effect.succeed(executableAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      const partialProvider = Layer.effect(
        Provider.Service,
        Provider.Service.use((provider) =>
          Effect.succeed(
            Provider.Service.of({
              ...provider,
              stream: (input) =>
                typeof input.system === "string" && input.system.startsWith("You are a title generator")
                  ? Stream.empty
                  : Stream.concat(
                      Stream.fromIterable([
                        { type: "step-start" as const, index: 0 },
                        { type: "text-start" as const, id: "partial" },
                        { type: "text-delta" as const, id: "partial", text: "survives" },
                      ]),
                      Stream.concat(
                        Stream.fromEffect(
                          Deferred.succeed(receivedSystem, input.system).pipe(
                            Effect.andThen(Deferred.succeed(ready, undefined)),
                          ),
                        ).pipe(Stream.drain),
                        Stream.never,
                      ),
                    ),
            }),
          ),
        ),
      ).pipe(Layer.provide(Provider.layer))
      const assembled = Layer.succeed(
        SkillInstruction.Service,
        SkillInstruction.Service.of({
          load: () =>
            Effect.succeed(
              Instruction.make({
                key: InstructionSchema.Key.make("test/assembled"),
                codec: Schema.String,
                read: Effect.succeed("assembled system guidance"),
                render: { initial: String, changed: (_, current) => current },
              }),
            ),
        }),
      )
      const runtime = makeLayer(workspaceA, partialProvider, executableAgents, assembled)
      const created = yield* Session.Service.use((sessions) => sessions.create({ projectID })).pipe(
        Effect.provide(runtime),
      )
      const id = MessageID.make("00000000-0000-4000-8000-000000000609")

      yield* Session.Service.use((sessions) =>
        Effect.gen(function* () {
          yield* sessions.prompt({ sessionID: created.id, id, text: "stream partially" })
          yield* Deferred.await(ready)
          expect(yield* Deferred.await(receivedSystem)).toMatchObject([
            { type: "text", text: "Agent base guidance" },
            { type: "text", text: expect.stringContaining("assembled system guidance") },
          ])
          const system = yield* Schema.decodeUnknownEffect(Schema.Array(SystemPart))(yield* Deferred.await(receivedSystem))
          expect(system[1]?.text).toContain("The Code Mode tool catalog below is complete.")
          yield* TestClock.adjust("11 seconds")
          const active = yield* sessions.messages({ sessionID: created.id, order: "asc" })
          expect(active).toMatchObject([
            { type: "user" },
            { type: "assistant", content: [{ type: "text", text: "survives" }] },
          ])
          expect(active[1]).not.toHaveProperty("error")
          expect(active[1]).not.toHaveProperty("time.completed")
        }),
      ).pipe(Effect.provide(runtime))
    }),
  )

  effectIt.effect("hydrates coalesced streaming output at part boundaries and when the recording closes", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const events = yield* Bus.Service
      const database = yield* Database.Service
      const created = yield* sessions.create({ projectID })
      const messageID = MessageID.make("00000000-0000-4000-8000-000000000799")
      const assistant = yield* insertAssistant(database, created, messageID, selectedModel)
      const recording = yield* Scope.make()
      const recorder = yield* SessionRecorder.make({ database, events, assistant, workspaceID: workspaceA }).pipe(
        Scope.provide(recording),
      )
      const hydrate = () =>
        sessions
          .messages({ sessionID: created.id })
          .pipe(Effect.map((messages) => messages.find((message) => message.id === messageID)))
      yield* recorder.write(LLMEvent.stepStart({ index: 0 }))
      yield* recorder.write(LLMEvent.textStart({ id: "text" }))
      // A reconnecting client sees the part as soon as it starts, before any delta is durable.
      expect(yield* hydrate()).toMatchObject({ content: [{ type: "text", id: "text", text: "" }] })
      for (const text of ["hel", "lo ", "wor", "ld"]) yield* recorder.write(LLMEvent.textDelta({ id: "text", text }))
      expect(yield* hydrate()).toMatchObject({ content: [{ type: "text", text: "" }] })
      yield* recorder.write(LLMEvent.textEnd({ id: "text" }))
      // The boundary makes every coalesced delta readable through the Session service.
      expect(yield* hydrate()).toMatchObject({ content: [{ type: "text", text: "hello world" }] })

      yield* recorder.write(LLMEvent.textStart({ id: "more" }))
      yield* recorder.write(LLMEvent.textDelta({ id: "more", text: "pending" }))
      expect(yield* hydrate()).toMatchObject({ content: [{ type: "text", text: "hello world" }, { type: "text", text: "" }] })
      // Closing the recording, as an interrupted run does before settling, writes what was pending.
      yield* Scope.close(recording, Exit.interrupt(0 as never))
      expect(yield* hydrate()).toMatchObject({
        content: [
          { type: "text", text: "hello world" },
          { type: "text", text: "pending" },
        ],
      })
      expect(yield* hydrate()).not.toHaveProperty("time.completed")
      yield* SessionMessage.interrupt(database, events, workspaceA, messageID)
      expect(yield* hydrate()).toMatchObject({
        content: [
          { type: "text", text: "hello world" },
          { type: "text", text: "pending" },
        ],
        error: { _tag: "SessionError.AbortedError" },
        time: { completed: expect.any(Date) },
      })
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("persists every assistant content family, provenance, metadata, usage, and success", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const events = yield* Bus.Service
      const database = yield* Database.Service
      const created = yield* sessions.create({ projectID })
      const messageID = MessageID.make("00000000-0000-4000-8000-000000000610")
      const assistant = yield* insertAssistant(database, created, messageID, selectedModel)
      const recorder = yield* SessionRecorder.make({ database, events, assistant, workspaceID: workspaceA, cost: { cache: {} } })
      yield* recorder.write(LLMEvent.stepStart({ index: 0 }))
      yield* recorder.write(LLMEvent.textStart({ id: "text" }))
      yield* recorder.write(LLMEvent.textDelta({ id: "text", text: "hel" }))
      yield* recorder.write(LLMEvent.textEnd({ id: "text", text: "hello", providerMetadata: { test: { trace: "text-provider" } } }))
      yield* recorder.write(LLMEvent.reasoningStart({ id: "reason" }))
      yield* recorder.write(LLMEvent.reasoningDelta({ id: "reason", text: "bec" }))
      yield* recorder.write(LLMEvent.reasoningEnd({ id: "reason", text: "because", providerMetadata: { test: { trace: "reason-provider" } } }))
      yield* recorder.write(LLMEvent.toolInputStart({ id: "success", name: "search", providerExecuted: true, providerMetadata: { test: { trace: "input-provider" } } }))
      yield* recorder.write(LLMEvent.toolInputDelta({ id: "success", name: "search", text: '{"q":"postgres"}' }))
      yield* recorder.write(LLMEvent.toolInputEnd({ id: "success", name: "search", providerMetadata: { test: { trace: "input-end-provider" } } }))
      const ended = yield* sessions.messages({ sessionID: created.id })
      expect(ended[0]).toMatchObject({
        content: [
          { type: "text" },
          { type: "reasoning" },
          {
            type: "tool",
            id: "success",
            state: { status: "streaming", input: '{"q":"postgres"}' },
            providerMetadata: { test: { trace: "input-provider" } },
          },
        ],
      })
      yield* recorder.write(LLMEvent.toolCall({ id: "success", name: "search", input: { q: "postgres" }, providerExecuted: true, providerMetadata: { test: { trace: "call-provider" } } }))
      yield* recorder.metadata("success", { source: "tool" })
      yield* recorder.write(LLMEvent.toolResult({ id: "success", name: "search", result: { type: "content", value: [{ type: "text", text: "found" }] }, output: { structured: { count: 1 }, content: [{ type: "text", text: "found" }] }, providerExecuted: true, providerMetadata: { test: { trace: "result-provider" } } }))
      yield* recorder.write(LLMEvent.toolCall({ id: "failure", name: "search", input: { q: "failure" }, providerMetadata: { test: { trace: "failed-call-provider" } } }))
      const toolError = SessionError.Tool.make({ message: "tool failed", metadata: { retryable: false } })
      yield* recorder.failTool("failure", toolError)
      const usage = {
        cost: 0,
        costComplete: false,
        tokens: { total: 21, input: 10, output: 6, reasoning: 3, cache: { read: 1, write: 1 } },
      }
      yield* recorder.write(LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" }, usage: { inputTokens: 12, nonCachedInputTokens: 10, outputTokens: 9, reasoningTokens: 3, cacheReadInputTokens: 1, cacheWriteInputTokens: 1, totalTokens: 21 } }))
      yield* recorder.write(LLMEvent.finish({ reason: { normalized: "stop" } }))
      yield* recorder.finishStream
      yield* SessionMessage.complete(database, events, workspaceA, created.id, messageID, "stop")

      const detail = yield* sessions.get(created.id)
      const page = yield* sessions.messages({ sessionID: created.id })
      expect(detail.usage).toEqual(usage)
      expect(page).toHaveLength(1)
      expect(page[0]).toMatchObject({
        id: messageID,
        type: "assistant",
        agent: selectedAgent.id,
        model: selectedModel,
        finish: "stop",
        usage,
        content: [
          { type: "text", id: "text", text: "hello", providerMetadata: { test: { trace: "text-provider" } } },
          { type: "reasoning", id: "reason", text: "because", providerMetadata: { test: { trace: "reason-provider" } } },
          {
            type: "tool",
            id: "success",
            providerExecuted: true,
            providerMetadata: { test: { trace: "result-provider" } },
            state: {
              status: "completed",
              input: { q: "postgres" },
              content: [{ type: "text", text: "found" }],
              result: { count: 1 },
              metadata: { source: "tool" },
            },
          },
          { type: "tool", id: "failure", state: { status: "error", error: toolError } },
        ],
        time: { completed: expect.any(Date) },
      })
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("retains observed Tool metadata on success and failure", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const events = yield* Bus.Service
      const database = yield* Database.Service
      const created = yield* sessions.create({ projectID })
      const messageID = MessageID.make("00000000-0000-4000-8000-000000000695")
      const assistant = yield* insertAssistant(database, created, messageID, selectedModel)
      const recorder = yield* SessionRecorder.make({ database, events, assistant, workspaceID: workspaceA })
      const failedStream = yield* events.subscribe(SessionEvent.ToolFailed)
      const failedEvent = yield* failedStream.pipe(
        Stream.filter((event) => event.data.messageID === messageID),
        Stream.take(1),
        Stream.runHead,
        Effect.forkChild,
      )

      yield* recorder.write(LLMEvent.toolCall({ id: "success", name: "observed", input: { value: 1 } }))
      yield* recorder.metadata("success", { childSessionID: "child-success", status: "running" })
      expect(
        (yield* sessions.messages({ sessionID: created.id }))[0],
      ).toMatchObject({
        content: [
          {
            id: "success",
            state: {
              status: "running",
              metadata: { childSessionID: "child-success", status: "running" },
            },
          },
        ],
      })
      yield* recorder.metadata("success", { childSessionID: "child-success", status: "completed" })
      yield* recorder.succeedTool("success", {
        output: "complete",
        content: [{ type: "text", text: "complete" }],
      })

      yield* recorder.write(LLMEvent.toolCall({ id: "failure", name: "observed", input: { value: 2 } }))
      yield* recorder.metadata("failure", { childSessionID: "child-failure", status: "running" })
      yield* recorder.write(LLMEvent.toolError({ id: "failure", name: "observed", message: "failed" }))

      expect(
        (yield* sessions.messages({ sessionID: created.id }))[0],
      ).toMatchObject({
        content: [
          {
            id: "success",
            state: {
              status: "completed",
              metadata: { childSessionID: "child-success", status: "completed" },
            },
          },
          {
            id: "failure",
            state: {
              status: "error",
              metadata: { childSessionID: "child-failure", status: "running" },
            },
          },
        ],
      })
      expect(Option.getOrUndefined(yield* Fiber.join(failedEvent))).toMatchObject({
        data: { metadata: { childSessionID: "child-failure", status: "running" } },
      })
    }).pipe(Effect.provide(layerA)),
  )

  for (const codeMode of [false, true])
    effectIt.effect(
      `binds concurrent builtin ${codeMode ? "Code Mode" : "direct"} calls to their real Sessions outside resolution`,
      () => {
        const allowingAgents = Layer.succeed(
          Agent.Service,
          agentService({
            list: Effect.succeed([selectedAgent]),
            get: () =>
              Effect.succeed({ ...selectedAgent, permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
            resolve: Effect.succeed(selectedAgent),
            create: () => Effect.die("unused"),
            update: () => Effect.die("unused"),
          }),
        )
        return Effect.gen(function* () {
          const sessions = yield* Session.Service
          const projects = yield* Project.Service
          const tools = yield* Tool.Service
          const permission = yield* Permission.Service
          const projectA = yield* projects.create({})
          const projectB = yield* projects.create({})
          const a = yield* sessions.create({ projectID: projectA.id })
          const b = yield* sessions.create({ projectID: projectB.id })
          const enteredA = yield* Deferred.make<void>()
          const enteredB = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const observed: Array<Parameters<Permission.Interface["assert"]>[0]> = []
          const write = (project: ProjectSchema.ID, path: string, text: string) =>
            ProjectDirectory.Service.use((directory) =>
              directory.write(ProjectDirectory.Path.make(path), {
                content: Stream.make(new TextEncoder().encode(text)),
              }),
            ).pipe(Effect.provide(ProjectDirectory.layer(workspaceA, project)))
          yield* write(projectA.id, "nested/file.txt", "contents-A")
          yield* write(projectA.id, "nested/AGENTS.md", "instructions-A")
          yield* write(projectB.id, "nested/file.txt", "contents-B")
          yield* write(projectB.id, "nested/AGENTS.md", "instructions-B")
          if (codeMode)
            yield* tools.transform((editor) =>
              editor.update("read", (tool) => {
                tool.options = { codemode: true }
              }),
            )
          const resolver = yield* SessionTools.make.pipe(
            Effect.provideService(Permission.Service, {
              ...permission,
              assert: (request) =>
                Effect.gen(function* () {
                  observed.push(request)
                  yield* Deferred.succeed(request.sessionID === a.id ? enteredA : enteredB, undefined)
                  yield* Deferred.await(release)
                  yield* permission.assert(request)
                }),
            }),
          )
          const resolve = (session: SessionSchema.Info, project: ProjectSchema.ID) =>
            resolver.resolve({
              sessionID: session.id,
              projectID: project,
              agent: selectedAgent.id,
              messageID: MessageID.make(crypto.randomUUID()),
              requestedModel: selectedModel,
              model: selectedModel,
              permissions: [],
            })
          // Deliberately provide the wrong ambient directory during resolution. Neither captured
          // executor is allowed to keep it, or to depend on it later during execution.
          const snapshotA = yield* resolve(a, projectA.id).pipe(
            Effect.provide(ProjectDirectory.layer(workspaceA, projectB.id)),
          )
          const snapshotB = yield* resolve(b, projectB.id)
          const mismatched = yield* resolve(a, projectB.id)
          const call = (id: string) =>
            ToolCallPart.make({
              id,
              name: codeMode ? "execute" : "read",
              input: codeMode
                ? {
                    description: "Read nested files",
                    code: 'return await Promise.all([tools.read({path:"nested/file.txt"}), tools.glob({pattern:"*",path:"nested"}), tools.read({path:"nested/file.txt"})])',
                  }
                : { path: "nested/file.txt" },
            })
          const running = yield* Effect.all(
            [snapshotA.execute({ call: call("isolation-a") }), snapshotB.execute({ call: call("isolation-b") })],
            { concurrency: "unbounded" },
          ).pipe(Effect.provide(ProjectDirectory.layer(workspaceA, projectB.id)), Effect.forkScoped)
          yield* Effect.raceFirst(
            Deferred.await(enteredA).pipe(Effect.andThen(Deferred.await(enteredB))),
            Fiber.join(running).pipe(
              Effect.flatMap((result) =>
                Effect.die(
                  `Builtin execution settled before reaching both permission gates: ${JSON.stringify(result)}`,
                ),
              ),
            ),
          )
          const reloading = yield* tools.reload().pipe(Effect.forkScoped({ startImmediately: true }))
          yield* TestClock.adjust("500 millis")
          yield* Fiber.join(reloading)
          yield* tools.transform((editor) =>
            editor.update("read", (tool) => {
              tool.execute = () => Effect.succeed({ output: "replacement-must-not-run" })
            }),
          )
          yield* Deferred.succeed(release, undefined)
          const [resultA, resultB] = yield* Fiber.join(running)
          expect(JSON.stringify(resultA)).toContain("contents-A")
          expect(JSON.stringify(resultA)).not.toContain("contents-B")
          expect(JSON.stringify(resultB)).toContain("contents-B")
          expect(JSON.stringify(resultB)).not.toContain("contents-A")
          expect(JSON.stringify([resultA, resultB])).not.toContain("replacement-must-not-run")
          for (const request of observed) {
            const project = request.sessionID === a.id ? projectA.id : projectB.id
            expect(request.resources).toEqual(
              request.action === "glob"
                ? ["*"]
                : [ProjectDirectory.resource(project, ProjectDirectory.Path.make("nested/file.txt"))],
            )
            expect(request.metadata).toMatchObject({ projectID: project })
          }
          // A second execution through the original captured executor must not re-admit
          // guidance while its first synthetic instruction is still pending in the inbox.
          yield* snapshotA.execute({ call: call("isolation-again") })
          const pending = yield* Database.Service.use((database) =>
            database.use("isolatedInstructions", (db) =>
              db
                .select()
                .from(SessionInboxTable)
                .where(inArray(SessionInboxTable.sessionID, [a.id, b.id])),
            ),
          )
          expect(pending.filter((row) => row.sessionID === a.id)).toHaveLength(1)
          expect(pending.filter((row) => row.sessionID === b.id)).toHaveLength(1)
          expect(pending.find((row) => row.sessionID === a.id)?.payload).toMatchObject({
            text: "Instructions from: nested/AGENTS.md\ninstructions-A",
          })
          expect(pending.find((row) => row.sessionID === b.id)?.payload).toMatchObject({
            text: "Instructions from: nested/AGENTS.md\ninstructions-B",
          })
          const rejected = yield* mismatched.execute({ call: call("mismatched-caller") }).pipe(Effect.exit)
          expect(JSON.stringify(rejected)).toContain("Session Tool caller does not match its Project")
          expect(JSON.stringify(rejected)).not.toContain("contents-B")
        }).pipe(
          Effect.provide(Form.layer.pipe(Layer.provideMerge(makeLayer(workspaceA, Provider.layer, allowingAgents)))),
          Effect.scoped,
        )
      },
    )

  effectIt.effect("closes builtin execution resources on failure and cancellation outside resolution", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const finalized: string[] = []
      const interpreter = Layer.succeed(
        CodeInterpreter.Service,
        CodeInterpreter.fixed({
          execute: (input) =>
            Effect.gen(function* () {
              const code = input.type === "code" ? input.code : input.command
              yield* Effect.acquireRelease(Effect.succeed(code), (value) =>
                Effect.sync(() => {
                  finalized.push(value)
                }),
              )
              if (code === "failure")
                return yield* new CodeInterpreter.ExecutionError({ operation: "invoke", message: "expected failure" })
              yield* Deferred.succeed(entered, undefined)
              return yield* Effect.never
            }),
        }),
      )
      const allowingAgents = Layer.succeed(
        Agent.Service,
        agentService({
          list: Effect.succeed([selectedAgent]),
          get: () =>
            Effect.succeed({ ...selectedAgent, permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
          resolve: Effect.succeed(selectedAgent),
          create: () => Effect.die("unused"),
          update: () => Effect.die("unused"),
        }),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* Session.Service
        const projects = yield* Project.Service
        const project = yield* projects.create({})
        const session = yield* sessions.create({ projectID: project.id })
        for (const text of ["failure", "cancel"])
          yield* ProjectDirectory.Service.use((directory) =>
            directory.write(ProjectDirectory.Path.make(`${text}.ts`), {
              content: Stream.make(new TextEncoder().encode(text)),
            }),
          ).pipe(Effect.provide(ProjectDirectory.layer(workspaceA, project.id)))
        const snapshot = yield* SessionTools.Service.use((tools) =>
          tools.resolve({
            sessionID: session.id,
            projectID: project.id,
            agent: selectedAgent.id,
            messageID: MessageID.make(crypto.randomUUID()),
            requestedModel: selectedModel,
            model: selectedModel,
            permissions: [],
          }),
        )
        const failed = yield* snapshot
          .execute({ call: ToolCallPart.make({ id: "failed-resource", name: "run", input: { path: "failure.ts" } }) })
          .pipe(Effect.exit)
        expect(JSON.stringify(failed)).toContain("expected failure")
        expect(finalized).toEqual(["failure"])
        const running = yield* snapshot
          .execute({ call: ToolCallPart.make({ id: "cancelled-resource", name: "run", input: { path: "cancel.ts" } }) })
          .pipe(Effect.forkScoped)
        yield* Effect.raceFirst(
          Deferred.await(entered),
          Fiber.join(running).pipe(Effect.andThen(Effect.die("Run settled before acquiring its resource"))),
        )
        yield* Fiber.interrupt(running)
        expect(finalized).toEqual(["failure", "cancel"])
      }).pipe(
        Effect.provide(
          makeLayer(
            workspaceA,
            Provider.layer,
            allowingAgents,
            defaultInstruction,
            skills,
            config,
            undefined,
            interpreter,
          ),
        ),
      )
    }).pipe(Effect.scoped),
  )

  effectIt.effect("retains and replays a loaded Skill result through durable Session history", () => {
    const loadedSkill = SkillSchema.Info.make({
      id: SkillSchema.ID.make("skl_0000000000000000000session"),
      name: "Durable Skill",
      description: "Exercises retained Skill output",
      instructions: "These complete instructions must survive replay.",
    })
    const loadedSkills = Layer.succeed(
      Skill.Service,
      skillService({
        list: Effect.succeed([loadedSkill]),
        get: (id) =>
          id === loadedSkill.id ? Effect.succeed(loadedSkill) : Effect.fail(new Skill.NotFoundError({ skillID: id })),
        create: () => Effect.die("unused"),
        update: () => Effect.die("unused"),
        delete: () => Effect.die("unused"),
      }),
    )
    const allowingAgent = AgentSchema.Info.make({
      ...selectedAgent,
      permissions: [{ action: "skill", resource: "*", effect: "allow" }],
    })
    const allowingAgents = Layer.succeed(
      Agent.Service,
      agentService({
        list: Effect.die("unused"),
        get: (agent) =>
          Effect.succeed(
            agent === requestedAgent.id ? requestedAgent : agent === allowingAgent.id ? allowingAgent : undefined,
          ),
        resolve: Effect.succeed(allowingAgent),
        create: () => Effect.die("unused"),
        update: () => Effect.die("unused"),
      }),
    )
    // One dedicated graph wires the loaded Skill and the allowing Agent through the real
    // SessionTools and Permission services, instead of nesting a divergent wiring under layerA.
    const durable = makeLayer(workspaceA, Provider.layer, allowingAgents, defaultInstruction, loadedSkills)
    return Effect.gen(function* () {
      const sessions = yield* Session.Service
      const events = yield* Bus.Service
      const database = yield* Database.Service
      const created = yield* sessions.create({ projectID })
      const messageID = MessageID.make("00000000-0000-4000-8000-000000000619")
      const tools = yield* SessionTools.Service.use((sessionTools) =>
        sessionTools.resolve({
          sessionID: created.id,
          projectID,
          agent: selectedAgent.id,
          messageID,
          requestedModel: selectedModel,
          model: selectedModel,
          permissions: [],
        }),
      )
      const result = yield* tools.execute({
        call: ToolCallPart.make({
          id: "call_durable_skill",
          name: "skill",
          input: { id: loadedSkill.id },
        }),
      })
      expect(result.output).toEqual(loadedSkill)
      expect(result.content).toEqual([{ type: "text", text: loadedSkill.instructions }])

      const assistant = yield* insertAssistant(database, created, messageID, selectedModel)
      const recorder = yield* SessionRecorder.make({ database, events, assistant, workspaceID: workspaceA })
      const succeededStream = yield* events.subscribe(SessionEvent.ToolSuccess)
      const succeeded = yield* succeededStream.pipe(
        Stream.filter((event) => event.data.messageID === messageID),
        Stream.take(1),
        Stream.runHead,
        Effect.forkChild,
      )
      yield* recorder.write(LLMEvent.stepStart({ index: 0 }))
      yield* recorder.write(LLMEvent.toolCall({ id: "call_durable_skill", name: "skill", input: { id: loadedSkill.id } }))
      yield* recorder.succeedTool("call_durable_skill", result)
      yield* recorder.write(LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }))
      yield* SessionMessage.complete(database, events, workspaceA, created.id, messageID, "stop")

      const history = yield* sessions.messages({ sessionID: created.id })
      expect(history).toMatchObject([
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              name: "skill",
              state: {
                status: "completed",
                content: [{ type: "text", text: loadedSkill.instructions }],
                result: loadedSkill,
              },
            },
          ],
        },
      ])

      expect(Option.getOrUndefined(yield* Fiber.join(succeeded))).toMatchObject({
        data: {
          content: [{ type: "text", text: loadedSkill.instructions }],
          result: loadedSkill,
        },
      })
    }).pipe(Effect.provide(durable))
  })

  effectIt.effect("settles open tools and the execution in one contiguous failure batch", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const events = yield* Bus.Service
      const database = yield* Database.Service
      const created = yield* sessions.create({ projectID })
      const messageID = MessageID.make("00000000-0000-4000-8000-000000000611")
      const assistant = yield* insertAssistant(database, created, messageID, selectedModel)
      const recorder = yield* SessionRecorder.make({ database, events, assistant, workspaceID: workspaceA })
      yield* recorder.write(LLMEvent.stepStart({ index: 0 }))
      yield* recorder.write(LLMEvent.toolCall({ id: "open", name: "search", input: { q: "x" } }))
      const error = SessionError.Provider.make({ message: "provider failed" })
      yield* recorder.fail(error, 0)
      const page = yield* sessions.messages({ sessionID: created.id })
      expect(page[0]).toMatchObject({
        type: "assistant",
        error,
        content: [{ type: "tool", state: { status: "error", error } }],
        time: { completed: expect.any(Date) },
      })
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("applies each Step usage once and saturates cumulative Session totals", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const events = yield* Bus.Service
      const database = yield* Database.Service
      const created = yield* sessions.create({ projectID })
      const messageID = MessageID.make("00000000-0000-4000-8000-000000000614")
      const assistant = yield* insertAssistant(database, created, messageID, selectedModel)
      const recorder = yield* SessionRecorder.make({
        database,
        events,
        assistant,
        workspaceID: workspaceA,
        cost: { input: 1_000_000, output: 1_000_000, cache: { read: 1_000_000, write: 1_000_000 } },
      })
      const maximum = Number.MAX_SAFE_INTEGER
      const usage = {
        cost: 999_999_999_999_999,
        costComplete: true,
        tokens: {
          total: maximum,
          input: maximum,
          output: maximum,
          reasoning: maximum,
          cache: { read: maximum, write: maximum },
        },
      }
      const providerUsage = {
        inputTokens: maximum,
        outputTokens: maximum,
        nonCachedInputTokens: maximum,
        cacheReadInputTokens: maximum,
        cacheWriteInputTokens: maximum,
        reasoningTokens: maximum,
        totalTokens: maximum,
      }
      yield* recorder.write(LLMEvent.stepStart({ index: 0 }))
      yield* recorder.write(LLMEvent.stepFinish({ index: 0, reason: { normalized: "tool-calls" }, usage: providerUsage }))
      yield* recorder.write(LLMEvent.stepStart({ index: 1 }))
      yield* recorder.write(
        LLMEvent.stepFinish({
          index: 1,
          reason: { normalized: "stop" },
          usage: { ...providerUsage, reasoningTokens: 0 },
        }),
      )

      expect((yield* sessions.get(created.id)).usage).toEqual(usage)
      expect((yield* sessions.messages({ sessionID: created.id }))[0]).toMatchObject({ usage })
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("serializes concurrent Agent and Model selections into visible Messages", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const created = yield* sessions.create({ projectID })
      const modelA = ModelSchema.Ref.make({ provider: ProviderSchema.Name.make("race"), id: "a" })
      const modelB = ModelSchema.Ref.make({ provider: ProviderSchema.Name.make("race"), id: "b" })
      yield* Effect.all(
        [
          sessions.switchAgent({ sessionID: created.id, agent: selectedAgent.id }),
          sessions.switchModel({ sessionID: created.id, model: modelA }),
          sessions.switchModel({ sessionID: created.id, model: modelB }),
        ],
        { concurrency: "unbounded" },
      )
      const detail = yield* sessions.get(created.id)
      const page = yield* sessions.messages({ sessionID: created.id })
      expect([modelA, modelB]).toContainEqual(detail.model)
      expect(page.map((message) => message.type).sort()).toEqual([
        "agent-switched",
        "model-switched",
        "model-switched",
      ])
      expect(page.map((message) => message.sequence).toSorted((left, right) => left - right)).toEqual([2, 3, 4])
    }).pipe(Effect.provide(layerA)),
  )


  effectIt.effect("persists canonical Instruction state and only durable changes", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const events = yield* Bus.Service
      const created = yield* sessions.create({ projectID })
      const value = yield* Ref.make<Schema.Json | Instruction.Unavailable | Instruction.Removed>({
        z: [{ b: 2, a: 1 }],
        a: true,
      })
      const sources = Instruction.make({
        key: InstructionSchema.Key.make("test/canonical"),
        codec: Schema.Json,
        read: Ref.get(value),
        render: {
          initial: (current) => `Initial: ${JSON.stringify(current)}`,
          changed: (_, current) => `Changed: ${JSON.stringify(current)}`,
          removed: () => "Instruction removed",
        },
      })

      yield* InstructionState.prepare(database, events, sources, created.id)
      expect((yield* sessions.messages({ sessionID: created.id }))).toEqual([])

      yield* Ref.set(value, { a: true, z: [{ a: 1, b: 2 }] })
      yield* InstructionState.prepare(database, events, sources, created.id)
      expect((yield* sessions.messages({ sessionID: created.id }))).toEqual([])

      yield* Ref.set(value, { a: false, z: [{ a: 1, b: 2 }] })
      yield* InstructionState.prepare(database, events, sources, created.id)
      yield* Ref.set(value, Instruction.unavailable)
      yield* InstructionState.prepare(database, events, sources, created.id)
      let messages = (yield* sessions.messages({ sessionID: created.id, order: "asc" }))
      expect(messages).toMatchObject([{ type: "system", text: expect.stringContaining("Changed:") }])

      yield* Ref.set(value, Instruction.removed)
      yield* InstructionState.prepare(database, events, sources, created.id)
      yield* InstructionState.prepare(database, events, sources, created.id)
      messages = (yield* sessions.messages({ sessionID: created.id, order: "asc" }))
      expect(messages).toMatchObject([
        { type: "system", text: expect.stringContaining("Changed:") },
        { type: "system", text: "Instruction removed" },
      ])

      const restarted = makeLayer(workspaceA)
      const afterRestart = yield* Session.Service.use((fresh) =>
        Effect.gen(function* () {
          const freshDatabase = yield* Database.Service
          const freshEvents = yield* Bus.Service
          yield* InstructionState.prepare(freshDatabase, freshEvents, sources, created.id)
          return (yield* fresh.messages({ sessionID: created.id }))
        }),
      ).pipe(Effect.provide(restarted))
      expect(afterRestart).toHaveLength(2)
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("reads Instruction sources before opening the synchronization transaction", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const events = yield* Bus.Service
      const created = yield* sessions.create({ projectID })
      const transactionActive = yield* Ref.make<boolean | undefined>(undefined)
      const sources = Instruction.make({
        key: InstructionSchema.Key.make("test/transaction-boundary"),
        codec: Schema.String,
        read: database.use("instructionSourceTransaction", (db) =>
          db
            .select({ active: sql<boolean>`pg_current_xact_id_if_assigned() is not null` })
            .from(sql`(select 1) as instruction_source`)
            .pipe(
              Effect.flatMap(([row]) => Ref.set(transactionActive, row?.active)),
              Effect.as("outside transaction"),
              Effect.orDie,
            ),
        ),
        render: { initial: String, changed: (_, current) => current },
      })

      yield* InstructionState.prepare(database, events, sources, created.id)

      expect(yield* Ref.get(transactionActive)).toBe(false)
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("retries a stale differing Instruction snapshot instead of reversing a newer update", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const events = yield* Bus.Service
      const created = yield* sessions.create({ projectID })
      const value = yield* Ref.make("initial")
      const delayed = yield* Ref.make<
        | {
            readonly entered: Deferred.Deferred<void>
            readonly release: Deferred.Deferred<void>
            readonly value: string
          }
        | undefined
      >(undefined)
      const reads = yield* Ref.make(0)
      const sources = Instruction.make({
        key: InstructionSchema.Key.make("test/stale-snapshot"),
        codec: Schema.String,
        read: Ref.update(reads, (count) => count + 1).pipe(
          Effect.andThen(Ref.getAndSet(delayed, undefined)),
          Effect.flatMap((snapshot) =>
            snapshot === undefined
              ? Ref.get(value)
              : Deferred.succeed(snapshot.entered, undefined).pipe(
                  Effect.andThen(Deferred.await(snapshot.release)),
                  Effect.as(snapshot.value),
                ),
          ),
        ),
        render: { initial: String, changed: (_, current) => `Changed to ${current}` },
      })
      const updateStream = yield* events.subscribe(SessionEvent.InstructionUpdated)
      const updates = yield* updateStream.pipe(
        Stream.filter((event) => event.data.sessionID === created.id),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      )
      yield* InstructionState.prepare(database, events, sources, created.id)

      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* Ref.set(value, "older")
      yield* Ref.set(delayed, { entered, release, value: "older" })
      const stale = yield* InstructionState.prepare(database, events, sources, created.id).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* Ref.set(value, "newest")
      yield* InstructionState.prepare(database, events, sources, created.id)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(stale)

      const instructionEvents = [...(yield* Fiber.join(updates))]
      const [state] = yield* database.use("instructionStaleState", (db) =>
        db.select().from(InstructionTable).where(eq(InstructionTable.sessionID, created.id)),
      )
      const blobs = yield* database.use("instructionStaleBlobs", (db) => db.select().from(InstructionBlobTable))
      const messages = (yield* sessions.messages({ sessionID: created.id }))

      expect(yield* Ref.get(reads)).toBe(4)
      expect(instructionEvents).toHaveLength(2)
      expect(state?.throughSequence).toBe(instructionEvents[1]?.data.system?.sequence)
      expect(blobs.map((blob) => blob.value)).toEqual(expect.arrayContaining(["initial", "newest"]))
      expect(blobs.map((blob) => blob.value)).not.toContain("older")
      expect(messages).toMatchObject([{ type: "system", text: "Changed to newest" }])
    }).pipe(Effect.scoped, Effect.provide(layerA)),
  )

  effectIt.effect("retries stale initial unavailability after another prepare establishes state", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const events = yield* Bus.Service
      const created = yield* sessions.create({ projectID })
      const value = yield* Ref.make<string | Instruction.Unavailable>(Instruction.unavailable)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const delay = yield* Ref.make(true)
      const sources = Instruction.make({
        key: InstructionSchema.Key.make("test/stale-unavailable"),
        codec: Schema.String,
        read: Ref.getAndSet(delay, false).pipe(
          Effect.flatMap((delayed) =>
            delayed
              ? Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.as(Instruction.unavailable),
                )
              : Ref.get(value),
          ),
        ),
        render: { initial: String, changed: (_, current) => current },
      })
      const updateStream = yield* events.subscribe(SessionEvent.InstructionUpdated)
      const update = yield* updateStream.pipe(
        Stream.filter((event) => event.data.sessionID === created.id),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      )
      const stale = yield* InstructionState.prepare(database, events, sources, created.id).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* Ref.set(value, "available")
      yield* InstructionState.prepare(database, events, sources, created.id)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(stale)

      const instructionEvents = [...(yield* Fiber.join(update))]
      expect(instructionEvents).toHaveLength(1)
      expect((yield* sessions.messages({ sessionID: created.id }))).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(layerA)),
  )

  effectIt.effect("serializes simultaneous initial and changed Instruction prepares", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const events = yield* Bus.Service
      const created = yield* sessions.create({ projectID })
      const value = yield* Ref.make("initial")
      const gate = yield* Ref.make<
        { readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> } | undefined
      >(undefined)
      const sources = Instruction.make({
        key: InstructionSchema.Key.make("test/concurrent"),
        codec: Schema.String,
        read: Ref.getAndSet(gate, undefined).pipe(
          Effect.flatMap((current) =>
            current === undefined
              ? Ref.get(value)
              : Deferred.succeed(current.entered, undefined).pipe(
                  Effect.andThen(Deferred.await(current.release)),
                  Effect.andThen(Ref.get(value)),
                ),
          ),
        ),
        render: { initial: (current) => current, changed: (_, current) => `Changed to ${current}` },
      })
      const updateStream = yield* events.subscribe(SessionEvent.InstructionUpdated)
      const updates = yield* updateStream.pipe(
        Stream.filter((event) => event.data.sessionID === created.id),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      )
      const prepareTogether = Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        yield* Ref.set(gate, { entered, release })
        const first = yield* InstructionState.prepare(database, events, sources, created.id).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const second = yield* InstructionState.prepare(database, events, sources, created.id).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      })

      yield* prepareTogether
      yield* Ref.set(value, "changed")
      yield* prepareTogether

      const instructionEvents = [...(yield* Fiber.join(updates))]
      const state = yield* database.use("instructionConcurrentState", (db) =>
        db.select().from(InstructionTable).where(eq(InstructionTable.sessionID, created.id)),
      )
      const messages = (yield* sessions.messages({ sessionID: created.id }))

      expect(instructionEvents).toHaveLength(2)
      const initial = instructionEvents.find((event) => event.data.system === undefined)
      const changed = instructionEvents.find((event) => event.data.system?.text === "Changed to changed")
      if (initial === undefined || changed === undefined)
        return yield* Effect.die(new Error("Expected initial and changed Instruction events"))
      expect(state).toHaveLength(1)
      expect(state[0]?.throughSequence).toBe(changed.data.system?.sequence)
      expect(initial.data.delta).toEqual(state[0]?.initialValues)
      expect(changed.data.delta).toEqual(state[0]?.currentValues)
      expect(state[0]?.initialValues).not.toEqual(state[0]?.currentValues)
      expect(messages).toMatchObject([{ type: "system", text: "Changed to changed" }])
    }).pipe(Effect.scoped, Effect.provide(layerA)),
  )

  effectIt.effect("blocks initial unavailable Instruction sources without persisting Messages", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const created = yield* sessions.create({ projectID })
      const sources = Instruction.make({
        key: InstructionSchema.Key.make("test/unavailable"),
        codec: Schema.String,
        read: Effect.succeed(Instruction.unavailable),
        render: { initial: String, changed: (_, current) => current },
      })
      const events = yield* Bus.Service
      const failure = yield* InstructionState.prepare(database, events, sources, created.id).pipe(Effect.flip)
      expect(failure).toMatchObject({ _tag: "Instruction.InitializationError" })

      expect((yield* sessions.messages({ sessionID: created.id }))).toEqual([])
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("uses a completed checkpoint as the context boundary and re-anchors instructions", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const created = yield* sessions.create({ projectID })
      const oldID = MessageID.make("00000000-0000-4000-8000-000000000721")
      const checkpointID = MessageID.make("00000000-0000-4000-8000-000000000722")
      const recentID = MessageID.make("00000000-0000-4000-8000-000000000723")
      const key = InstructionSchema.Key.make("test/checkpoint")
      const initial = InstructionSchema.Hash.make("a".repeat(64))
      const current = InstructionSchema.Hash.make("b".repeat(64))
      yield* database.use("checkpointInstructionSeed", (db) =>
        db.insert(InstructionTable).values({
          sessionID: created.id,
          throughSequence: 1,
          initialValues: { [key]: initial },
          currentValues: { [key]: current },
        }),
      )
      const old = UserMessage.make({ id: oldID, sessionID: created.id, sequence: 2, type: "user", text: "old", delivery: "queue", admittedSequence: 1, createdAt: new Date(0) })
      const usage = {
        cost: 0.25,
        costComplete: false,
        tokens: { total: 15, input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      const checkpoint = CompactionCompleted.make({ id: checkpointID, sessionID: created.id, sequence: 3, type: "compaction", status: "completed", reason: "auto", summary: "summary", recent: "recent", createdAt: new Date(1) })
      const recent = UserMessage.make({ id: recentID, sessionID: created.id, sequence: 4, type: "user", text: "new", delivery: "queue", admittedSequence: 2, createdAt: new Date(2) })
      yield* database.transactRoot(
        database.use("checkpointMessages", (db) =>
          Effect.gen(function* () {
            yield* db.insert(SessionMessageTable).values([old, checkpoint, recent].map((message) => ({ id: message.id, sessionID: message.sessionID, sequence: message.sequence, type: message.type, data: message, timeCreated: message.createdAt, timeUpdated: message.createdAt })))
            yield* db.update(SessionTable).set({ sequence: 4, usage_cost: usage.cost.toString(), usageCostComplete: usage.costComplete, usageTotal: BigInt(usage.tokens.total), usageInput: BigInt(usage.tokens.input), usageOutput: BigInt(usage.tokens.output), usageReasoning: BigInt(usage.tokens.reasoning), usageCacheRead: BigInt(usage.tokens.cache.read), usageCacheWrite: BigInt(usage.tokens.cache.write) }).where(eq(SessionTable.id, created.id))
            yield* InstructionState.anchor(db, created.id, checkpoint.sequence)
          }),
        ),
      )

      expect((yield* SessionMessage.context(database, workspaceA, created.id)).map((message) => message.id)).toEqual([
        checkpointID,
        recentID,
      ])
      expect((yield* sessions.messages({ sessionID: created.id }))).toHaveLength(
        3,
      )
      expect((yield* sessions.get(created.id)).usage).toEqual(usage)
      const [state] = yield* database.use("checkpointInstructionState", (db) =>
        db.select().from(InstructionTable).where(eq(InstructionTable.sessionID, created.id)),
      )
      expect(state?.initialValues).toEqual(state?.currentValues)
    }).pipe(Effect.provide(layerA)),
  )

  effectIt.effect("generates the first-prompt title without waiting for the main response", () =>
    Effect.gen(function* () {
      const mainStarted = yield* Deferred.make<void>()
      const titleRequests = yield* Ref.make<ReadonlyArray<Provider.StreamInput>>([])
      const provider = withProviderStream((input) => {
        if (input.tools?.some(({ name }) => name === "execute") !== true)
          return Stream.fromEffect(Ref.update(titleRequests, (requests) => [...requests, input])).pipe(
            Stream.drain,
            Stream.concat(Stream.make(LLMEvent.textDelta({ id: "title", text: "Investigating durable sessions\n" }))),
          )
        return Stream.fromEffect(Deferred.succeed(mainStarted, undefined)).pipe(
          Stream.drain,
          Stream.concat(Stream.never),
        )
      })
      const runtime = makeLayer(workspaceA, provider, titleAgents)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const events = yield* Bus.Service
          const hooks = yield* PluginHooks.Service
          const created = yield* sessions.create({ projectID, model: titleModel })
          yield* hooks.register("session", "model.request", (request) =>
            request.purpose !== "title"
              ? Effect.void
              : Effect.sync(() => {
                  request.model = ModelSchema.Ref.make({ provider: ProviderSchema.OpenAI, id: "gpt-5.4-mini" })
                }),
          )
          const renamedStream = yield* events.subscribe(SessionEvent.Updated)
          const renamed = yield* renamedStream.pipe(
            Stream.filter(
              (event) =>
                event.data.sessionID === created.id && event.data.session.title === "Investigating durable sessions",
            ),
            Stream.take(1),
            Stream.runDrain,
            Effect.forkChild,
          )

          yield* sessions.prompt({
            sessionID: created.id,
            id: MessageID.make("00000000-0000-4000-8000-000000000650"),
            text: "Investigate how durable sessions work",
          })
          yield* Deferred.await(mainStarted)
          yield* Fiber.join(renamed)

          expect((yield* sessions.get(created.id)).title).toBe("Investigating durable sessions")
          expect(yield* Ref.get(titleRequests)).toMatchObject([
            {
              context: { purpose: "title", requestedModel: titleModel, model: { id: "gpt-5.4-mini" } },
              selection: { info: { id: "gpt-5.4-mini" } },
              messages: [{ role: "user", content: [{ type: "text", text: "Investigate how durable sessions work" }] }],
            },
          ])
        }),
      ).pipe(Effect.provide(runtime))
    }),
  )

  effectIt.effect("retries failed title generation from the original first prompt", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<Provider.StreamInput>>([])
      const activations = yield* Ref.make(0)
      const provider = withProviderStream((input) =>
        Stream.unwrap(
          Ref.modify(calls, (current) => {
            const next = [...current, input]
            return [
              current.length === 0
                ? Stream.fail(new Provider.FailureError({ cause: "title unavailable" }))
                : Stream.make(LLMEvent.textDelta({ id: "title", text: "Recovered original title" })),
              next,
            ] as const
          }),
        ),
      )
      const created = yield* Session.Service.use((sessions) => sessions.create({ projectID, model: titleModel })).pipe(
        Effect.provide(layerA),
      )
      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const titles = yield* SessionTitle.make(
          database,
          events,
          workspaceA,
          Ref.update(activations, (count) => count + 1),
        )
        yield* inbox.admitPrompt({ sessionID: created.id, id: MessageID.make("00000000-0000-4000-8000-000000000651"), text: "Original title prompt", delivery: "queue" })
        yield* inbox.deliver(created.id)
        yield* titles.generateForFirstPrompt(created.id)
        expect(
          (yield* Session.Service.use((sessions) => sessions.get(created.id)).pipe(Effect.provide(layerA))).title,
        ).toBe("New session")
        yield* inbox.admitPrompt({ sessionID: created.id, id: MessageID.make("00000000-0000-4000-8000-000000000652"), text: "Later prompt", delivery: "queue" })
        yield* inbox.deliver(created.id)
        yield* titles.generateForFirstPrompt(created.id)

        expect(
          (yield* Session.Service.use((sessions) => sessions.get(created.id)).pipe(Effect.provide(layerA))).title,
        ).toBe("Recovered original title")
        expect((yield* Ref.get(calls)).map((input) => JSON.stringify(input.messages))).toEqual([
          expect.stringContaining("Original title prompt"),
          expect.stringContaining("Original title prompt"),
        ])
        expect(yield* Ref.get(activations)).toBe(2)
      }).pipe(Effect.provide(makeRunnerDependencies(workspaceA, provider, titleAgents)))
    }),
  )

  effectIt.effect("falls back to the first prompt text when the title model returns only a code block", () =>
    Effect.gen(function* () {
      const provider = withProviderStream(() =>
        Stream.make(LLMEvent.textDelta({ id: "title", text: "```mermaid\nflowchart LR\n  A --> B\n```" })),
      )
      const created = yield* Session.Service.use((sessions) => sessions.create({ projectID, model: titleModel })).pipe(
        Effect.provide(layerA),
      )
      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const titles = yield* SessionTitle.make(database, events, workspaceA)
        yield* inbox.admitPrompt({
          sessionID: created.id,
          id: MessageID.make("00000000-0000-4000-8000-000000000699"),
          text: "Draw a flowchart A to B in a mermaid code block. No other text.",
          delivery: "queue",
        })
        yield* inbox.deliver(created.id)
        yield* titles.generateForFirstPrompt(created.id)
        expect(
          (yield* Session.Service.use((sessions) => sessions.get(created.id)).pipe(Effect.provide(layerA))).title,
        ).toBe("Draw a flowchart A to B in a")
      }).pipe(Effect.provide(makeRunnerDependencies(workspaceA, provider, titleAgents)))
    }),
  )

  effectIt.effect("preserves a manual rename completed while title generation is in flight", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const provider = withProviderStream(() =>
        Stream.fromEffect(Deferred.succeed(started, undefined)).pipe(
          Stream.drain,
          Stream.concat(Stream.fromEffect(Deferred.await(release)).pipe(Stream.drain)),
          Stream.concat(Stream.make(LLMEvent.textDelta({ id: "title", text: "Generated title" }))),
        ),
      )
      const created = yield* Session.Service.use((sessions) => sessions.create({ projectID, model: titleModel })).pipe(
        Effect.provide(layerA),
      )
      yield* Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* Bus.Service
        const inbox = yield* SessionInbox.Service
        const titles = yield* SessionTitle.make(database, events, workspaceA)
        yield* inbox.admitPrompt({ sessionID: created.id, id: MessageID.make("00000000-0000-4000-8000-000000000653"), text: "Generate a title", delivery: "queue" })
        yield* inbox.deliver(created.id)
        const generated = yield* titles.generateForFirstPrompt(created.id).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* Session.Service.use((sessions) =>
          sessions.update({ sessionID: created.id, title: "Manual title" }),
        ).pipe(Effect.provide(layerA))
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(generated)

        expect(
          (yield* Session.Service.use((sessions) => sessions.get(created.id)).pipe(Effect.provide(layerA))).title,
        ).toBe("Manual title")
      }).pipe(Effect.provide(makeRunnerDependencies(workspaceA, provider, titleAgents)))
    }),
  )
})
