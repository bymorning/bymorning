import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { Message, SessionID } from "@bymorning/client/solid"
import { SessionProvider, SessionTimeline } from "../../src/index.js"
import type { SessionUI } from "../../src/model.js"
import "../../src/styles.css"

const message = (sessionID: SessionID, key: string, sequence: number): Extract<Message, { type: "user" }> => ({
  id: `browser-${key}` as Message["id"],
  sessionID,
  sequence,
  createdAt: new Date(sequence),
  type: "user",
  text: key.replace(":", " "),
  admittedSequence: sequence,
})
const virtual = new URL(location.href).searchParams.get("virtual") === "1"

const timeline = (sessionID: SessionID, prefix: string): readonly SessionUI.Row[] =>
  Array.from({ length: 1_000 }, (_, index) => {
    const key = `${prefix}:${index}`
    return { type: "message", key, message: message(sessionID, key, index) }
  })

function Harness() {
  const [sessionID, setSessionID] = createSignal("browser-session" as SessionID)
  const [rows, setRows] = createSignal(timeline(sessionID(), "row"))

  const prepend = () => {
    const session = sessionID()
    const earlier = Array.from({ length: 10 }, (_, index) => {
      const key = `earlier:${index}`
      return { type: "message" as const, key, message: message(session, key, index - 10) }
    })
    setRows((current) => [...earlier, ...current])
  }
  const append = () => {
    const session = sessionID()
    const index = rows().length
    const key = `incoming:${index}`
    setRows((current) => [...current, { type: "message", key, message: message(session, key, index) }])
  }
  const changeSession = () => {
    const next = "browser-session-next" as SessionID
    setSessionID(next)
    setRows(timeline(next, "next"))
  }

  return (
    <SessionProvider>
      <button type="button" aria-label="Prepend rows" onClick={prepend}>
        Prepend
      </button>
      <button type="button" aria-label="Append row" onClick={append}>
        Append
      </button>
      <button type="button" aria-label="Change session" onClick={changeSession}>
        Change session
      </button>
      <SessionTimeline
        sessionID={sessionID}
        rows={rows}
        loading={() => false}
        error={() => undefined}
        virtual={virtual}
      />
    </SessionProvider>
  )
}

render(() => <Harness />, document.getElementById("root")!)
