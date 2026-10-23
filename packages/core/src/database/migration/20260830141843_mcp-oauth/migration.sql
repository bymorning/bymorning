CREATE TABLE "oauth_authorization" (
	"id" varchar(30) PRIMARY KEY,
	"client_id" varchar(30) NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text,
	"code_challenge" text NOT NULL,
	"status" text NOT NULL,
	"code_hash" text,
	"account_id" varchar(30),
	"user_id" varchar(30),
	"workspace_id" varchar(30),
	"grant_id" varchar(30),
	"time_expires" timestamp(3) with time zone NOT NULL,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone,
	CONSTRAINT "oauth_authorization_status_check" CHECK ("status" in ('pending', 'approved', 'consumed'))
);
--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"id" varchar(30) PRIMARY KEY,
	"name" text,
	"redirect_uris" jsonb NOT NULL,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_grant" (
	"id" varchar(30) PRIMARY KEY,
	"client_id" varchar(30) NOT NULL,
	"account_id" varchar(30) NOT NULL,
	"user_id" varchar(30) NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"access_hash" text NOT NULL,
	"refresh_hash" text NOT NULL,
	"time_access_expires" timestamp(3) with time zone NOT NULL,
	"time_created" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_authorization_code_hash_unique" ON "oauth_authorization" ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grant_access_hash_unique" ON "oauth_grant" ("access_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grant_refresh_hash_unique" ON "oauth_grant" ("refresh_hash");--> statement-breakpoint
ALTER TABLE "oauth_authorization" ADD CONSTRAINT "oauth_authorization_client_fk" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_authorization" ADD CONSTRAINT "oauth_authorization_account_fk" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_authorization" ADD CONSTRAINT "oauth_authorization_user_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "user"("workspace_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_authorization" ADD CONSTRAINT "oauth_authorization_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_grant" ADD CONSTRAINT "oauth_grant_client_fk" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_grant" ADD CONSTRAINT "oauth_grant_account_fk" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_grant" ADD CONSTRAINT "oauth_grant_user_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "user"("workspace_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_grant" ADD CONSTRAINT "oauth_grant_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;