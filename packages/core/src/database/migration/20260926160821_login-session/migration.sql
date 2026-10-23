CREATE TABLE "login_session" (
	"id" varchar(30) PRIMARY KEY,
	"account_id" varchar(30) NOT NULL,
	"time_expires" timestamp(3) with time zone NOT NULL,
	"time_idle_expires" timestamp(3) with time zone NOT NULL,
	"time_touched" timestamp(3) with time zone NOT NULL,
	"time_revoked" timestamp(3) with time zone,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone
);
--> statement-breakpoint
ALTER TABLE "oauth_grant" ADD COLUMN "superseded_refresh_hash" text;--> statement-breakpoint
ALTER TABLE "oauth_grant" ADD COLUMN "time_refresh_expires" timestamp(3) with time zone;--> statement-breakpoint
-- Existing grants predate refresh expiry; their lifetime runs from creation.
UPDATE "oauth_grant" SET "time_refresh_expires" = "time_created" + interval '30 days';--> statement-breakpoint
ALTER TABLE "oauth_grant" ALTER COLUMN "time_refresh_expires" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "login_session_account_idx" ON "login_session" ("account_id");--> statement-breakpoint
CREATE INDEX "oauth_grant_account_idx" ON "oauth_grant" ("account_id");--> statement-breakpoint
ALTER TABLE "login_session" ADD CONSTRAINT "login_session_account_fk" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;