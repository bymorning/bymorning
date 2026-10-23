import { expect, test } from "@playwright/test"
import { readFile, rename, writeFile } from "node:fs/promises"

const workspaceID = process.env.HOT_RELOAD_WORKSPACE_ID
const pluginPath = process.env.HOT_RELOAD_PLUGIN_PATH
const serverPID = Number(process.env.HOT_RELOAD_SERVER_PID)
const authCookie = process.env.HOT_RELOAD_AUTH_COOKIE
const webURL = process.env.HOT_RELOAD_WEB_URL ?? "http://localhost:3000"

test("updates plugin inventory and integration in the same Gateway process", async ({ context, page }) => {
  test.setTimeout(60_000)
  test.skip(
    workspaceID === undefined ||
      pluginPath === undefined ||
      !Number.isSafeInteger(serverPID) ||
      authCookie === undefined,
    "Run through script/verify-plugin-hot-reload.sh with authenticated localhost environment",
  )

  await context.addCookies(
    authCookie!.split(/;\s*/).map((pair) => {
      const separator = pair.indexOf("=")
      return {
        name: pair.slice(0, separator),
        value: pair.slice(separator + 1),
        url: `https://${new URL(webURL).hostname}`,
        secure: true,
        httpOnly: true,
        sameSite: "Lax" as const,
      }
    }),
  )
  await page.goto(`/w/${workspaceID}`)
  await expect(page).toHaveURL(new URL(`/w/${workspaceID}`, webURL).href)

  await page.keyboard.press("Control+k")
  await page.getByPlaceholder("Search commands").fill("Connect integration")
  await page.getByRole("option", { name: /Connect integration/ }).click()
  const integrations = page.getByRole("dialog", { name: "Connect an integration" })
  await expect(integrations).toContainText(`Hot Reload v1 | pid ${serverPID}`)

  const navigations: string[] = []
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url())
  })
  const source = await readFile(pluginPath!, "utf8")
  expect(source).toContain('const revision = "v1"')
  const replacement = `${pluginPath}.next`
  await writeFile(replacement, source.replace('const revision = "v1"', 'const revision = "v2"'))
  await rename(replacement, pluginPath!)

  await expect(integrations).toContainText(`Hot Reload v2 | pid ${serverPID}`, { timeout: 30_000 })
  await expect(integrations).not.toContainText("Hot Reload v1")
  expect(navigations).toEqual([])
  process.kill(serverPID, 0)
})
