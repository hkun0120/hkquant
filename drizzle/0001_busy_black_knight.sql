CREATE TABLE `assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`market` enum('CN','US','HK') NOT NULL,
	`assetType` enum('stock','etf','index','future','cash') NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`name` varchar(255),
	`exchange` varchar(32) NOT NULL,
	`currency` varchar(8) NOT NULL,
	`listedAt` date,
	`delistedAt` date,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `assets_market_exchange_symbol_idx` UNIQUE(`market`,`exchange`,`symbol`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`actorId` int,
	`entityType` varchar(64) NOT NULL,
	`entityId` varchar(64) NOT NULL,
	`action` varchar(64) NOT NULL,
	`summary` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backtest_navs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`tradeDate` date NOT NULL,
	`nav` decimal(22,8) NOT NULL,
	`dailyReturn` decimal(16,8) NOT NULL,
	`exposure` decimal(12,8) NOT NULL,
	`turnover` decimal(16,8) NOT NULL,
	CONSTRAINT `backtest_navs_id` PRIMARY KEY(`id`),
	CONSTRAINT `backtest_navs_run_date_idx` UNIQUE(`runId`,`tradeDate`)
);
--> statement-breakpoint
CREATE TABLE `backtest_positions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`assetId` int NOT NULL,
	`tradeDate` date NOT NULL,
	`quantity` decimal(24,6) NOT NULL,
	`marketValue` decimal(24,6) NOT NULL,
	`weight` decimal(16,8) NOT NULL,
	CONSTRAINT `backtest_positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backtest_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyVersionId` int NOT NULL,
	`ruleSetId` int NOT NULL,
	`mode` enum('baseline','strict') NOT NULL,
	`status` enum('draft','queued','running','completed','failed','blocked') NOT NULL DEFAULT 'draft',
	`startDate` date NOT NULL,
	`endDate` date NOT NULL,
	`dataVersionIds` json NOT NULL,
	`configSnapshot` json NOT NULL,
	`qualityResult` json,
	`metrics` json,
	`errorMessage` text,
	`createdBy` int,
	`startedAt` timestamp,
	`finishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backtest_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backtest_trades` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`assetId` int NOT NULL,
	`tradeDate` date NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`quantity` decimal(24,6) NOT NULL,
	`price` decimal(20,6) NOT NULL,
	`commission` decimal(20,6) NOT NULL DEFAULT '0',
	`taxes` decimal(20,6) NOT NULL DEFAULT '0',
	`slippage` decimal(20,6) NOT NULL DEFAULT '0',
	`status` varchar(32) NOT NULL,
	`rejectionReason` varchar(255),
	CONSTRAINT `backtest_trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_bars` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`assetId` int NOT NULL,
	`versionId` int NOT NULL,
	`tradeDate` date NOT NULL,
	`open` decimal(20,6) NOT NULL,
	`high` decimal(20,6) NOT NULL,
	`low` decimal(20,6) NOT NULL,
	`close` decimal(20,6) NOT NULL,
	`preClose` decimal(20,6),
	`volume` decimal(24,4),
	`amount` decimal(24,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_bars_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_bars_asset_date_version_idx` UNIQUE(`assetId`,`tradeDate`,`versionId`)
);
--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`kind` enum('tushare','upload','manual') NOT NULL,
	`market` enum('CN','US','HK'),
	`serverManaged` boolean NOT NULL DEFAULT false,
	`syncStatus` varchar(32) NOT NULL DEFAULT 'idle',
	`lastSyncedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `data_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `data_sources_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `data_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int,
	`dataset` varchar(64) NOT NULL,
	`market` enum('CN','US','HK'),
	`versionTag` varchar(96) NOT NULL,
	`fetchedAt` timestamp NOT NULL,
	`availableAt` timestamp NOT NULL,
	`coverageStart` date,
	`coverageEnd` date,
	`rowCount` int NOT NULL DEFAULT 0,
	`checksum` varchar(128),
	`storageKey` varchar(512),
	`qualityStatus` enum('pending','passed','warning','failed') NOT NULL DEFAULT 'pending',
	`qualityReport` json,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `data_versions_versionTag_unique` UNIQUE(`versionTag`)
);
--> statement-breakpoint
CREATE TABLE `fundamental_observations` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`assetId` int NOT NULL,
	`versionId` int NOT NULL,
	`field` varchar(100) NOT NULL,
	`fiscalPeriod` date,
	`announcedAt` timestamp NOT NULL,
	`availableAt` timestamp NOT NULL,
	`value` decimal(24,8) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fundamental_observations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `market_calendars` (
	`id` int AUTO_INCREMENT NOT NULL,
	`market` enum('CN','US','HK') NOT NULL,
	`exchange` varchar(32) NOT NULL,
	`tradeDate` date NOT NULL,
	`isOpen` boolean NOT NULL,
	`versionId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `market_calendars_id` PRIMARY KEY(`id`),
	CONSTRAINT `calendar_market_exchange_date_version_idx` UNIQUE(`market`,`exchange`,`tradeDate`,`versionId`)
);
--> statement-breakpoint
CREATE TABLE `market_rule_sets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`market` enum('CN','US','HK') NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`active` boolean NOT NULL DEFAULT true,
	`config` json NOT NULL,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `market_rule_sets_id` PRIMARY KEY(`id`),
	CONSTRAINT `market_rule_sets_market_name_version_idx` UNIQUE(`market`,`name`,`version`)
);
--> statement-breakpoint
CREATE TABLE `research_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` int,
	`noteType` varchar(32) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`authorId` int,
	`revision` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_todos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` int,
	`title` varchar(255) NOT NULL,
	`detail` text,
	`status` varchar(32) NOT NULL DEFAULT 'open',
	`assigneeId` int,
	`createdBy` int,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_todos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`jobType` varchar(50) NOT NULL,
	`cronExpression` varchar(80) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`schedule_cron_task_uid` varchar(65),
	`config` json NOT NULL,
	`lastRunAt` timestamp,
	`lastStatus` varchar(32) NOT NULL DEFAULT 'never',
	`lastError` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduled_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_jobs_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`slug` varchar(160) NOT NULL,
	`category` varchar(64) NOT NULL,
	`markets` json NOT NULL,
	`description` text NOT NULL,
	`ownerId` int,
	`archived` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategies_id` PRIMARY KEY(`id`),
	CONSTRAINT `strategies_name_unique` UNIQUE(`name`),
	CONSTRAINT `strategies_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `strategy_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` int NOT NULL,
	`version` int NOT NULL,
	`templateKey` varchar(80) NOT NULL,
	`hypothesis` text NOT NULL,
	`config` json NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'draft',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `strategy_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `strategy_versions_unique_idx` UNIQUE(`strategyId`,`version`)
);
--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backtest_navs` ADD CONSTRAINT `backtest_navs_runId_backtest_runs_id_fk` FOREIGN KEY (`runId`) REFERENCES `backtest_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backtest_positions` ADD CONSTRAINT `backtest_positions_runId_backtest_runs_id_fk` FOREIGN KEY (`runId`) REFERENCES `backtest_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backtest_positions` ADD CONSTRAINT `backtest_positions_assetId_assets_id_fk` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD CONSTRAINT `backtest_runs_strategyVersionId_strategy_versions_id_fk` FOREIGN KEY (`strategyVersionId`) REFERENCES `strategy_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD CONSTRAINT `backtest_runs_ruleSetId_market_rule_sets_id_fk` FOREIGN KEY (`ruleSetId`) REFERENCES `market_rule_sets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD CONSTRAINT `backtest_runs_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backtest_trades` ADD CONSTRAINT `backtest_trades_runId_backtest_runs_id_fk` FOREIGN KEY (`runId`) REFERENCES `backtest_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backtest_trades` ADD CONSTRAINT `backtest_trades_assetId_assets_id_fk` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_bars` ADD CONSTRAINT `daily_bars_assetId_assets_id_fk` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_bars` ADD CONSTRAINT `daily_bars_versionId_data_versions_id_fk` FOREIGN KEY (`versionId`) REFERENCES `data_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_versions` ADD CONSTRAINT `data_versions_sourceId_data_sources_id_fk` FOREIGN KEY (`sourceId`) REFERENCES `data_sources`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `data_versions` ADD CONSTRAINT `data_versions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fundamental_observations` ADD CONSTRAINT `fundamental_observations_assetId_assets_id_fk` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fundamental_observations` ADD CONSTRAINT `fundamental_observations_versionId_data_versions_id_fk` FOREIGN KEY (`versionId`) REFERENCES `data_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `market_calendars` ADD CONSTRAINT `market_calendars_versionId_data_versions_id_fk` FOREIGN KEY (`versionId`) REFERENCES `data_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `market_rule_sets` ADD CONSTRAINT `market_rule_sets_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `research_notes` ADD CONSTRAINT `research_notes_strategyId_strategies_id_fk` FOREIGN KEY (`strategyId`) REFERENCES `strategies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `research_notes` ADD CONSTRAINT `research_notes_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `research_todos` ADD CONSTRAINT `research_todos_strategyId_strategies_id_fk` FOREIGN KEY (`strategyId`) REFERENCES `strategies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `research_todos` ADD CONSTRAINT `research_todos_assigneeId_users_id_fk` FOREIGN KEY (`assigneeId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `research_todos` ADD CONSTRAINT `research_todos_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduled_jobs` ADD CONSTRAINT `scheduled_jobs_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `strategies` ADD CONSTRAINT `strategies_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `strategy_versions` ADD CONSTRAINT `strategy_versions_strategyId_strategies_id_fk` FOREIGN KEY (`strategyId`) REFERENCES `strategies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `strategy_versions` ADD CONSTRAINT `strategy_versions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entityType`,`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `backtest_positions_run_date_idx` ON `backtest_positions` (`runId`,`tradeDate`);--> statement-breakpoint
CREATE INDEX `backtest_runs_status_created_idx` ON `backtest_runs` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `backtest_trades_run_date_idx` ON `backtest_trades` (`runId`,`tradeDate`);--> statement-breakpoint
CREATE INDEX `daily_bars_version_date_idx` ON `daily_bars` (`versionId`,`tradeDate`);--> statement-breakpoint
CREATE INDEX `data_versions_dataset_market_idx` ON `data_versions` (`dataset`,`market`);--> statement-breakpoint
CREATE INDEX `fundamental_pit_lookup_idx` ON `fundamental_observations` (`assetId`,`field`,`availableAt`);--> statement-breakpoint
CREATE INDEX `scheduled_jobs_task_uid_idx` ON `scheduled_jobs` (`schedule_cron_task_uid`);