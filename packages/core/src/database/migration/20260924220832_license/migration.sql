CREATE TABLE "installation_license" (
	"id" text PRIMARY KEY,
	"trial_started_at" timestamp(3) with time zone NOT NULL,
	"kind" text DEFAULT 'trial' NOT NULL,
	"licensee" text,
	"artifact" text,
	"issued_at" timestamp(3) with time zone,
	"expires_at" timestamp(3) with time zone,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone,
	CONSTRAINT "installation_license_singleton" CHECK ("id" = 'installation'),
	CONSTRAINT "installation_license_kind_check" CHECK ("kind" in ('trial', 'full'))
);
