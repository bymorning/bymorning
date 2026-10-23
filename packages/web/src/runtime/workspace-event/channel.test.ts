import { describe, expect, it, vi } from "vitest"

import { createSingleConsumerJournal } from "./channel"

describe("createSingleConsumerJournal", () => {
  it("retains a boundary and events before registration, then passes through", async () => {
    const owner = new AbortController()
    const journal = createSingleConsumerJournal<number>({ capacity: 2, reconnect: vi.fn(), owner: owner.signal })
    journal.begin(1)
    journal.send(2)
    const consumer = new AbortController()
    const iterator = journal.read(consumer.signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 })
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 })
    const live = iterator.next()
    journal.send(3)
    await expect(live).resolves.toEqual({ done: false, value: 3 })
    consumer.abort()
  })

  it("registers synchronously and permits only one consumer", () => {
    const journal = createSingleConsumerJournal<number>({
      capacity: 2,
      reconnect: vi.fn(),
      owner: new AbortController().signal,
    })
    journal.read(new AbortController().signal)
    expect(() => journal.read(new AbortController().signal)).toThrow("Session synchronization consumer already active")
  })

  it("accepts exactly capacity detached events before invalidating and reconnecting once", async () => {
    const reconnect = vi.fn()
    const journal = createSingleConsumerJournal<number>({
      capacity: 2,
      reconnect,
      owner: new AbortController().signal,
    })
    journal.begin(1)
    journal.send(2)
    journal.send(3)
    expect(reconnect).not.toHaveBeenCalled()
    journal.send(4)
    expect(reconnect).toHaveBeenCalledOnce()
    journal.send(5)
    expect(reconnect).toHaveBeenCalledOnce()

    const consumer = new AbortController()
    const iterator = journal.read(consumer.signal)[Symbol.asyncIterator]()
    const next = iterator.next()
    journal.begin(6)
    journal.send(7)
    await expect(next).resolves.toEqual({ done: false, value: 6 })
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 7 })
    consumer.abort()
  })

  it("reconnects on detach but not owner close", async () => {
    const reconnect = vi.fn()
    const owner = new AbortController()
    const journal = createSingleConsumerJournal<number>({ capacity: 2, reconnect, owner: owner.signal })
    journal.begin(1)
    const consumer = new AbortController()
    const iterator = journal.read(consumer.signal)[Symbol.asyncIterator]()
    await iterator.next()
    consumer.abort()
    expect(reconnect).toHaveBeenCalledOnce()

    const replacement = new AbortController()
    const next = journal.read(replacement.signal)[Symbol.asyncIterator]().next()
    journal.begin(2)
    await expect(next).resolves.toEqual({ done: false, value: 2 })
    owner.abort()
    expect(reconnect).toHaveBeenCalledOnce()
  })

  it("releases ownership and reconnects when returned before the first next", async () => {
    const reconnect = vi.fn()
    const journal = createSingleConsumerJournal<number>({
      capacity: 2,
      reconnect,
      owner: new AbortController().signal,
    })
    journal.begin(1)
    const iterator = journal.read(new AbortController().signal)[Symbol.asyncIterator]()

    await iterator.return?.()

    expect(reconnect).toHaveBeenCalledOnce()
    const replacement = journal.read(new AbortController().signal)[Symbol.asyncIterator]()
    const next = replacement.next()
    journal.begin(2)
    await expect(next).resolves.toEqual({ done: false, value: 2 })
  })

  it("delivers only a higher generation after detach", async () => {
    const reconnect = vi.fn()
    const journal = createSingleConsumerJournal<number>({
      capacity: 2,
      reconnect,
      owner: new AbortController().signal,
    })
    journal.begin(1)
    journal.send(10)
    const first = journal.read(new AbortController().signal)[Symbol.asyncIterator]()
    await expect(first.next()).resolves.toEqual({ done: false, value: 1 })
    await first.return?.()

    journal.send(11)
    const replacement = journal.read(new AbortController().signal)[Symbol.asyncIterator]()
    const next = replacement.next()
    journal.begin(2)
    journal.send(20)

    await expect(next).resolves.toEqual({ done: false, value: 2 })
    await expect(replacement.next()).resolves.toEqual({ done: false, value: 20 })
    expect(reconnect).toHaveBeenCalledOnce()
  })

  it("accepts exactly capacity attached events before invalidating and resuming at a new boundary", async () => {
    const reconnect = vi.fn()
    const journal = createSingleConsumerJournal<number>({
      capacity: 2,
      reconnect,
      owner: new AbortController().signal,
    })
    const iterator = journal.read(new AbortController().signal)[Symbol.asyncIterator]()
    journal.begin(1)
    journal.send(10)
    journal.send(11)
    expect(reconnect).not.toHaveBeenCalled()
    journal.send(12)

    expect(reconnect).toHaveBeenCalledOnce()
    const next = iterator.next()
    journal.send(13)
    journal.begin(2)
    journal.send(20)
    await expect(next).resolves.toEqual({ done: false, value: 2 })
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 20 })
  })

  it("applies attached capacity after delivering the boundary to a waiter", async () => {
    const reconnect = vi.fn()
    const journal = createSingleConsumerJournal<number>({
      capacity: 2,
      reconnect,
      owner: new AbortController().signal,
    })
    const consumer = new AbortController()
    const iterator = journal.read(consumer.signal)[Symbol.asyncIterator]()
    const boundary = iterator.next()
    journal.begin(1)
    await expect(boundary).resolves.toEqual({ done: false, value: 1 })

    journal.send(10)
    journal.send(11)
    expect(reconnect).not.toHaveBeenCalled()
    journal.send(12)
    expect(reconnect).toHaveBeenCalledOnce()
    consumer.abort()
  })

  it("closes an attached waiter without reconnecting", async () => {
    const reconnect = vi.fn()
    const owner = new AbortController()
    const journal = createSingleConsumerJournal<number>({ capacity: 2, reconnect, owner: owner.signal })
    journal.begin(1)
    const iterator = journal.read(new AbortController().signal)[Symbol.asyncIterator]()
    await iterator.next()
    const next = iterator.next()

    owner.abort()

    await expect(next).resolves.toEqual({ done: true, value: undefined })
    expect(reconnect).not.toHaveBeenCalled()
  })
})
