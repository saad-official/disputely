CREATE SCHEMA IF NOT EXISTS "disputely";
--> statement-breakpoint
CREATE TYPE "disputely"."actor" AS ENUM('agent', 'user', 'system', 'cron', 'webhook');--> statement-breakpoint
CREATE TYPE "disputely"."message_channel" AS ENUM('email', 'chat', 'phone', 'sms', 'other');--> statement-breakpoint
CREATE TYPE "disputely"."dispute_reason" AS ENUM('fraudulent', 'product_not_received', 'product_unacceptable', 'subscription_canceled', 'duplicate', 'credit_not_processed', 'unrecognized', 'general', 'other');--> statement-breakpoint
CREATE TYPE "disputely"."dispute_status" AS ENUM('warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'charge_refunded', 'prevented');--> statement-breakpoint
CREATE TYPE "disputely"."email_provider" AS ENUM('outbox', 'resend');--> statement-breakpoint
CREATE TYPE "disputely"."library_kind" AS ENUM('refund_policy', 'cancellation_policy', 'terms', 'product_description', 'shipping_policy', 'disclosure', 'other');--> statement-breakpoint
CREATE TYPE "disputely"."membership_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "disputely"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "disputely"."outbox_status" AS ENUM('queued', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "disputely"."packet_status" AS ENUM('draft', 'ready', 'submitted');--> statement-breakpoint
CREATE TYPE "disputely"."plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "disputely"."reminder_kind" AS ENUM('due_7d', 'due_3d', 'due_1d');--> statement-breakpoint
CREATE TABLE "disputely"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputely"."agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor" "disputely"."actor" NOT NULL,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"input" jsonb,
	"output" jsonb,
	"model" text,
	"prompt_version" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputely"."attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"packet_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"stripe_file_id" text,
	"field" text DEFAULT 'uncategorized_file' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_size_check" CHECK ("disputely"."attachments"."size_bytes" > 0 and "disputely"."attachments"."size_bytes" <= 5242880)
);
--> statement-breakpoint
CREATE TABLE "disputely"."disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"stripe_dispute_id" text NOT NULL,
	"charge_id" text NOT NULL,
	"payment_intent_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" "disputely"."dispute_reason" NOT NULL,
	"stripe_reason" text,
	"status" "disputely"."dispute_status" NOT NULL,
	"due_by" timestamp with time zone,
	"product_line" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"charge" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shipping" jsonb,
	"evidence_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_charge_refundable" boolean DEFAULT false NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"outcome_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_amount_check" CHECK ("disputely"."disputes"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "disputely"."library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "disputely"."library_kind" NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"url" text,
	"product_line" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputely"."memberships" (
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "disputely"."membership_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "disputely"."message_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"dispute_id" uuid,
	"customer_email" text NOT NULL,
	"channel" "disputely"."message_channel" DEFAULT 'email' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"direction" "disputely"."message_direction" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputely"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" "disputely"."plan" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text,
	"current_period_end" timestamp with time zone,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"stripe_restricted_key_ciphertext" text,
	"stripe_account_label" text,
	"stripe_key_connected_at" timestamp with time zone,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"reminder_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "organizations_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "disputely"."outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text,
	"dispute_id" uuid,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"html" text,
	"text" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" "disputely"."email_provider" DEFAULT 'outbox' NOT NULL,
	"provider_message_id" text,
	"delivered_to" text,
	"status" "disputely"."outbox_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputely"."packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"dispute_id" uuid NOT NULL,
	"playbook" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"narrative" text DEFAULT '' NOT NULL,
	"narrative_meta" jsonb,
	"completeness" smallint DEFAULT 0 NOT NULL,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "disputely"."packet_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_snapshot" jsonb,
	"stripe_response" jsonb,
	"pdf" "bytea",
	"pdf_generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packets_dispute_id_unique" UNIQUE("dispute_id"),
	CONSTRAINT "packets_completeness_check" CHECK ("disputely"."packets"."completeness" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "disputely"."reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"dispute_id" uuid NOT NULL,
	"kind" "disputely"."reminder_kind" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputely"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "disputely"."shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"charge_id" text NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"proof_url" text,
	"address_match" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputely"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"business_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "disputely"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disputely"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "disputely"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."agent_events" ADD CONSTRAINT "agent_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "disputely"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."attachments" ADD CONSTRAINT "attachments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "disputely"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."attachments" ADD CONSTRAINT "attachments_packet_id_packets_id_fk" FOREIGN KEY ("packet_id") REFERENCES "disputely"."packets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."disputes" ADD CONSTRAINT "disputes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "disputely"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."library_items" ADD CONSTRAINT "library_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "disputely"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "disputely"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "disputely"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."message_logs" ADD CONSTRAINT "message_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "disputely"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."message_logs" ADD CONSTRAINT "message_logs_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "disputely"."disputes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."outbox" ADD CONSTRAINT "outbox_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "disputely"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."outbox" ADD CONSTRAINT "outbox_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "disputely"."disputes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."packets" ADD CONSTRAINT "packets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "disputely"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."packets" ADD CONSTRAINT "packets_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "disputely"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."reminders" ADD CONSTRAINT "reminders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "disputely"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."reminders" ADD CONSTRAINT "reminders_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "disputely"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "disputely"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputely"."shipments" ADD CONSTRAINT "shipments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "disputely"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "disputely"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_events_org_created_idx" ON "disputely"."agent_events" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_events_entity_idx" ON "disputely"."agent_events" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST) WHERE "disputely"."agent_events"."entity_id" is not null;--> statement-breakpoint
CREATE INDEX "attachments_packet_idx" ON "disputely"."attachments" USING btree ("packet_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_org_idx" ON "disputely"."attachments" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_org_stripe_dispute_key" ON "disputely"."disputes" USING btree ("org_id","stripe_dispute_id");--> statement-breakpoint
CREATE INDEX "disputes_org_status_due_idx" ON "disputely"."disputes" USING btree ("org_id","status","due_by");--> statement-breakpoint
CREATE INDEX "disputes_org_opened_idx" ON "disputely"."disputes" USING btree ("org_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "disputes_org_charge_idx" ON "disputely"."disputes" USING btree ("org_id","charge_id");--> statement-breakpoint
CREATE INDEX "library_items_org_kind_idx" ON "disputely"."library_items" USING btree ("org_id","kind","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "disputely"."memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_logs_org_customer_idx" ON "disputely"."message_logs" USING btree ("org_id","customer_email","occurred_at");--> statement-breakpoint
CREATE INDEX "message_logs_dispute_idx" ON "disputely"."message_logs" USING btree ("dispute_id","occurred_at") WHERE "disputely"."message_logs"."dispute_id" is not null;--> statement-breakpoint
CREATE INDEX "outbox_org_created_idx" ON "disputely"."outbox" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "packets_org_status_idx" ON "disputely"."packets" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_dispute_kind_key" ON "disputely"."reminders" USING btree ("dispute_id","kind");--> statement-breakpoint
CREATE INDEX "reminders_org_sent_idx" ON "disputely"."reminders" USING btree ("org_id","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "disputely"."session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_org_charge_key" ON "disputely"."shipments" USING btree ("org_id","charge_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "disputely"."verification" USING btree ("identifier");