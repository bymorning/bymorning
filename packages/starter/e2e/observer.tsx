/** Test-only public-package consumer; it is never bundled into the starter SPA. */
import { ByMorning } from "@bymorning/client"
import { createConnection, createData, type Data, type SessionID } from "@bymorning/client/solid"
import { createEffect, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import { render } from "solid-js/web"

const query = new URLSearchParams(location.search)
const workspace = query.get("workspace")
const initial = query.get("session")
if (!workspace || !initial) throw new Error("Observer fixture requires workspace and session")

const api = ByMorning.make({
  baseUrl: location.origin,
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
})

function View(props: {
  readonly name: string
  readonly sessionID: Accessor<SessionID>
  readonly data: Data
  readonly state: Accessor<string>
  readonly refresh: () => Promise<void>
}) {
  return (
    <section aria-label={`${props.name} observer`}>
      <h2>{props.name}</h2>
      <button onClick={() => void props.refresh()}>Refresh {props.name}</button>
      <p data-testid={`${props.name}-state`}>{props.state()}</p>
      <For each={props.data.session.message.list(props.sessionID())}>
        {(message) => <p data-testid={`${props.name}-${message.id}`}>{JSON.stringify(message)}</p>}
      </For>
    </section>
  )
}

function Observer() {
  const connection = createConnection({ api, workspace: workspace as never })
  const data = createData({ api: () => api, workspace: workspace as never, event: connection, connection })
  const [sessionID, setSessionID] = createSignal(initial as SessionID)
  const [first, setFirst] = createSignal(true)
  const [state, setState] = createSignal("loading")
  let selected: SessionID | undefined
  let selection = Promise.resolve()
  const synchronize = async (next: SessionID, invalidate = false) => {
    setState("loading")
    if (invalidate) {
      data.session.detail.invalidate(next)
      data.session.message.invalidate(next)
    }
    try {
      await Promise.all([data.session.detail.sync(next), data.session.message.sync(next)])
      setState("ready")
    } catch {
      setState("error")
    }
  }
  createEffect(() => {
    const next = sessionID()
    selection = selection.then(async () => {
      const prior = selected
      selected = next
      if (prior && prior !== next) data.session.evict(prior)
      await synchronize(next)
    })
  })
  onCleanup(() => {
    data.dispose()
    connection.dispose()
  })
  return (
    <>
      <p data-testid="connection">{connection.state().state}</p>
      <label>
        Session{" "}
        <input
          aria-label="Session"
          value={sessionID()}
          onInput={(event) => setSessionID(event.currentTarget.value as SessionID)}
        />
      </label>
      <button onClick={() => setFirst(false)}>Dispose first</button>
      <Show when={first()}>
        <View
          name="first"
          sessionID={sessionID}
          data={data}
          state={state}
          refresh={() => synchronize(sessionID(), true)}
        />
      </Show>
      <View
        name="second"
        sessionID={sessionID}
        data={data}
        state={state}
        refresh={() => synchronize(sessionID(), true)}
      />
    </>
  )
}

render(() => <Observer />, document.getElementById("root")!)
