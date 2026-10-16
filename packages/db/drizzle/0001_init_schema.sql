CREATE TYPE "public"."gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."karma_reason" AS ENUM('attended', 'late_cancel', 'no_show', 'host_late_cancel', 'manual');--> statement-breakpoint
CREATE TYPE "public"."lobby_category" AS ENUM('sport', 'boardgames', 'bars', 'food', 'networking', 'videogames', 'cinema', 'music', 'walks', 'culture', 'other');--> statement-breakpoint
CREATE TYPE "public"."lobby_status" AS ENUM('open', 'active', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'attended', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."payment_format" AS ENUM('free', 'split');--> statement-breakpoint
CREATE TABLE "interests" (
	"slug" varchar(32) PRIMARY KEY NOT NULL,
	"title" varchar(64) NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "karma_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"lobby_id" uuid,
	"reason" "karma_reason" NOT NULL,
	"delta" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lobbies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"category" "lobby_category" NOT NULL,
	"title" varchar(80) NOT NULL,
	"description" varchar(1000),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" geography(Point, 4326) NOT NULL,
	"address" text NOT NULL,
	"place_hint" varchar(128) NOT NULL,
	"slots" smallint NOT NULL,
	"min_karma" smallint,
	"payment_format" "payment_format" DEFAULT 'free' NOT NULL,
	"status" "lobby_status" DEFAULT 'open' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lobbies_time_order_chk" CHECK ("lobbies"."ends_at" > "lobbies"."starts_at"),
	CONSTRAINT "lobbies_slots_chk" CHECK ("lobbies"."slots" between 1 and 50),
	CONSTRAINT "lobbies_min_karma_chk" CHECK ("lobbies"."min_karma" is null or "lobbies"."min_karma" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lobby_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lobby_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'pending' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_interests" (
	"user_id" uuid NOT NULL,
	"interest_slug" varchar(32) NOT NULL,
	CONSTRAINT "user_interests_user_id_interest_slug_pk" PRIMARY KEY("user_id","interest_slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"first_name" varchar(128) NOT NULL,
	"last_name" varchar(128),
	"username" varchar(64),
	"photo_url" text,
	"language_code" varchar(16),
	"allows_write_to_pm" boolean DEFAULT false NOT NULL,
	"telegram_auth_date" timestamp with time zone NOT NULL,
	"gender" "gender",
	"birth_year" smallint,
	"karma" integer DEFAULT 50 NOT NULL,
	"is_shadow_banned" boolean DEFAULT false NOT NULL,
	"lobby_creation_blocked" boolean DEFAULT false NOT NULL,
	"onboarded_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "karma_events" ADD CONSTRAINT "karma_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "karma_events" ADD CONSTRAINT "karma_events_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_members" ADD CONSTRAINT "lobby_members_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_members" ADD CONSTRAINT "lobby_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_interest_slug_interests_slug_fk" FOREIGN KEY ("interest_slug") REFERENCES "public"."interests"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "karma_events_user_idx" ON "karma_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "karma_events_once_per_lobby_uq" ON "karma_events" USING btree ("user_id","lobby_id","reason") WHERE "karma_events"."lobby_id" is not null;--> statement-breakpoint
CREATE INDEX "lobbies_location_gist" ON "lobbies" USING gist ("location");--> statement-breakpoint
CREATE INDEX "lobbies_status_starts_at_idx" ON "lobbies" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "lobbies_host_id_idx" ON "lobbies" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lobby_members_lobby_user_uq" ON "lobby_members" USING btree ("lobby_id","user_id");--> statement-breakpoint
CREATE INDEX "lobby_members_user_status_idx" ON "lobby_members" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "lobby_members_lobby_status_idx" ON "lobby_members" USING btree ("lobby_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_uq" ON "users" USING btree ("telegram_id");