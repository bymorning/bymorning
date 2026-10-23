UPDATE "session" SET "agent" = 'default' WHERE "agent" = 'build';
--> statement-breakpoint
DELETE FROM "agent" WHERE "id" = 'build';
