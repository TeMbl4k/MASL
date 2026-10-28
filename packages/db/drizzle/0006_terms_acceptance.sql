ALTER TABLE "users" ADD COLUMN "terms_version" smallint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_terms_chk" CHECK (("users"."terms_version" is null) = ("users"."terms_accepted_at" is null));