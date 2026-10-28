CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."support_category" AS ENUM('idea', 'bug', 'question', 'other');--> statement-breakpoint
CREATE TABLE "link_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(32) NOT NULL,
	"title" varchar(64) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "link_tags_slug_uq" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "lobby_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lobby_id" uuid NOT NULL,
	"inviter_id" uuid NOT NULL,
	"invitee_id" uuid NOT NULL,
	"by_host" boolean NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "lobby_invites_answered_chk" CHECK (("lobby_invites"."status" = 'pending') = ("lobby_invites"."answered_at" is null)),
	CONSTRAINT "lobby_invites_self_chk" CHECK ("lobby_invites"."inviter_id" <> "lobby_invites"."invitee_id")
);
--> statement-breakpoint
CREATE TABLE "support_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"category" "support_category" NOT NULL,
	"text" varchar(2000) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"reply" varchar(1000),
	"replied_at" timestamp with time zone,
	"replied_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "support_requests_reply_chk" CHECK (("support_requests"."reply" is null) = ("support_requests"."replied_at" is null)),
	CONSTRAINT "support_requests_closed_chk" CHECK ("support_requests"."reply" is null or "support_requests"."closed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "user_activity_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "user_activity_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "user_arrivals" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"referrer_id" uuid,
	"tag_id" integer,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_arrivals_one_source_chk" CHECK ("user_arrivals"."referrer_id" is null or "user_arrivals"."tag_id" is null)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_chk";--> statement-breakpoint
ALTER TABLE "lobby_members" ADD COLUMN "invite_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "invite_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "support_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_code" varchar(12) DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hide_from_search" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invites_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "link_tags" ADD CONSTRAINT "link_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_invites" ADD CONSTRAINT "lobby_invites_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_invites" ADD CONSTRAINT "lobby_invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_invites" ADD CONSTRAINT "lobby_invites_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_replied_by_users_id_fk" FOREIGN KEY ("replied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity_days" ADD CONSTRAINT "user_activity_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_arrivals" ADD CONSTRAINT "user_arrivals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_arrivals" ADD CONSTRAINT "user_arrivals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_arrivals" ADD CONSTRAINT "user_arrivals_tag_id_link_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."link_tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lobby_invites_lobby_invitee_uq" ON "lobby_invites" USING btree ("lobby_id","invitee_id");--> statement-breakpoint
CREATE INDEX "lobby_invites_inviter_created_idx" ON "lobby_invites" USING btree ("inviter_id","created_at");--> statement-breakpoint
CREATE INDEX "lobby_invites_invitee_idx" ON "lobby_invites" USING btree ("invitee_id","created_at");--> statement-breakpoint
CREATE INDEX "support_requests_author_created_idx" ON "support_requests" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "support_requests_open_idx" ON "support_requests" USING btree ("created_at") WHERE "support_requests"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "user_activity_days_day_idx" ON "user_activity_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "user_arrivals_tag_idx" ON "user_arrivals" USING btree ("tag_id");--> statement-breakpoint
ALTER TABLE "lobby_members" ADD CONSTRAINT "lobby_members_invite_id_lobby_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."lobby_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_invite_id_lobby_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."lobby_invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_support_id_support_requests_id_fk" FOREIGN KEY ("support_id") REFERENCES "public"."support_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_kind_idx" ON "notifications" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_public_code_uq" ON "users" USING btree ("public_code");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_chk" CHECK ("notifications"."lobby_id" is not null or "notifications"."case_id" is not null or "notifications"."support_id" is not null);