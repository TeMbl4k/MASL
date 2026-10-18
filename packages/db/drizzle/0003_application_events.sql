CREATE TABLE "application_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"lobby_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "lobby_members_user_applied_idx";--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_events_user_created_idx" ON "application_events" USING btree ("user_id","created_at");--> statement-breakpoint
-- Applies already in the rolling window keep counting towards the daily cap.
INSERT INTO "application_events" ("user_id", "lobby_id", "created_at")
SELECT "user_id", "lobby_id", "applied_at" FROM "lobby_members" WHERE "applied_at" > now() - interval '24 hours';
