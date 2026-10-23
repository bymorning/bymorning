import { Money } from "@bymorning/schema/money"
import { Schema } from "effect"
import { expect, test } from "vitest"

test("USD amounts retain exact decimal string encoding", () => {
  const amount = Schema.decodeUnknownSync(Money.USDPerMillionTokens)("1.25")

  expect(amount).toBe(Money.USDPerMillionTokens.make("1.25"))
  expect(Money.USD.zero).toBe("0")
  expect(Money.USDPerMillionTokens.zero).toBe("0")
})

test("USD amounts reject numbers and negative decimals", () => {
  expect(() => Schema.decodeUnknownSync(Money.USD)(1.25)).toThrow()
  expect(() => Schema.decodeUnknownSync(Money.USD)("-1.25")).toThrow()
})
