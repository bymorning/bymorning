import { cleanup, render, screen, within } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it } from "vitest"

import { RequestLog, RequestLogIdentity, RequestLogTable } from "./request-log"

afterEach(cleanup)

it("renders the shared empty status when the log has no rows", () => {
  render(() => (
    <RequestLog
      loading={false}
      ready
      empty
      emptyLabel="No requests"
      canGoPrevious={false}
      canGoNext={false}
      onPrevious={() => undefined}
      onNext={() => undefined}
    />
  ))

  const status = screen.getByRole("status", { name: "No requests" })
  expect(status).toHaveAttribute("data-component", "empty")
  expect(status).toHaveAttribute("data-variant", "panel")
  expect(status).toHaveTextContent("No requests")
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
})

it("truncates identity cells while keeping the full value on title", () => {
  render(() => (
    <RequestLog
      loading={false}
      ready
      empty={false}
      emptyLabel="No requests"
      canGoPrevious={false}
      canGoNext={false}
      onPrevious={() => undefined}
      onNext={() => undefined}
    >
      <RequestLogTable>
        <tbody>
          <tr>
            <RequestLogIdentity title="workspace.very.long.tool.name">workspace.very.long.tool.name</RequestLogIdentity>
          </tr>
        </tbody>
      </RequestLogTable>
    </RequestLog>
  ))

  const table = screen.getByRole("table", { name: "Request log" })
  const identity = within(table).getByRole("rowheader")
  expect(screen.queryByRole("button", { name: "Prev" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument()
  expect(identity).toHaveAttribute("data-slot", "request-log-identity")
  expect(within(identity).getByTitle("workspace.very.long.tool.name")).toHaveAttribute(
    "data-slot",
    "request-log-identity-label",
  )
  expect(identity).toHaveTextContent("workspace.very.long.tool.name")
})

it("paginates a ready log and hides the table while loading", async () => {
  const previous: Array<true> = []
  const next: Array<true> = []
  render(() => (
    <RequestLog
      loading={false}
      ready
      empty={false}
      emptyLabel="No requests"
      canGoPrevious
      canGoNext
      onPrevious={() => previous.push(true)}
      onNext={() => next.push(true)}
    >
      <RequestLogTable>
        <tbody>
          <tr>
            <RequestLogIdentity title="read">read</RequestLogIdentity>
          </tr>
        </tbody>
      </RequestLogTable>
    </RequestLog>
  ))

  await userEvent.click(screen.getByRole("button", { name: "Prev" }))
  await userEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(previous).toEqual([true])
  expect(next).toEqual([true])
})
