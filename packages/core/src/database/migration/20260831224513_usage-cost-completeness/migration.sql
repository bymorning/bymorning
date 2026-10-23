ALTER TABLE "session" ADD COLUMN "usage_cost_complete" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "cost_complete" boolean DEFAULT true NOT NULL;
-- Rollback: drop usage.cost_complete, then session.usage_cost_complete. This discards completeness metadata only.
