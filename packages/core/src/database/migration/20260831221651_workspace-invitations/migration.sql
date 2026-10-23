ALTER TABLE "user" ADD COLUMN "email" varchar(254);--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_email" ON "user" ("workspace_id","email");
