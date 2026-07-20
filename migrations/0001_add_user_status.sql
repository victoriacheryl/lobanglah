ALTER TABLE `users` ADD `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_until` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `restriction_reason` text;
