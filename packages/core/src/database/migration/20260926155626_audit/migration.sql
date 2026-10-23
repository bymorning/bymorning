CREATE TABLE "audit_entry" (
	"id" varchar(40) PRIMARY KEY,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_entry_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp(3) with time zone NOT NULL,
	"actor" jsonb NOT NULL,
	"account_id" varchar(30),
	"workspace_id" varchar(30),
	"action" text NOT NULL,
	"target" text,
	"detail" jsonb,
	"outcome" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"chain" text NOT NULL,
	CONSTRAINT "audit_entry_outcome_check" CHECK ("outcome" in ('success', 'failure'))
);
--> statement-breakpoint
CREATE INDEX "audit_entry_workspace_sequence" ON "audit_entry" ("workspace_id","sequence");--> statement-breakpoint
CREATE INDEX "audit_entry_account_sequence" ON "audit_entry" ("account_id","sequence");--> statement-breakpoint
CREATE INDEX "audit_entry_occurred_at" ON "audit_entry" ("occurred_at");