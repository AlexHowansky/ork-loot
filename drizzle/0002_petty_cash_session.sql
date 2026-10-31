ALTER TABLE `petty_cash_entry` ADD `session_id` integer REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `petty_cash_entry_session_idx` ON `petty_cash_entry` (`session_id`);--> statement-breakpoint
-- Hand-written entries join the session on their date, if there's only one.
UPDATE `petty_cash_entry` SET `session_id` = (
	SELECT `session`.`id` FROM `session`
	WHERE `session`.`campaign_id` = `petty_cash_entry`.`campaign_id`
		AND `session`.`date` = `petty_cash_entry`.`date`
)
WHERE `split_id` IS NULL AND (
	SELECT count(*) FROM `session`
	WHERE `session`.`campaign_id` = `petty_cash_entry`.`campaign_id`
		AND `session`.`date` = `petty_cash_entry`.`date`
) = 1;
