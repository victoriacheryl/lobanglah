ALTER TABLE `announcements` ADD `scheduled_for` integer;
--> statement-breakpoint
ALTER TABLE `announcements` ADD `published_at` integer;
--> statement-breakpoint
UPDATE `announcements` SET `published_at` = `created_at` WHERE `published_at` IS NULL;
