ALTER TABLE "credential" ADD COLUMN "purpose" text DEFAULT 'connection' NOT NULL;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "user_id" varchar(30);--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "method_id" text;--> statement-breakpoint
DROP INDEX "credential_one_active";--> statement-breakpoint
CREATE UNIQUE INDEX "credential_one_active" ON "credential" ("workspace_id","integration_id") WHERE "active" = true and "user_id" is null and "purpose" = 'connection';--> statement-breakpoint
CREATE UNIQUE INDEX "credential_member_active" ON "credential" ("workspace_id","integration_id","user_id") WHERE "active" = true and "user_id" is not null and "purpose" = 'connection';--> statement-breakpoint
CREATE UNIQUE INDEX "credential_client" ON "credential" ("workspace_id","integration_id","method_id") WHERE "purpose" = 'client';--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_member_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "user"("workspace_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_purpose_check" CHECK (("purpose" = 'connection' and "method_id" is null) or ("purpose" = 'client' and "user_id" is null and "method_id" is not null and "active" is null));
--> statement-breakpoint
INSERT INTO "credential" ("id", "workspace_id", "integration_id", "purpose", "method_id", "label", "value_json", "time_created", "time_updated", "time_deleted")
SELECT 'cred_' || md5(jsonb_build_array("workspace_id", "integration_id", "method_id")::text), "workspace_id", "integration_id", 'client', "method_id", 'OAuth client', "value_json", "time_created", "time_updated", "time_deleted"
FROM "integration_oauth_client_configuration";
--> statement-breakpoint
DROP TABLE "integration_oauth_client_configuration";
