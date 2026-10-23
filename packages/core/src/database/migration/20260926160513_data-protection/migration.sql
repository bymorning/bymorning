CREATE TABLE "project_purge" (
	"id" varchar(40) PRIMARY KEY,
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30),
	"prefix" text NOT NULL,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "oauth_access_hash" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "oauth_refresh_hash" text;--> statement-breakpoint
CREATE INDEX "project_purge_created_idx" ON "project_purge" ("time_created","id");