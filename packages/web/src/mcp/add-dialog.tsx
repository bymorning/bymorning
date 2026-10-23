import { ConfigMCP } from "@bymorning/schema/config/mcp"
import { createMemo, Show, type JSX } from "solid-js"

import { createForm } from "../ui/form"
import { FormDialog } from "../ui/components/form-dialog"
import { FormFrame } from "../ui/components/form-frame"
import { Field } from "../ui/components/field"
import { RadioGroup, RadioItem } from "../ui/components/radio"
import { Textarea } from "../ui/components/textarea"
import { TextInput } from "../ui/components/text-input"

export type MCPAddInput = {
  readonly name: string
  readonly url: string
  readonly headers?: Record<string, string>
  readonly oauth?: false
}

type Auth = "oauth" | "values"

/** Parse `Name: value` lines. Blank lines are ignored; the first colon separates name from value. */
export function parseHeaders(text: string): { readonly headers: Record<string, string> } | { readonly error: string } {
  const headers: Record<string, string> = {}
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim()
    if (line === "") continue
    const colon = line.indexOf(":")
    if (colon <= 0) return { error: `Header line ${index + 1} must look like Name: value` }
    const name = line.slice(0, colon).trim()
    if (name in headers) return { error: `Header ${name} is listed twice` }
    headers[name] = line.slice(colon + 1).trim()
  }
  return { headers }
}

export function MCPAddDialog(props: { readonly onSubmit: (input: MCPAddInput) => Promise<void> }): JSX.Element {
  const form = createForm({
    values: { name: "", url: "", headers: "", auth: "oauth" as Auth },
    validate: (values) => {
      const parsed = parseHeaders(values.headers)
      if ("error" in parsed) return parsed.error
      const found = ConfigMCP.placeholders(parsed.headers)
      if (found.error !== undefined) return found.error
      return undefined
    },
    submit: (values) => {
      const parsed = parseHeaders(values.headers)
      const headers = "headers" in parsed && Object.keys(parsed.headers).length > 0 ? parsed.headers : undefined
      return props.onSubmit({
        name: values.name.trim(),
        url: values.url.trim(),
        ...(headers === undefined ? {} : { headers }),
        ...(effectiveAuth() === "values" ? { oauth: false as const } : {}),
      })
    },
    fallback: "Could not add the integration.",
  })
  const found = createMemo(() => {
    const parsed = parseHeaders(form.values.headers)
    return "error" in parsed ? undefined : ConfigMCP.placeholders(parsed.headers)
  })
  const headerError = () => {
    const parsed = parseHeaders(form.values.headers)
    return "error" in parsed || found()?.error !== undefined
  }
  /** Member Values and OAuth are mutually exclusive: placeholders decide. */
  const personal = () => {
    const current = found()
    return current !== undefined && current.error === undefined && (current.member.length > 0 || current.builtin.length > 0)
  }
  const effectiveAuth = (): Auth => (personal() ? "values" : form.values.auth)
  return (
    <FormDialog
      form={form}
      title="Add MCP server"
      actions={
        <FormFrame.Actions
          submitLabel="Add MCP server"
          pendingLabel="Adding…"
          disabled={!form.values.name.trim() || !form.values.url.trim()}
        />
      }
    >
      <FormFrame.Fields layout="paired">
        <Field>
          <Field.Label>Name</Field.Label>
          <TextInput
            autofocus
            required
            appearance="full-width"
            disabled={form.pending}
            value={form.values.name}
            onInput={(event) => form.set("name", event.currentTarget.value)}
          />
        </Field>
        <Field>
          <Field.Label>URL</Field.Label>
          <TextInput
            required
            type="url"
            appearance="full-width"
            disabled={form.pending}
            placeholder="https://mcp.linear.app/mcp"
            value={form.values.url}
            onInput={(event) => form.set("url", event.currentTarget.value)}
          />
        </Field>
      </FormFrame.Fields>
      <FormFrame.Fields>
        <Field>
          <Field.Label>Headers (optional)</Field.Label>
          <Textarea
            appearance="full-width"
            invalid={form.error !== undefined && headerError()}
            rows={4}
            disabled={form.pending}
            spellcheck={false}
            aria-describedby="mcp-headers-hint"
            value={form.values.headers}
            onInput={(event) => form.set("headers", event.currentTarget.value)}
          />
          <p id="mcp-headers-hint" data-slot="mcp-headers-hint">
            One <code>Name: value</code> per line, for example <code>{"Authorization: Bearer ${TOKEN}"}</code>.{" "}
            <code>{"${NAME}"}</code> asks each member for their own value; <code>{"${member.email}"}</code> uses the
            member's email. Other values are shared by everyone.
          </p>
        </Field>
        <RadioGroup
          label="Member authentication"
          value={effectiveAuth()}
          disabled={form.pending}
          onChange={(value) => form.set("auth", value as Auth)}
        >
          <RadioItem
            value="oauth"
            label="OAuth"
            description="Each member signs in to the server."
            disabled={personal()}
          />
          <RadioItem
            value="values"
            label="Member values or none"
            description="Members supply the values the headers ask for; shared headers only otherwise."
          />
        </RadioGroup>
        <Show when={found()?.member.length ? found()!.member : undefined}>
          {(names) => (
            <p role="status" data-slot="mcp-member-values">
              Each member will be asked for: {names().join(", ")}
            </p>
          )}
        </Show>
      </FormFrame.Fields>
    </FormDialog>
  )
}
