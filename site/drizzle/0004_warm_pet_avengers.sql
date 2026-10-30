ALTER TABLE `official_update_approvals` ADD `kind` text DEFAULT 'vendor_handoff' NOT NULL;--> statement-breakpoint
ALTER TABLE `official_update_approvals` ADD `route_review` text;--> statement-breakpoint
ALTER TABLE `relay_state` ADD `allow_stock_update` integer DEFAULT 0 NOT NULL;