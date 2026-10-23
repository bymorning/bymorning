import { Form } from "@bymorning/schema/form"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import type { FormField } from "../src/features/session/ui/form-model"
import { FormView } from "../src/features/session/ui/form-view"
import "../src/main.css"

render(() => {
  const [answers, setAnswers] = createStore<Record<string, Form.Value | undefined>>({
    format: "mcp",
    features: ["audit"],
  })
  const fields: ReadonlyArray<FormField> = [
    { key: "displayName", title: "Display name", type: "string", required: true },
    {
      key: "shortName",
      title: "Short name",
      description: "Use lowercase letters, numbers, and hyphens (1–48 characters).",
      type: "string",
      required: true,
      pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
      placeholder: "for example: customer-api",
    },
    {
      key: "format",
      title: "Deployment mode",
      type: "string",
      required: true,
      custom: true,
      options: [{ value: "mcp", label: "MCP server (Recommended)" }],
    },
    {
      key: "notes",
      title: "Configuration notes with a deliberately long title that must wrap within the request surface",
      description:
        "Describe operational constraints, expected traffic, and any unusual requirements without making the page wider.",
      type: "string",
      multiline: true,
      placeholder: "Add configuration notes",
    },
    {
      key: "guide",
      title: "Review the external deployment guide",
      description: "Confirm the deployment guidance before continuing.",
      type: "external",
      url: "https://example.com/a/very/long/deployment/guide/path/that/must/not/overflow",
    },
    {
      key: "features",
      title: "Optional capabilities with labels that safely wrap on narrow screens",
      type: "multiselect",
      custom: true,
      options: [
        {
          value: "audit",
          label: "Audit history with a particularly long option label for narrow viewport coverage",
          description: "Retain diagnostic events for later review by the operations team.",
        },
      ],
    },
    {
      key: "retention",
      title: "Retention details",
      type: "string",
      when: [{ key: "features", op: "eq", value: "audit" }],
      placeholder: "For example: 30 days",
    },
  ]

  return (
    <>
      <FormView
        item={{
          id: Form.ID.create("frm_responsive"),
          title: "Add an external server",
          fields,
          sections: [{ fields }],
          choicePresentation: "select",
          canGoBack: false,
          submitLabel: "Submit",
        }}
        answers={answers}
        set={(key, value) => setAnswers(key, value)}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
      <FormView
        item={{
          id: Form.ID.create("frm_compact"),
          title: "Quick choice",
          fields: [{ key: "name", title: "Display name", type: "string", placeholder: "Preview service" }],
          sections: [{ fields: [{ key: "name", title: "Display name", type: "string", placeholder: "Preview service" }] }],
          choicePresentation: "select",
          canGoBack: false,
          submitLabel: "Submit",
        }}
        answers={{}}
        set={() => undefined}
        pendingAction={undefined}
        error={undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    </>
  )
}, document.getElementById("root")!)
