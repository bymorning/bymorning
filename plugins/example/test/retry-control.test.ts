import { describe, expect, test } from "vitest"
import plugin from "../src/retry-control.js"

type Retry = { attempt: number; decision: { retry: false } | { retry: true; delay: number } }
type Hook = (event: Retry) => void | Promise<void>

async function register(options: Readonly<Record<string, unknown>>) {
  // This local example unit fixture captures the registered callback; it is
  // intentionally not an application-coverage substitute.
  let callback: Hook | undefined
  await plugin.setup({
    options,
    session: {
      hook: async (name: string, handler: Hook) => {
        expect(name).toBe("retry")
        callback = handler
        return { dispose: async () => undefined }
      },
    },
  } as unknown as Parameters<typeof plugin.setup>[0])
  if (callback === undefined) throw new Error("Retry hook was not registered")
  return callback
}

describe("retry-control example", () => {
  test("counts the first retry as attempt 2", async () => {
    const hook = await register({ maxRetries: 1, minDelay: 0 })
    const first: Retry = { attempt: 2, decision: { retry: true, delay: 100 } }
    const second: Retry = { attempt: 3, decision: { retry: true, delay: 100 } }

    await hook(first)
    await hook(second)

    expect(first.decision).toEqual({ retry: true, delay: 100 })
    expect(second.decision).toEqual({ retry: false })
  })

  test("vetoes all retries when maxRetries is zero", async () => {
    const hook = await register({ maxRetries: 0, minDelay: 0 })
    const retry: Retry = { attempt: 2, decision: { retry: true, delay: 100 } }

    await hook(retry)

    expect(retry.decision).toEqual({ retry: false })
  })

  test("allows attempts 2 and 3 but rejects attempt 4 when maxRetries is two", async () => {
    const hook = await register({ maxRetries: 2, minDelay: 0 })
    const retries: Retry[] = [2, 3, 4].map((attempt) => ({ attempt, decision: { retry: true, delay: 100 } }))

    for (const retry of retries) await hook(retry)

    expect(retries.map((retry) => retry.decision)).toEqual([
      { retry: true, delay: 100 },
      { retry: true, delay: 100 },
      { retry: false },
    ])
  })

  test("preserves a prior veto and never shortens a delay", async () => {
    const hook = await register({ maxRetries: 2, minDelay: 1000 })
    const veto: Retry = { attempt: 2, decision: { retry: false } }
    const long: Retry = { attempt: 2, decision: { retry: true, delay: 2000 } }
    const short: Retry = { attempt: 2, decision: { retry: true, delay: 100 } }

    await hook(veto)
    await hook(long)
    await hook(short)

    expect(veto.decision).toEqual({ retry: false })
    expect(long.decision).toEqual({ retry: true, delay: 2000 })
    expect(short.decision).toEqual({ retry: true, delay: 1000 })
  })

  test.each([
    [{ minDelay: 0 }, "maxRetries"],
    [{ maxRetries: -1, minDelay: 0 }, "maxRetries"],
    [{ maxRetries: 1.5, minDelay: 0 }, "maxRetries"],
    [{ maxRetries: 1, minDelay: -1 }, "minDelay"],
    [{ maxRetries: 1, minDelay: 1.5 }, "minDelay"],
  ])("rejects invalid options %#", async (options, key) => {
    await expect(register(options)).rejects.toThrow(key)
  })
})
