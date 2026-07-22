ALTER TABLE `listings` ADD `expires_at` integer;
--> statement-breakpoint
UPDATE `listings` SET `expires_at` = `created_at` + 604800000 WHERE `expires_at` IS NULL;
