import { Effect, Formatter, Logger, type LogLevel } from "effect"
import os from "node:os"
import path from "node:path"
import { runID } from "./shared.js"

function formatter(id: string = runID) {
  return Logger.map(Logger.formatStructured, (output) => {
    const messages = Array.isArray(output.message) ? output.message : [output.message]
    return [
      ["timestamp", output.timestamp],
      ["level", output.level],
      ["run", id],
      ...messages.flatMap((value) => (plain(value) ? flatten(value) : [["message", value] as const])),
      ...(output.cause === undefined ? [] : [["cause", output.cause] as const]),
      ...flatten(output.spans),
      ...flatten(output.annotations),
    ]
      .map(([key, value]) => `${key}=${format(value)}`)
      .join(" ")
  })
}

function flatten(
  input: Record<string, unknown>,
  prefix = "",
  seen = new WeakSet<object>(),
): Array<readonly [string, unknown]> {
  if (seen.has(input)) return [[prefix, "[Circular]"]]
  seen.add(input)
  const entries = Object.entries(input)
  if (entries.length === 0 && prefix) return [[prefix, input]]
  return entries.flatMap(([key, value]) => {
    const entryPath = prefix ? `${prefix}.${key}` : key
    return plain(value) ? flatten(value, entryPath, seen) : [[entryPath, value] as const]
  })
}

function plain(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}

function format(input: unknown) {
  const value = typeof input === "string" ? input : Formatter.format(input)
  return /^[^\s="\\]+$/.test(value) ? value : JSON.stringify(value)
}

function dataDirectory() {
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
}

/** Return the local structured log file for one deployment channel. */
export function file(local = true, channel = "local") {
  const directory = path.join(dataDirectory(), "bymorning", "log")
  if (!local) return path.join(directory, "bymorning.log")
  return path.join(directory, `bymorning-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.log`)
}

/** Build an append-only structured file logger. */
export function fileLogger(target = file(), id: string = runID) {
  // A zero batch window causes high idle CPU usage in the Effect file logger.
  return Logger.toFile(formatter(id), target, { flag: "a" })
}

const stderrLogger = Logger.make((options) => {
  process.stderr.write(formatter().log(options) + "\n")
})

/**
 * Write one structured JSON line directly to stderr, bypassing the configured
 * log format, and report a write failure as a log error. Audit export and
 * retention summaries use this so container log pipelines always receive one
 * machine-parseable record per line, even when application logs go to a file.
 */
export function writeLine(record: Record<string, unknown>): Effect.Effect<void> {
  return Effect.suspend(() => {
    try {
      process.stderr.write(JSON.stringify(record) + "\n")
      return Effect.void
    } catch (cause) {
      return Effect.logError("Failed to write structured stderr line", cause)
    }
  })
}

/** Resolve the minimum application log level from the process environment. */
export function minimumLogLevel() {
  const value = process.env.BYMORNING_LOG_LEVEL?.toUpperCase()
  if (value === "DEBUG") return "Debug" satisfies LogLevel.LogLevel
  if (value === "WARN") return "Warn" satisfies LogLevel.LogLevel
  if (value === "ERROR") return "Error" satisfies LogLevel.LogLevel
  return "Info" satisfies LogLevel.LogLevel
}

/** Build the structured logger set for one runtime output. */
export function loggers(output: "file" | "stderr" = "stderr", channel = "local") {
  if (output === "stderr") return [Effect.succeed(stderrLogger)]
  return [fileLogger(file(channel === "local", channel))]
}
