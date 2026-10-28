CREATE TYPE "public"."achievement" AS ENUM('first_meetup', 'regular', 'local', 'no_skips', 'explorer', 'versatile', 'sociable', 'first_hosted', 'organizer', 'full_house', 'brought_friend', 'ambassador');--> statement-breakpoint
CREATE TABLE "broadcast_unsubscribes" (
	"broadcast_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "broadcast_unsubscribes_broadcast_id_user_id_pk" PRIMARY KEY("broadcast_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid,
	"text" varchar(1000) NOT NULL,
	"interests" varchar(32)[],
	"lobby_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"achievement" "achievement" NOT NULL,
	"earned_at" timestamp with time zone NOT NULL,
	"silent" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "user_achievements_user_id_achievement_pk" PRIMARY KEY("user_id","achievement")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_chk";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "tag_id" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "broadcast_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "news_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast_unsubscribes" ADD CONSTRAINT "broadcast_unsubscribes_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_unsubscribes" ADD CONSTRAINT "broadcast_unsubscribes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_lobby_id_lobbies_id_fk" FOREIGN KEY ("lobby_id") REFERENCES "public"."lobbies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tag_id_link_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."link_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_broadcast_idx" ON "notifications" USING btree ("broadcast_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_chk" CHECK ("notifications"."lobby_id" is not null or "notifications"."case_id" is not null or "notifications"."support_id" is not null or "notifications"."tag_id" is not null or "notifications"."broadcast_id" is not null or ("notifications"."user_id" is not null and "notifications"."kind" in ('user_achievements','user_qr_print')));