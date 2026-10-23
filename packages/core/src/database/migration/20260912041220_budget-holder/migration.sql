CREATE TABLE "budget_charge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"holder" text NOT NULL,
	"amount" numeric(30,15) NOT NULL,
	"occurred_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "budget_charge_amount_check" CHECK ("amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budget_limit" (
	"holder" text PRIMARY KEY,
	"amount" numeric(30,15) NOT NULL,
	"time_updated" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_limit_amount_check" CHECK ("amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX "budget_charge_holder_occurred_idx" ON "budget_charge" ("holder","occurred_at");