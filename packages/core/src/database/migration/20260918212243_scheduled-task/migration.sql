CREATE TABLE "scheduled_task" (
	"workspace_id" varchar(30),
	"id" varchar(30),
	"user_id" varchar(30) NOT NULL,
	"project_id" varchar(30) NOT NULL,
	"name" varchar(120) NOT NULL,
	"prompt" text NOT NULL,
	"cron" varchar(120) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"model" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp(3) with time zone,
	"last_run_at" timestamp(3) with time zone,
	"last_session_id" uuid,
	"last_note" text,
	"missed_at" timestamp(3) with time zone,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_task_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "scheduled_task_id" varchar(30);--> statement-breakpoint
CREATE INDEX "scheduled_task_user_idx" ON "scheduled_task" ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "scheduled_task_due_idx" ON "scheduled_task" ("enabled","next_run_at");--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD CONSTRAINT "scheduled_task_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD CONSTRAINT "scheduled_task_user_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "user"("workspace_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD CONSTRAINT "scheduled_task_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "project"("workspace_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_scheduled_task_fk" FOREIGN KEY ("workspace_id","scheduled_task_id") REFERENCES "scheduled_task"("workspace_id","id") ON DELETE RESTRICT;