CREATE TYPE "public"."feedback_rating" AS ENUM('good', 'bad', 'not_held');--> statement-breakpoint
ALTER TYPE "public"."karma_reason" ADD VALUE 'hosted';--> statement-breakpoint
CREATE TABLE "lobby_chat_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"lobby_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lobby_feedback" (
	"lobby_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" "feedback_rating" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lobby_feedback_lobby_id_user_id_pk" PRIMARY KEY("lobby_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"chat_id" bigint,
	"lobby_id" uuid NOT NULL,
	"member_id" uuid,
	"kind" varchar(40) NOT NULL,
	"dedupe_key" varchar(120),
	"send_after" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error_code" smallint,
	"telegram_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_target_chk" CHECK (("notifications"."user_id" is null) <> ("notifications"."chat_id" is null))
);
--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "chat_id" bigint;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "chat_title" varchar(128);--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "chat_invite_link" text;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "chat_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "chat_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "quorum_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "ended_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "attendance_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "attendance_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "attendance_saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "attendance_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lobby_members" ADD COLUMN "chat_joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lobby_members" ADD COLUMN "attendance_absent_draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lobby_chat_requests" ADD CONSTRAINT "lobby_chat_requests_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_chat_requests" ADD CONSTRAINT "lobby_chat_requests_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_feedback" ADD CONSTRAINT "lobby_feedback_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobby_feedback" ADD CONSTRAINT "lobby_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_lobby_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."lobby_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("send_after") WHERE "notifications"."sent_at" is null and "notifications"."failed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_pending_dedupe_uq" ON "notifications" USING btree ("dedupe_key") WHERE "notifications"."sent_at" is null and "notifications"."failed_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_lobby_kind_idx" ON "notifications" USING btree ("lobby_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "lobbies_active_chat_uq" ON "lobbies" USING btree ("chat_id") WHERE "lobbies"."chat_id" is not null and "lobbies"."chat_closed_at" is null;--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_chat_consistency_chk" CHECK (("lobbies"."chat_id" is null) = ("lobbies"."chat_linked_at" is null));--> statement-breakpoint
-- Lobbies that ended or were cancelled before the bot existed: nothing about them is asked or sent.
UPDATE "lobbies" SET "quorum_checked_at" = now(), "ended_notified_at" = now(), "attendance_requested_at" = now(), "attendance_reminded_at" = now(), "attendance_closed_at" = now()
WHERE "status" = 'cancelled' OR "ends_at" <= now();
