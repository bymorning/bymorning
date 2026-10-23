CREATE TABLE "api_key" (
	"id" varchar(30) PRIMARY KEY,
	"workspace_id" varchar(30) NOT NULL,
	"service_account_id" varchar(30) NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"time_expires" timestamp(3) with time zone,
	"time_used" timestamp(3) with time zone,
	"time_revoked" timestamp(3) with time zone,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "service_account" (
	"id" varchar(30),
	"workspace_id" varchar(30),
	"name" text NOT NULL,
	"status" text NOT NULL,
	"policy" jsonb DEFAULT '{}' NOT NULL,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone,
	CONSTRAINT "service_account_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "service_account_status_check" CHECK ("status" in ('active', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "service_account_id" varchar(30);--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "source" text DEFAULT 'session' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "endpoint_id" text;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "upstream_model" text;--> statement-breakpoint
ALTER TABLE "usage" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_hash_unique" ON "api_key" ("hash");--> statement-breakpoint
CREATE INDEX "api_key_workspace_service_account_idx" ON "api_key" ("workspace_id","service_account_id");--> statement-breakpoint
CREATE INDEX "service_account_workspace_deleted_idx" ON "service_account" ("workspace_id","time_deleted");--> statement-breakpoint
CREATE INDEX "usage_workspace_service_account_occurred_idx" ON "usage" ("workspace_id","service_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_workspace_source_occurred_idx" ON "usage" ("workspace_id","source","occurred_at");--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_service_account_fk" FOREIGN KEY ("workspace_id","service_account_id") REFERENCES "service_account"("workspace_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_account" ADD CONSTRAINT "service_account_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_service_account_fk" FOREIGN KEY ("workspace_id","service_account_id") REFERENCES "service_account"("workspace_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_principal_check" CHECK (("user_id" is null) <> ("service_account_id" is null));--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_session_principal_check" CHECK ("session_id" is null or "user_id" is not null);--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_source_check" CHECK ("source" in ('session', 'inference'));