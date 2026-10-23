CREATE TABLE "tool_usage" (
	"id" uuid PRIMARY KEY,
	"workspace_id" varchar(30) NOT NULL,
	"user_id" varchar(30) NOT NULL,
	"session_id" uuid,
	"tool" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "tool_usage_tool_nonempty_check" CHECK (length("tool") > 0),
	CONSTRAINT "tool_usage_status_check" CHECK ("status" in ('completed', 'error'))
);
--> statement-breakpoint
CREATE INDEX "tool_usage_workspace_occurred_idx" ON "tool_usage" ("workspace_id","occurred_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "tool_usage_workspace_user_occurred_idx" ON "tool_usage" ("workspace_id","user_id","occurred_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "tool_usage_workspace_session_occurred_idx" ON "tool_usage" ("workspace_id","session_id","occurred_at" DESC NULLS LAST,"id") WHERE "session_id" is not null;--> statement-breakpoint
ALTER TABLE "tool_usage" ADD CONSTRAINT "tool_usage_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tool_usage" ADD CONSTRAINT "tool_usage_user_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "user"("workspace_id","id") ON DELETE RESTRICT;