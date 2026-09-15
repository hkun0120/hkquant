CREATE TABLE `research_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accessRole` enum('owner','editor','viewer') NOT NULL DEFAULT 'viewer',
	`active` boolean NOT NULL DEFAULT true,
	`grantedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `research_members_user_idx` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `research_members` ADD CONSTRAINT `research_members_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `research_members` ADD CONSTRAINT `research_members_grantedBy_users_id_fk` FOREIGN KEY (`grantedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;