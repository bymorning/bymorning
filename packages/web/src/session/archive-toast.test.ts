import { afterEach, expect, it, vi } from "vitest"

import type { BmUiI18n } from "../ui/context/i18n"

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }))
vi.mock("../ui/components/toast", () => ({ showToast }))
vi.mock("../ui/components/confirm-dialog", () => ({ ConfirmDialog: (props: unknown) => props }))

import { showArchived } from "./archive-toast"

const i18n = { t: (key: string) => key } as unknown as BmUiI18n
const session: Parameters<typeof showArchived>[0]["session"] = { title: "Plan" }

afterEach(() => showToast.mockReset())

it("keeps the Undo toast up long enough to act on", () => {
  showArchived({ i18n, session, undo: async () => undefined })
  expect(showToast.mock.calls[0]?.[0].duration).toBeGreaterThanOrEqual(10_000)
})

it("runs Undo and reports a failure even when it throws before returning a promise", async () => {
  showArchived({
    i18n,
    session,
    undo: () => {
      throw new Error("stale")
    },
  })
  const action = showToast.mock.calls[0]?.[0].actions[0]
  action.onClick()
  await Promise.resolve()
  await Promise.resolve()
  expect(showToast).toHaveBeenLastCalledWith({ variant: "error", title: "ui.session.unarchiveError" })
})

it("asks first, then archives, offers Undo, and leaves only while the user is still on the Session", async () => {
  const { archiveSession } = await import("./archive-toast")
  const id = "ses_1" as never
  for (const viewing of [true, false]) {
    const update = vi.fn(async () => ({ title: "Plan" }) as never)
    const leave = vi.fn()
    let element: (() => unknown) | undefined
    let close: (() => void) | undefined
    const dialog = {
      show: (next: () => never, onClose?: () => void) => {
        element = next
        close = onClose
      },
    }
    const done = archiveSession({
      i18n,
      dialog,
      session: { title: "Plan" },
      sessionID: id,
      update,
      viewing: () => viewing,
      leave,
    })
    const confirm = element?.() as {
      title: string
      description: string
      confirmLabel: string
      onConfirm: () => Promise<void>
    }
    expect(confirm.title).toBe("Archive session?")
    expect(confirm.description).toContain("“Plan” will be hidden from session lists")
    expect(confirm.confirmLabel).toBe("Archive session")
    expect(update).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
    await confirm.onConfirm()
    close?.()
    expect(await done).toBe(true)
    expect(update).toHaveBeenCalledWith({ sessionID: id, archived: true })
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(leave).toHaveBeenCalledTimes(viewing ? 1 : 0)
    showToast.mockReset()
  }
})

it("does nothing when the confirmation is dismissed", async () => {
  const { archiveSession } = await import("./archive-toast")
  const update = vi.fn()
  let close: (() => void) | undefined
  const dialog = { show: (_: () => never, onClose?: () => void) => void (close = onClose) }
  const done = archiveSession({
    i18n,
    dialog,
    sessionID: "ses_1" as never,
    update,
    viewing: () => true,
    leave: vi.fn(),
  })
  close?.()
  expect(await done).toBe(false)
  expect(update).not.toHaveBeenCalled()
  expect(showToast).not.toHaveBeenCalled()
})
