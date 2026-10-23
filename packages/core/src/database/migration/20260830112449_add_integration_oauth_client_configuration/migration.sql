CREATE TABLE "integration_oauth_client_configuration" (
	"workspace_id" varchar(30),
	"integration_id" text,
	"method_id" text,
	"value_json" jsonb NOT NULL,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone,
	CONSTRAINT "integration_oauth_client_configuration_pkey" PRIMARY KEY("workspace_id","integration_id","method_id")
);
--> statement-breakpoint
CREATE INDEX "integration_oauth_client_configuration_workspace_integration" ON "integration_oauth_client_configuration" ("workspace_id","integration_id");--> statement-breakpoint
ALTER TABLE "integration_oauth_client_configuration" ADD CONSTRAINT "integration_oauth_client_configuration_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;