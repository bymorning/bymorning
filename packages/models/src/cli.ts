import { descriptors } from "./descriptors.js"
import { sync, type SyncOptions } from "./sync.js"

const usage =
  "usage: sync --source live|cache|path [--path file] [--provider id] [--icons] [--update-pin] [--approve-body-sha256 digest] [--approve-icon-commit commit --approve-icon-sha256 source=digest ...] [--observed-on YYYY-MM-DD] [--dry-run] [--check]"

async function main(args: ReadonlyArray<string>) {
  if (args[0] !== "sync") throw new Error(usage)
  const valued = new Set([
    "--source",
    "--path",
    "--provider",
    "--approve-body-sha256",
    "--approve-icon-commit",
    "--approve-icon-sha256",
    "--observed-on",
  ])
  const switches = new Set(["--icons", "--update-pin", "--dry-run", "--check"])
  const seen = new Set<string>()
  for (let index = 1; index < args.length; index++) {
    const argument = args[index]!
    if (seen.has(argument) && argument !== "--approve-icon-sha256") throw new Error(usage)
    seen.add(argument)
    if (switches.has(argument)) continue
    if (!valued.has(argument) || args[index + 1] === undefined || args[index + 1]!.startsWith("--"))
      throw new Error(usage)
    index++
  }
  const value = (name: string) => {
    const index = args.indexOf(name)
    return index < 0 ? undefined : args[index + 1]
  }
  const source = value("--source")
  if (source !== "live" && source !== "cache" && source !== "path") throw new Error(usage)
  const sourcePath = value("--path")
  if (source === "path" && sourcePath === undefined) throw new Error(usage)
  const provider = value("--provider")
  if (provider !== undefined && !descriptors.some((descriptor) => descriptor.localID === provider)) {
    throw new Error(usage)
  }
  const approveBody = value("--approve-body-sha256")
  if (approveBody !== undefined && !/^[a-f0-9]{64}$/.test(approveBody)) throw new Error(usage)
  const observedOn = value("--observed-on")
  if (observedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(observedOn)) throw new Error(usage)
  const approveIconCommit = value("--approve-icon-commit")
  if (approveIconCommit !== undefined && !/^[a-f0-9]{40}$/.test(approveIconCommit)) throw new Error(usage)
  const approveIconDigests = Object.fromEntries(
    args.flatMap((argument, index) => {
      if (argument !== "--approve-icon-sha256") return []
      const match = /^([a-z0-9][a-z0-9.-]*)=([a-f0-9]{64})$/.exec(args[index + 1] ?? "")
      if (match === null) throw new Error(usage)
      return [[match[1]!, match[2]!]]
    }),
  )
  if (
    args.filter((argument) => argument === "--approve-icon-sha256").length !== Object.keys(approveIconDigests).length
  ) {
    throw new Error(usage)
  }
  const options: SyncOptions = {
    source,
    ...(sourcePath === undefined ? {} : { path: sourcePath }),
    ...(provider === undefined ? {} : { provider }),
    icons: args.includes("--icons"),
    updatePin: args.includes("--update-pin"),
    ...(approveBody === undefined ? {} : { approveBody }),
    ...(approveIconCommit === undefined ? {} : { approveIconCommit }),
    approveIconDigests,
    ...(observedOn === undefined ? {} : { observedOn }),
    dryRun: args.includes("--dry-run"),
    check: args.includes("--check"),
  }
  if (options.check && options.dryRun) throw new Error(usage)
  if (options.check && options.updatePin) throw new Error(usage)
  if (options.source === "cache" && (options.approveBody !== undefined || (options.updatePin && !options.icons)))
    throw new Error(usage)
  if (options.approveBody !== undefined && !options.updatePin) throw new Error(usage)
  if (
    (options.approveIconCommit !== undefined || Object.keys(options.approveIconDigests ?? {}).length > 0) &&
    !options.updatePin
  )
    throw new Error(usage)
  await sync(options)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = message === usage ? 2 : 1
})
