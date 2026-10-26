CREATE TYPE "public"."creation_block_kind" AS ENUM('late_cancel', 'moderation');--> statement-breakpoint
CREATE TYPE "public"."moderation_action" AS ENUM('auto_shadow_ban', 'shadow_ban', 'lift_shadow_ban', 'block_creation', 'unblock_creation', 'karma_change', 'cancel_lobby', 'grant_moderator', 'revoke_moderator', 'resolve_case');--> statement-breakpoint
CREATE TYPE "public"."moderation_case_kind" AS ENUM('reports', 'not_held', 'appeal');--> statement-breakpoint
CREATE TYPE "public"."moderation_decision" AS ENUM('reports_dismissed', 'reports_confirmed', 'meetup_held', 'host_flaked', 'appeal_approved', 'appeal_rejected');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('promo', 'scam', 'abuse', 'other');--> statement-breakpoint
ALTER TYPE "public"."karma_reason" ADD VALUE 'moderation';--> statement-breakpoint
ALTER TYPE "public"."karma_reason" ADD VALUE 'appeal_refund';--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"subject_id" uuid,
	"lobby_id" uuid,
	"case_id" uuid,
	"action" "moderation_action" NOT NULL,
	"karma_delta" integer,
	"comment" varchar(500),
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "moderation_case_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"lobby_id" uuid,
	"appeal_text" varchar(1000),
	"shadow_banned_at" timestamp with time zone,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"decision" "moderation_decision",
	"decision_comment" varchar(500),
	CONSTRAINT "moderation_cases_resolved_chk" CHECK (("moderation_cases"."resolved_at" is null) = ("moderation_cases"."decision" is null)),
	CONSTRAINT "moderation_cases_appeal_chk" CHECK (("moderation_cases"."kind" = 'appeal') = ("moderation_cases"."appeal_text" is not null)),
	CONSTRAINT "moderation_cases_decision_chk" CHECK ("moderation_cases"."decision" is null or ("moderation_cases"."kind" = 'reports' and "moderation_cases"."decision" in ('reports_confirmed','reports_dismissed')) or ("moderation_cases"."kind" = 'not_held' and "moderation_cases"."decision" in ('meetup_held','host_flaked')) or ("moderation_cases"."kind" = 'appeal' and "moderation_cases"."decision" in ('appeal_approved','appeal_rejected')))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"lobby_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"comment" varchar(300),
	"not_counted" varchar(20),
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "lobby_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creation_blocked_reason" "creation_block_kind";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creation_blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creation_blocked_lobby_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_moderator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_actions_subject_idx" ON "moderation_actions" USING btree ("subject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_cases_open_subject_uq" ON "moderation_cases" USING btree ("kind","subject_id") WHERE "moderation_cases"."resolved_at" is null and "moderation_cases"."kind" <> 'not_held';--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_cases_open_lobby_uq" ON "moderation_cases" USING btree ("lobby_id") WHERE "moderation_cases"."resolved_at" is null and "moderation_cases"."kind" = 'not_held';--> statement-breakpoint
CREATE INDEX "moderation_cases_queue_idx" ON "moderation_cases" USING btree ("opened_at") WHERE "moderation_cases"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "moderation_cases_subject_idx" ON "moderation_cases" USING btree ("subject_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_reporter_lobby_uq" ON "reports" USING btree ("reporter_id","lobby_id");--> statement-breakpoint
CREATE INDEX "reports_case_idx" ON "reports" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "reports_subject_idx" ON "reports" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "reports_reporter_created_idx" ON "reports" USING btree ("reporter_id","created_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_creation_blocked_lobby_id_lobbies_id_fk" FOREIGN KEY ("creation_blocked_lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_chk" CHECK ("notifications"."lobby_id" is not null or "notifications"."case_id" is not null);--> statement-breakpoint
-- Blocks from stage 3 are all late cancels: date and lobby from the host's latest late-cancel penalty.
UPDATE "users" SET
  "creation_blocked_reason" = 'late_cancel',
  "creation_blocked_at" = coalesce(
    (SELECT max("created_at") FROM "karma_events" WHERE "user_id" = "users"."id" AND "reason" = 'host_late_cancel'),
    now()),
  "creation_blocked_lobby_id" = (
    SELECT "lobby_id" FROM "karma_events" WHERE "user_id" = "users"."id" AND "reason" = 'host_late_cancel'
    ORDER BY "created_at" DESC, "id" DESC LIMIT 1)
WHERE "lobby_creation_blocked";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_creation_block_chk" CHECK ("users"."lobby_creation_blocked" = ("users"."creation_blocked_reason" is not null) and ("users"."creation_blocked_reason" is null) = ("users"."creation_blocked_at" is null));