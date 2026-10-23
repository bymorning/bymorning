CREATE TABLE "usage" (
	"id" uuid PRIMARY KEY,
	"workspace_id" varchar(30) NOT NULL,
	"user_id" varchar(30) NOT NULL,
	"session_id" uuid NOT NULL,
	"model" text NOT NULL,
	"input" bigint NOT NULL,
	"output" bigint NOT NULL,
	"reasoning" bigint NOT NULL,
	"cache_read" bigint NOT NULL,
	"cache_write" bigint NOT NULL,
	"cost" numeric(30,15) NOT NULL,
	"occurred_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "usage_model_nonempty_check" CHECK (length("model") > 0),
	CONSTRAINT "usage_nonnegative_check" CHECK ("input" >= 0 and "output" >= 0 and "reasoning" >= 0 and "cache_read" >= 0 and "cache_write" >= 0 and "cost" >= 0)
);
--> statement-breakpoint
CREATE INDEX "usage_workspace_occurred_idx" ON "usage" ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_workspace_user_occurred_idx" ON "usage" ("workspace_id","user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_workspace_model_occurred_idx" ON "usage" ("workspace_id","model","occurred_at");--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_user_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "user"("workspace_id","id") ON DELETE RESTRICT;
--> statement-breakpoint
INSERT INTO "usage" (
	"id", "workspace_id", "user_id", "session_id", "model", "input", "output", "reasoning", "cache_read", "cache_write", "cost", "occurred_at"
)
SELECT
	e."id",
	e."workspace_id",
	s."user_id",
	s."id",
	m."data"->'model'->>'id',
	(e."data"->'usage'->'tokens'->>'input')::bigint,
	(e."data"->'usage'->'tokens'->>'output')::bigint,
	(e."data"->'usage'->'tokens'->>'reasoning')::bigint,
	(e."data"->'usage'->'tokens'->'cache'->>'read')::bigint,
	(e."data"->'usage'->'tokens'->'cache'->>'write')::bigint,
	(e."data"->'usage'->>'cost')::numeric(30,15),
	e."created_at"
FROM "event" e
INNER JOIN "session" s
	ON s."workspace_id" = e."workspace_id" AND s."id"::text = e."aggregate_id"
INNER JOIN "session_message" m
	ON m."session_id" = s."id" AND m."id"::text = e."data"->>'messageID' AND m."type" = 'assistant'
WHERE e."type" = 'session.step.ended' AND e."version" = 1;
