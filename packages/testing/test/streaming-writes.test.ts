import { Database } from "@bymorning/core/database"
import { Session } from "@bymorning/core/session"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { expect, test } from "vitest"
import { TestApp } from "../src/application.js"
import { Chat } from "../src/scenario/chat.js"

const tokens = 2_000

/** Count every row rewrite of `session_message` with a trigger; statistics views lag and are not exact. */
const countWrites = (app: TestApp.Interface) =>
  app
    .process(
      Database.Service.use((database) =>
        database.use("StreamingWrites.install", (db) =>
          Effect.gen(function* () {
            yield* db.execute(sql`create table session_message_write (message_id uuid not null, type text not null)`)
            yield* db.execute(sql`
              create function session_message_count_write() returns trigger language plpgsql as $$
              begin
                insert into session_message_write (message_id, type) values (new.id, new.type);
                return new;
              end $$
            `)
            yield* db.execute(sql`
              create trigger session_message_count_write after update on session_message
              for each row execute function session_message_count_write()
            `)
          }),
        ),
      ),
    )
    .pipe(Effect.orDie)

type Write = {
  readonly message_id: string
  readonly type: string
  readonly writes: string
}

const writes = (app: TestApp.Interface) =>
  app
    .process(
      Database.Service.use((database) =>
        database.use("StreamingWrites.read", (db) =>
          db.execute<Write>(
            sql`select message_id, type, count(*)::text as writes from session_message_write group by message_id, type order by writes desc`,
          ),
        ),
      ),
    )
    .pipe(
      Effect.orDie,
      // The raw query result carries its rows under `rows` at runtime despite the array type.
      Effect.map((result): ReadonlyArray<Write> =>
        Array.isArray(result) ? result : (result as unknown as { readonly rows: ReadonlyArray<Write> }).rows,
      ),
    )

test(`a ${tokens}-token stream coalesces assistant row writes while publishing every delta`, async ({ signal }) => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* TestApp.make()
        const data = yield* Chat.make(app)
        yield* countWrites(app)
        const prompt = "Write a long essay"
        yield* app.llm.expect(data.session.id, "title", [
          {
            expect: (request) => assert.ok(JSON.stringify(request.messages).includes(prompt)),
            response: { type: "success", events: [{ text: "Long essay" }] },
          },
        ])
        yield* app.llm.expect(data.session.id, "assistant", [
          {
            expect: (request) => assert.ok(JSON.stringify(request.messages).includes(prompt)),
            response: {
              type: "success",
              events: Array.from({ length: tokens }, (_, index) => ({ text: `token${index} ` })),
              usage: { input: 10, output: tokens },
            },
          },
        ])
        const started = Date.now()
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.prompt({ sessionID: data.session.id, text: prompt })),
        )
        yield* app.workspace(
          { account: data.account },
          Session.Service.use((sessions) => sessions.awaitIdle(data.session.id)),
        )
        const elapsed = Date.now() - started
        yield* app.llm.settled(data.session.id, "title")
        const messages = yield* Effect.tryPromise(() => app.client.message.list({ sessionID: data.session.id }))
        const assistant = messages.data.find((message) => message.type === "assistant")
        assert.ok(assistant?.type === "assistant")
        const text = assistant.content.find((part) => part.type === "text")
        assert.ok(text?.type === "text")
        expect(text.text).toBe(Array.from({ length: tokens }, (_, index) => `token${index} `).join(""))
        expect(assistant.time.completed).toBeDefined()
        const rows = yield* writes(app)
        const assistantWrites = Number(rows.find((row) => row.message_id === assistant.id)?.writes ?? 0)
        console.info(
          `[streaming-writes] ${tokens} deltas streamed in ${elapsed}ms: ${assistantWrites} UPDATEs of the assistant row, ${rows.map((row) => `${row.type}=${row.writes}`).join(" ")}`,
        )
        // Before coalescing every delta rewrote the row (>= tokens). The coalesced recorder
        // writes once per part boundary plus at most one window flush per ~250 ms.
        expect(assistantWrites).toBeLessThan(tokens / 10)
      }),
    ),
    { signal },
  )
})
