import { Schema } from "effect"

/** Canonical Message identifier schema. */
export const MessageID = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("Message.ID"))

/** Canonical Session identifier schema. */
export const SessionID = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("Session.ID"))

const length = 26
const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const timeLength = 12
const randomLength = length - timeLength
const unbiasedByteLimit = Math.floor(256 / chars.length) * chars.length
let lastTimestamp = 0
let counter = 0

/**
 * Creates a process-local ascending identifier suffix using Web Crypto entropy.
 *
 * Web Crypto is shared by the supported browser, worker, Bun, and Node 22+
 * runtimes, so generation needs no runtime-specific crypto adapter.
 */
export function ascending() {
  return create(Date.now())
}

function create(timestamp: number) {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    counter = 0
  }
  counter++

  const value = BigInt(timestamp) * 0x1000n + BigInt(counter)
  const time = Array.from({ length: timeLength / 2 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("")
  let random = ""

  while (random.length < randomLength) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(randomLength - random.length))
    for (const byte of bytes) {
      if (byte < unbiasedByteLimit) random += chars.charAt(byte % chars.length)
    }
  }

  return time + random
}
