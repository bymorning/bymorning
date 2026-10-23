ALTER TABLE "user" DROP CONSTRAINT "user_role_check";
--> statement-breakpoint
UPDATE "user" SET "role" = 'admin' WHERE "role" = 'owner';
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_check" CHECK ("role" in ('admin', 'member'));
