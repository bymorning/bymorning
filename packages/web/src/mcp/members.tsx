import type { McpServersMembersOutput } from "@bymorning/client"
import { createMemo, createResource, For, Match, Show, Switch, type JSX } from "solid-js"

import { useSDK } from "../context/sdk"
import { useWorkspace } from "../context/workspace"
import { Tag } from "../ui/components/tag"

type Member = McpServersMembersOutput[number]

/**
 * Which Workspace members have saved their own values for one server. Administrators see only
 * whether each member has connected and when; the values themselves are never available.
 */
export function MCPMembers(props: {
  readonly server: string
  /** Changes whenever the server's status does, so the list follows a member connecting. */
  readonly version: string
}): JSX.Element {
  const sdk = useSDK()
  const workspace = useWorkspace()
  const [members] = createResource(
    () => ({ server: props.server, workspace: workspace.current().id, version: props.version }),
    (input) => sdk.client.mcp.servers.members({ server: input.server, workspace: input.workspace }),
  )
  const connected = createMemo(() => members()?.filter((member) => member.connected).length ?? 0)
  return (
    <section data-slot="mcp-members" aria-labelledby="mcp-members-title">
      <div data-slot="mcp-members-heading">
        <h2 id="mcp-members-title">Members</h2>
        <Show when={members()}>
          {(list) => (
            <p>
              {connected()} of {list().length} {list().length === 1 ? "member has" : "members have"} saved their own
              values.
            </p>
          )}
        </Show>
      </div>
      <Switch>
        <Match when={members.error}>
          <p role="alert">Could not load members.</p>
        </Match>
        <Match when={members()}>
          {(list) => (
            <ul data-slot="mcp-member-list" aria-label="Members">
              <For each={list()}>{(member) => <MemberRow member={member} />}</For>
            </ul>
          )}
        </Match>
        <Match when={members.loading}>
          <p role="status">Loading members…</p>
        </Match>
      </Switch>
    </section>
  )
}

function MemberRow(props: { readonly member: Member }): JSX.Element {
  return (
    <li data-slot="mcp-member">
      <span data-slot="mcp-member-email">{props.member.email}</span>
      <span data-slot="mcp-member-status">
        <Show when={props.member.updated}>
          {(updated) => (
            <time dateTime={updated()} data-slot="mcp-member-updated">
              Updated {new Date(updated()).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </time>
          )}
        </Show>
        <Tag variant={props.member.connected ? "accent" : "neutral"}>
          {props.member.connected ? "Values saved" : "No values"}
        </Tag>
      </span>
    </li>
  )
}
