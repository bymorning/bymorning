import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

type GenerateResult = {
  readonly status?: unknown
  readonly statements?: readonly unknown[]
}

export const parseGenerateResult = (output: string): GenerateResult => {
  const result: unknown = JSON.parse(output)
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Drizzle generate returned an invalid JSON result")
  }
  return result
}

export const runCheck = async (command: readonly string[]): Promise<void> => {
  const [executable, ...args] = command
  if (executable === undefined) throw new Error("A Drizzle generate command is required")

  const child = spawn(executable, args, { stdio: ["inherit", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk))
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk))

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 1))
  })

  if (stderr.length > 0) process.stderr.write(stderr)
  if (exitCode !== 0) {
    if (stdout.length > 0) process.stdout.write(stdout)
    throw new Error(`Drizzle generate exited with code ${exitCode}`)
  }

  const result = parseGenerateResult(stdout)
  const statementCount = Array.isArray(result.statements) ? result.statements.length : 0
  if (result.status !== "no_changes" || statementCount > 0) {
    const count = statementCount > 0 ? ` (${statementCount} statement(s))` : ""
    process.stderr.write(`${stdout.trim()}\n`)
    throw new Error(`Database schema changes are not represented by the latest migration${count}`)
  }

  process.stdout.write("Database schema matches the latest migration.\n")
}

const defaultCommand = ["drizzle-kit", "generate", "--name", "check", "--explain", "--output", "json"]

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCheck(process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultCommand).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
