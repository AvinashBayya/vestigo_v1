-- Contract step. Roles, permission grants and memberships moved to the identity
-- provider's member table plus the role-to-permission catalogue in @repo/core
-- (Phase 2B). No deployed code reads these tables. Dropped without CASCADE, in
-- dependency order, so an unexpected dependent object fails the migration
-- instead of being removed silently.
DROP TABLE "memberships";--> statement-breakpoint
DROP TABLE "permissions";--> statement-breakpoint
DROP TABLE "roles";
