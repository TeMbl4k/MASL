DROP INDEX "lobbies_host_id_idx";--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "metro_station_id" varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "public_location" geography(Point, 4326) NOT NULL;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "far_from_metro" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "cancel_comment" varchar(200);--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "client_request_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE INDEX "lobbies_public_location_gist" ON "lobbies" USING gist ("public_location");--> statement-breakpoint
CREATE UNIQUE INDEX "lobbies_host_request_uq" ON "lobbies" USING btree ("host_id","client_request_id");--> statement-breakpoint
CREATE INDEX "lobbies_host_created_at_idx" ON "lobbies" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "lobby_members_user_applied_idx" ON "lobby_members" USING btree ("user_id","applied_at");--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_min_karma_max_chk" CHECK ("lobbies"."min_karma" is null or "lobbies"."min_karma" <= 100);--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_cancel_consistency_chk" CHECK (("lobbies"."status" = 'cancelled') = ("lobbies"."cancelled_at" is not null));--> statement-breakpoint
ALTER TABLE "lobby_members" ADD CONSTRAINT "lobby_members_decided_chk" CHECK ("lobby_members"."status" in ('pending','cancelled') or "lobby_members"."decided_at" is not null);--> statement-breakpoint
ALTER TABLE "lobby_members" ADD CONSTRAINT "lobby_members_cancel_consistency_chk" CHECK (("lobby_members"."status" = 'cancelled') = ("lobby_members"."cancelled_at" is not null));