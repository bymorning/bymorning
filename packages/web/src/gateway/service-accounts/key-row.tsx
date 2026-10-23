import type { ServiceAccountKeyListOutput } from "@bymorning/client"
import { Show } from "solid-js"

import { useDialog } from "../../context/dialog"
import { Button } from "../../ui/components/button"
import { ConfirmDialog } from "../../ui/components/confirm-dialog"
import { Tag } from "../../ui/components/tag"
import { formatMediumDate } from "../../ui/format"

export function KeyRow(props: {
  readonly apiKey: ServiceAccountKeyListOutput[number]
  readonly revoke: () => Promise<unknown>
}) {
  const dialog = useDialog()
  const status = props.apiKey.timeRevoked
    ? "Revoked"
    : props.apiKey.timeExpires && new Date(props.apiKey.timeExpires).getTime() <= Date.now()
      ? "Expired"
      : "Active"
  return (
    <tr>
      <th scope="row">{props.apiKey.name}</th>
      <td>
        <code>{props.apiKey.prefix}…</code>
      </td>
      <td>{formatMediumDate(props.apiKey.timeCreated)}</td>
      <td>{props.apiKey.timeUsed ? formatMediumDate(props.apiKey.timeUsed) : "Never"}</td>
      <td>{props.apiKey.timeExpires ? formatMediumDate(props.apiKey.timeExpires) : "Never"}</td>
      <td>
        <Tag data-status={status.toLowerCase()}>{status}</Tag>
      </td>
      <td>
        <Show when={status !== "Revoked"}>
          <Button
            type="button"
            size="small"
            variant="ghost"
            onClick={() =>
              dialog.push(() => (
                <ConfirmDialog
                  title="Revoke API key?"
                  description={`Revoke ${props.apiKey.name}? Requests using it will immediately fail.`}
                  confirmLabel="Revoke"
                  danger
                  onConfirm={props.revoke}
                />
              ))
            }
          >
            Revoke
          </Button>
        </Show>
      </td>
    </tr>
  )
}
