CREATE TABLE "auth_provider" (
	"id" varchar(30) PRIMARY KEY,
	"revision" integer NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"kind" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"domains" jsonb NOT NULL,
	"status" text NOT NULL,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone,
	CONSTRAINT "auth_provider_kind_check" CHECK ("kind" in ('google', 'okta', 'microsoft', 'auth0', 'ping', 'custom')),
	CONSTRAINT "auth_provider_status_check" CHECK ("status" in ('enabled', 'disabled')),
	CONSTRAINT "auth_provider_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "installation_setup" (
	"id" text PRIMARY KEY,
	"token" text NOT NULL,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone,
	CONSTRAINT "installation_setup_singleton" CHECK ("id" = 'installation')
);
--> statement-breakpoint
CREATE TABLE "kv" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "email" varchar(254);--> statement-breakpoint
CREATE UNIQUE INDEX "installation_setup_id_unique" ON "installation_setup" ("id");