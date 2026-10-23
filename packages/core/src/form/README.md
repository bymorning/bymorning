# Session Forms

Session Forms request structured input while work is running in a persisted
Session. A Form belongs to one Session and remains pending until one reply or
cancellation settles it.

Forms are ephemeral. `Form.Service` keeps them in the Workspace process, not in
the database or a durable Event log. `list` returns pending Forms only. `get`
and `state` retain settled Forms for 10 minutes. A restart loses every Form;
graceful layer shutdown cancels pending Forms to release in-process waiters.
Never use a Form as durable workflow state or invent a global, sentinel, or
synthetic Session ID.

See the [full Session Forms guide](../../../docs/src/06-developer-reference/06-session-forms.mdx)
for the complete field and event reference.

## Use `Form.Service` from Effect code

Use `ask` when the same Effect should create a Form and wait for settlement.
Treat cancellation as an expected result.

```ts
import { Form } from "@bymorning/core/form"
import { Session } from "@bymorning/schema/session"
import { Effect } from "effect"

export const requestDeployment = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const forms = yield* Form.Service
    const state = yield* forms.ask({
      sessionID,
      title: "Configure deployment",
      fields: [
        {
          key: "environment",
          type: "string",
          required: true,
          options: [
            { value: "staging", label: "Staging" },
            { value: "production", label: "Production" },
          ],
        },
        {
          key: "region",
          type: "string",
          required: true,
          when: [{ key: "environment", op: "eq", value: "production" }],
        },
      ],
    })

    if (state.status === "cancelled") return state
    return { status: "ready" as const, answer: state.answer }
  })
```

`ask` cancels its Form when the waiting fiber is interrupted. Use the other
service methods when creation and settlement happen in separate code paths:

```ts
forms.create(input) // Effect<Form.Info, AlreadyExistsError | InvalidFormError>
forms.list({ sessionID }) // Effect<readonly Form.Info[]>
forms.get(formID) // Effect<Form.Info, NotFoundError>
forms.state(formID) // Effect<Form.State, NotFoundError>
forms.reply({ id: formID, answer }) // Effect<void, ...>
forms.cancel(formID) // Effect<void, ...>
```

`create` and `ask` accept `{ sessionID, title, metadata?, fields, id? }`. Omit
`id` to generate a `frm_` ID. The Core service trusts its caller to supply the
ID of a real persisted Session; the public Session endpoints enforce ownership.
`reply` and `cancel` fail with `Form.AlreadySettledError` after settlement.

Permission is a separate capability. If an operation needs authorization and
values, assert Permission first and then ask the Form:

```ts
import { Form } from "@bymorning/core/form"
import { Permission } from "@bymorning/core/permission"
import { Session } from "@bymorning/schema/session"
import { Effect } from "effect"

const configure = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const permissions = yield* Permission.Service
    const forms = yield* Form.Service

    yield* permissions.assert({
      sessionID,
      action: "deploy.configure",
      resources: ["production"],
    })

    return yield* forms.ask({
      sessionID,
      title: "Configure deployment",
      fields: [{ key: "region", type: "string", required: true }],
    })
  })
```

Do not use Form metadata as authorization.

## Use the Promise client

HTTP has no `ask` operation. Create a pending Form and settle it later with the
generated `@bymorning/client` methods:

```ts
import { ByMorning, type FormListInput } from "@bymorning/client"

export async function requestRegion(baseUrl: string, sessionID: FormListInput["sessionID"]) {
  const client = ByMorning.make({ baseUrl })
  const form = await client.form.create({
    sessionID,
    title: "Choose a region",
    fields: [
      {
        key: "region",
        type: "string",
        required: true,
        options: [
          { value: "us-east-1", label: "US East" },
          { value: "eu-west-1", label: "EU West" },
        ],
      },
    ],
  })

  await client.form.reply({
    sessionID,
    formID: form.id,
    answer: { region: "us-east-1" },
  })

  return client.form.state({ sessionID, formID: form.id })
}
```

The complete generated surface is:

```ts
client.form.request.list({ workspace }) // all pending Forms in a Workspace
client.form.list({ sessionID })
client.form.create({ sessionID, title, fields }) // `id` and `metadata` are optional
client.form.get({ sessionID, formID })
client.form.state({ sessionID, formID })
client.form.reply({ sessionID, formID, answer })
client.form.cancel({ sessionID, formID })
```

The Session endpoints return not found when the path Session does not own the
Form. Creating a Form also requires an existing persisted Session.

## Define safe fields

- Use `string`, `number`, `integer`, `boolean`, `multiselect`, or `external`.
  Every Form needs at least one field and every key must be unique.
- Defaults initialize the built-in UI only. The server does not merge defaults
  into replies, so submit every value that should be present.
- Set `secret: true` only on a string field. Secret fields cannot have defaults.
  Presentation is masked, but transport, ephemeral reply events, and retained
  in-memory state are not redacted. Never put secrets in defaults or metadata.
- Put `when` only on non-external fields and reference an earlier non-external
  field. All conditions must match. Inactive fields are neither required nor
  answerable.
- An `external` field is always an acknowledgement. Its answer must be literal
  `true`; it has no `required`, `when`, or `default` option.
- String options and multiselect options are closed unless `custom: true`.

The server validates definitions at creation and answers at reply time. An
invalid reply leaves the Form pending for correction.

## Reconcile events after reconnecting

The central `GET /api/event` stream carries volatile `form.created`,
`form.replied`, and `form.cancelled` Events. Its first item is
`server.connected`; it does not replay Events or provide a Session stream.

Subscribe first, wait for `server.connected`, then call
`client.form.list({ sessionID })` and buffer matching Form Events while that
read is in flight. Apply the list and then the buffered Events: add a created
Form and remove it after reply or cancellation. Repeat after every reconnect.
Do not let an older list response overwrite newer live changes.

## Choose Forms for pending Session input

The built-in `question` Tool requests Permission first, converts its prompts to
custom string or multiselect fields, and waits with `Form.Service.ask`. It
returns `answers: string[][]` to the model. Cancelling the Form follows the
declined-tool path.

Future internal consumers should use `Form.Service` only for asynchronous input
owned by a running persisted Session. Keep Integration authentication on its
synchronous `Form.Fields` discovery and `Form.Answer` connect flow; it does not
create a Session Form. Web search and MCP do not currently consume Session
Forms.
