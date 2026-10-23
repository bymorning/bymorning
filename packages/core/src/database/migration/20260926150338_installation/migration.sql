CREATE TABLE "installation_admin" (
	"account_id" varchar(30) PRIMARY KEY,
	"granted_by" varchar(30),
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation" (
	"id" text PRIMARY KEY,
	"policy" jsonb DEFAULT '{}' NOT NULL,
	"bootstrap_pending" boolean DEFAULT true NOT NULL,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_singleton" CHECK ("id" = 'installation')
);
--> statement-breakpoint
ALTER TABLE "installation_admin" ADD CONSTRAINT "installation_admin_account_fk" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;;
--> statement-breakpoint
-- Existing-install migration: the earliest active Workspace administrator's
-- Account becomes the first Installation Admin, and bootstrap is disarmed.
-- Fresh installations have no admin rows, so bootstrap stays armed for the
-- first login after Setup.
INSERT INTO "installation" ("id") VALUES ('installation') ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "installation_admin" ("account_id")
SELECT u."account_id"
FROM "user" u
INNER JOIN "account" a ON a."id" = u."account_id"
WHERE u."role" = 'admin'
  AND u."account_id" IS NOT NULL
  AND u."time_deleted" IS NULL
  AND a."status" = 'active'
  AND a."time_deleted" IS NULL
ORDER BY u."time_created" ASC, u."id" ASC
LIMIT 1
ON CONFLICT ("account_id") DO NOTHING;
--> statement-breakpoint
UPDATE "installation" SET "bootstrap_pending" = false
WHERE EXISTS (SELECT 1 FROM "installation_admin");
