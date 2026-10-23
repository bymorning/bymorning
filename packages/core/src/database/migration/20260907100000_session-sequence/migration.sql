ALTER TABLE "session" ADD COLUMN "sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "session" AS session_row
SET "sequence" = COALESCE(
  (
    SELECT MAX(candidate."sequence")
    FROM (
      SELECT event_sequence."sequence"
      FROM "event_sequence"
      WHERE event_sequence."workspace_id" = session_row."workspace_id"
        AND event_sequence."aggregate_id" = session_row."id"::text
      UNION ALL
      SELECT event."sequence"
      FROM "event"
      WHERE event."workspace_id" = session_row."workspace_id"
        AND event."aggregate_id" = session_row."id"::text
      UNION ALL
      SELECT session_message."sequence"
      FROM "session_message"
      WHERE session_message."session_id" = session_row."id"
      UNION ALL
      SELECT session_inbox."admitted_sequence"
      FROM "session_inbox"
      WHERE session_inbox."session_id" = session_row."id"
      UNION ALL
      SELECT session_instruction."through_sequence"
      FROM "session_instruction"
      WHERE session_instruction."session_id" = session_row."id"
    ) AS candidate
    WHERE candidate."sequence" BETWEEN 0 AND 9007199254740991
  ),
  0
);--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_sequence_check" CHECK ("sequence" >= 0 and "sequence" <= 9007199254740991);--> statement-breakpoint
DROP TABLE "event_sequence";--> statement-breakpoint
DROP TABLE "event";
