import { createSignal, For, Show, type JSX } from "solid-js"
import type { Message } from "@bymorning/client/solid"

import { useSession } from "../context/session"
import { Markdown } from "../markdown/markdown"
import type { SessionUI } from "../model"
import { ToolDisplay } from "../tool/tool-display"

export function MessageView(props: {
  readonly message: Message
  readonly reasoning?: boolean | undefined
  readonly onFileOpen?: ((path: string) => void) | undefined
  readonly openSession?: SessionUI.ToolProps["openSession"]
  readonly sessionHref?: SessionUI.ToolProps["sessionHref"]
}): JSX.Element {
  const message = props.message
  if (message.type === "user")
    return (
      <article data-component="user-message" data-role="user">
        <p dir="auto">{message.text}</p>
      </article>
    )
  if (message.type === "assistant")
    return (
      <Assistant
        message={message}
        reasoning={props.reasoning}
        onFileOpen={props.onFileOpen}
        openSession={props.openSession}
        sessionHref={props.sessionHref}
      />
    )
  if (message.type === "compaction") return <Compaction message={message} />
  if (message.type === "agent-switched")
    return (
      <article data-component="message" data-message-type={message.type}>
        <p>{message.agent}</p>
      </article>
    )
  if (message.type === "model-switched")
    return (
      <article data-component="message" data-message-type={message.type}>
        <p>
          {message.model.provider}/{message.model.id}
        </p>
      </article>
    )
  return (
    <article data-component="message" data-message-type={message.type}>
      <p>{message.text}</p>
    </article>
  )
}

function Compaction(props: { readonly message: Extract<Message, { readonly type: "compaction" }> }) {
  const session = useSession()
  if (props.message.status === "failed")
    return (
      <article data-component="compaction" data-status="failed">
        <p role="alert">{props.message.error.message}</p>
      </article>
    )
  return (
    <article data-component="compaction" data-status={props.message.status}>
      <Markdown text={props.message.summary} cacheKey={`${props.message.id}:summary`} />
      <Show when={props.message.status === "running"}>
        <p role="status">{session.labels().running}</p>
      </Show>
    </article>
  )
}

function Assistant(props: {
  readonly message: SessionUI.Assistant
  readonly reasoning?: boolean | undefined
  readonly onFileOpen?: ((path: string) => void) | undefined
  readonly openSession?: SessionUI.ToolProps["openSession"]
  readonly sessionHref?: SessionUI.ToolProps["sessionHref"]
}) {
  const session = useSession()
  const model = () =>
    `${props.message.model.provider}/${props.message.model.id}${props.message.model.variant ? `/${props.message.model.variant}` : ""}`
  return (
    <article data-component="assistant-message" data-finish={props.message.finish}>
      <For each={props.message.content}>
        {(part) => (
          <Part
            assistant={props.message}
            part={part}
            reasoning={props.reasoning}
            onFileOpen={props.onFileOpen}
            openSession={props.openSession}
            sessionHref={props.sessionHref}
          />
        )}
      </For>
      <Show when={props.message.error}>
        {(error) => (
          <p role="alert" data-component="message-error">
            {error().message}
          </p>
        )}
      </Show>
      <Show when={props.message.retry}>
        <p data-slot="message-retry">{props.message.retry?.error.message}</p>
      </Show>
      <Show when={props.message.finish === "error" && !props.message.error}>
        <p role="alert" data-component="message-error">
          {session.labels().toolFailed}
        </p>
      </Show>
      <footer data-slot="assistant-meta">
        <Show when={props.message.agent}>{(agent) => <span>{agent()}</span>}</Show>
        <span>{model()}</span>
        <Show when={props.message.time.completed === undefined}>
          <span>{session.labels().running}</span>
        </Show>
      </footer>
    </article>
  )
}

function Part(props: {
  readonly assistant: SessionUI.Assistant
  readonly part: SessionUI.Assistant["content"][number]
  readonly reasoning?: boolean | undefined
  readonly onFileOpen?: ((path: string) => void) | undefined
  readonly openSession?: SessionUI.ToolProps["openSession"]
  readonly sessionHref?: SessionUI.ToolProps["sessionHref"]
}) {
  const session = useSession()
  if (props.part.type === "text")
    return (
      <Markdown
        text={props.part.text}
        streaming={props.assistant.time.completed === undefined}
        cacheKey={`${props.assistant.id}:${props.part.id}`}
      />
    )
  if (props.part.type === "reasoning")
    return props.reasoning === false ? null : (
      <details data-component="reasoning">
        <summary>{session.labels().toolThinking}</summary>
        <Markdown
          text={props.part.text}
          streaming={props.part.time?.completed === undefined}
          cacheKey={`${props.assistant.id}:${props.part.id}`}
        />
      </details>
    )
  const [open, setOpen] = createSignal(false)
  return (
    <ToolDisplay
      assistant={props.assistant}
      part={props.part}
      open={open}
      setOpen={setOpen}
      {...(props.onFileOpen === undefined ? {} : { onFileOpen: props.onFileOpen })}
      {...(props.openSession === undefined ? {} : { openSession: props.openSession })}
      {...(props.sessionHref === undefined ? {} : { sessionHref: props.sessionHref })}
    />
  )
}

import "./message.css"
