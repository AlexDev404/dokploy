ALTER TABLE "sso_provider" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "webServerSettings" ADD COLUMN "whitelabelLogoUrl" text;--> statement-breakpoint
ALTER TABLE "webServerSettings" ADD COLUMN "whitelabelBrandName" text;--> statement-breakpoint
ALTER TABLE "webServerSettings" ADD COLUMN "whitelabelTagline" text;