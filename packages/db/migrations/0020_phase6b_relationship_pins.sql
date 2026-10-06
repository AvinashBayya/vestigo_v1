-- Phase 6b: a relationship can be pinned to a case, like evidence, an entity or a claim.
ALTER TABLE "case_pins" DROP CONSTRAINT "case_pins_one_target";--> statement-breakpoint
ALTER TABLE "case_pins" ADD COLUMN "relationship_id" uuid;--> statement-breakpoint
-- NOT VALID: relationship_id was added above, so every existing row holds null
-- and satisfies the key; validating would only scan case_pins under lock.
ALTER TABLE "case_pins" ADD CONSTRAINT "case_pins_relationship_fk" FOREIGN KEY ("tenant_id","relationship_id") REFERENCES "public"."entity_relationships"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE UNIQUE INDEX "case_pins_relationship_key" ON "case_pins" USING btree ("tenant_id","case_id","relationship_id") WHERE "case_pins"."relationship_id" is not null;--> statement-breakpoint
-- NOT VALID: every existing row passed the old check (exactly one of three
-- targets) and holds a null relationship_id, so it passes this one. The check
-- is enforced for every row written from here on.
ALTER TABLE "case_pins" ADD CONSTRAINT "case_pins_one_target" CHECK (num_nonnulls("case_pins"."evidence_id", "case_pins"."entity_id", "case_pins"."claim_id", "case_pins"."relationship_id") = 1) NOT VALID;
