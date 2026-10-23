import type { ServiceAccountListOutput } from "@bymorning/client"
import { A } from "@solidjs/router"
import { Show } from "solid-js"

import { ActionMenu } from "../../ui/components/action-menu"
import { Tag } from "../../ui/components/tag"
import { Usage } from "../../ui/components/usage-limit"
import { formatDollars, formatMediumDate } from "../../ui/format"
import { serviceAccountRouteHref } from "../../workspace-route-paths"
import type { Account, WorkspaceID } from "./page"

export function AccountRow(props: {
  readonly account: Account
  readonly workspace: WorkspaceID
  readonly usage: number | undefined
  readonly limit: number | undefined
  readonly onEdit: () => void
  readonly onCreateKey: () => void
  readonly onToggleStatus: () => void
  readonly onDelete: () => void
}) {
  return (
    <tr>
      <th scope="row">
        <A data-slot="account-link" href={serviceAccountRouteHref(props.workspace, props.account.id)}>
          {props.account.name}
        </A>
      </th>
      <td>
        <Tag data-status={props.account.status}>{props.account.status === "active" ? "Active" : "Suspended"}</Tag>
      </td>
      <td>{props.account.keyCount}</td>
      <td>{formatMediumDate(props.account.timeCreated)}</td>
      <td>
        <Usage usage={props.usage} limit={props.limit} />
      </td>
      <td>
        <Show when={props.limit !== undefined} fallback="—">
          {formatDollars(props.limit ?? 0)}
        </Show>
      </td>
      <td>
        <ActionMenu label={props.account.name}>
          <ActionMenu.Item onSelect={() => props.onCreateKey()}>Create API key</ActionMenu.Item>
          <ActionMenu.Item onSelect={() => props.onEdit()}>Edit</ActionMenu.Item>
          <ActionMenu.Item onSelect={() => props.onToggleStatus()}>
            {props.account.status === "active" ? "Suspend" : "Activate"}
          </ActionMenu.Item>
          <ActionMenu.Separator />
          <ActionMenu.Item onSelect={() => props.onDelete()}>Delete</ActionMenu.Item>
        </ActionMenu>
      </td>
    </tr>
  )
}
