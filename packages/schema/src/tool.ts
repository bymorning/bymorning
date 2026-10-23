export * as Tool from "./tool.js"

import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec"
import { Effect, JsonSchema, Schema } from "effect"
import type { Agent } from "./agent.js"
import type { Session } from "./session.js"
import type { ID as MessageID } from "./message.js"
import { Project } from "./project.js"
import { ProjectDirectory } from "./project-directory.js"
import type { User } from "./user.js"
import type { Form } from "./form.js"

export type Metadata = Readonly<Record<string, unknown>>

export const CallID = Schema.String.pipe(Schema.brand("Tool.CallID"))
export type CallID = typeof CallID.Type

export type Caller =
  | {
      readonly type: "session"
      readonly sessionID: Session.ID
      readonly agent: Agent.ID
      readonly messageID: MessageID
      readonly projectID: Project.ID
    }
  | { readonly type: "gateway"; readonly userID: User.ID; readonly projectID?: Project.ID }

export interface PermissionRequest {
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly save?: ReadonlyArray<string>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface Namespace {
  readonly name: string
  readonly description?: string
}

export interface Context {
  readonly caller: Caller
  readonly id: CallID
  readonly progress: (update: Metadata) => Effect.Effect<void>
  /** Authorize the actual operation; gateway callers cannot obtain interactive approval. */
  readonly permission: (request: PermissionRequest) => Effect.Effect<void, Error>
  /** Request input from the participant acting in this Tool's Session. */
  readonly elicit: (input: ElicitInput) => Effect.Effect<ElicitResult, Error>
}

export type ElicitInput =
  | {
      readonly mode: "form"
      readonly title: string
      readonly message: string
      readonly fields: Form.Fields
    }
  | {
      readonly mode: "url"
      readonly title: string
      readonly message: string
      readonly url: string
    }

export type ElicitResult =
  | { readonly action: "accept"; readonly answer: Form.Answer }
  | { readonly action: "decline" }
  | { readonly action: "cancel" }

interface BaseOptions {
  readonly namespace?: string
  readonly permission?: string
  /** Explicitly admits this built-in Tool to the external Tool Gateway catalog. */
  readonly gateway?: boolean
}

export type Options = BaseOptions &
  ({ readonly codemode?: true; readonly pinned?: boolean } | { readonly codemode: boolean; readonly pinned?: never })

/** Languages supported by AgentCore Code Interpreter's pinned executeCode API. */
export const Language = Schema.Literals(["python", "javascript", "typescript"])
/** Languages supported by AgentCore Code Interpreter's pinned executeCode API. */
export type Language = typeof Language.Type

/** Inline sandbox implementation supplied at Tool registration time. */
export interface InlineImplementation {
  readonly type: "inline"
  readonly language: Language
  readonly body: string
}
/** Inline sandbox implementation supplied at Tool registration time. */
export const InlineImplementation = Schema.Struct({
  type: Schema.Literal("inline"),
  language: Language,
  body: Schema.String,
})

/** Project File sandbox implementation supplied at Tool registration time. */
export interface ProjectFileImplementation {
  readonly type: "project-file"
  readonly path: ProjectDirectory.Path
  readonly language?: Language
}
/** Project File sandbox implementation supplied at Tool registration time. */
export const ProjectFileImplementation = Schema.Struct({
  type: Schema.Literal("project-file"),
  path: ProjectDirectory.Path,
  language: Schema.optionalKey(Language),
})

/** A custom Tool implementation that executes in AgentCore Code Interpreter. */
export type Implementation = InlineImplementation | ProjectFileImplementation
/** A custom Tool implementation that executes in AgentCore Code Interpreter. */
export const Implementation = Schema.Union([InlineImplementation, ProjectFileImplementation])

export type ValueSchema<A = unknown> =
  Schema.Codec<A, any> | (StandardSchemaV1<any, A> & StandardJSONSchemaV1<any, A>) | JsonSchema.JsonSchema

type InputValue<S> = 0 extends 1 & S
  ? any
  : S extends Schema.Codec<infer A, any>
    ? A
    : S extends StandardSchemaV1<any, infer A>
      ? A
      : unknown
type OutputValue<S> = S extends undefined
  ? never
  : S extends Schema.Codec<infer A, any>
    ? A
    : S extends StandardSchemaV1<infer A, any>
      ? A
      : any

export class Error extends Schema.TaggedError<Error>()("Tool.Error", {
  message: Schema.String,
  error: Schema.optional(Schema.Defect()),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export interface TextContent extends Schema.Schema.Type<typeof TextContent> {}
export const TextContent = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }).annotate({
  identifier: "Tool.TextContent",
})

export interface FileContent extends Schema.Schema.Type<typeof FileContent> {}
export const FileContent = Schema.Struct({
  type: Schema.Literal("file"),
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.optional(Schema.String),
}).annotate({ identifier: "Tool.FileContent" })

export const Content = Schema.Union([TextContent, FileContent])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Tool.Content" })
export type Content = Schema.Schema.Type<typeof Content>

export interface Result<Output extends ValueSchema<any> | undefined = ValueSchema<any> | undefined> {
  readonly output?: OutputValue<Output>
  readonly content?: string | ReadonlyArray<Content>
  readonly metadata?: Metadata
}

type BaseInfo<
  Input extends ValueSchema<any> = ValueSchema<any>,
  Output extends ValueSchema<any> | undefined = ValueSchema<any> | undefined,
> = {
  readonly name: string
  readonly input: Input
  readonly description: string
  readonly output?: Output
  readonly options?: Options
}

/** Executable Tool, including a sandbox declaration normalized by the runtime. */
export type Info<
  Input extends ValueSchema<any> = ValueSchema<any>,
  Output extends ValueSchema<any> | undefined = ValueSchema<any> | undefined,
> = BaseInfo<Input, Output> & {
  readonly execute: (input: InputValue<Input>, context: Context) => Effect.Effect<Result<Output>, Error>
}

/** Sandbox-first Tool registration. Project identity is supplied by PluginHost. */
export type SandboxRegistration<
  Input extends ValueSchema<any> = ValueSchema<any>,
  Output extends ValueSchema<any> | undefined = ValueSchema<any> | undefined,
> = BaseInfo<Input, Output> & {
  readonly execution: "sandbox"
  readonly implementation: Implementation
  readonly execute?: never
}

/** Public registration algebra accepted by plugin Tool transforms. */
export type Registration<
  Input extends ValueSchema<any> = ValueSchema<any>,
  Output extends ValueSchema<any> | undefined = ValueSchema<any> | undefined,
> = Info<Input, Output> | SandboxRegistration<Input, Output>
