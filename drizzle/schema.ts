import { bigint, boolean, date, decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const researchMembers = mysqlTable("research_members", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  accessRole: mysqlEnum("accessRole", ["owner", "editor", "viewer"]).notNull().default("viewer"),
  active: boolean("active").notNull().default(true),
  grantedBy: int("grantedBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("research_members_user_idx").on(table.userId)]);

export const markets = ["CN", "US", "HK"] as const;
export const assetTypes = ["stock", "etf", "index", "future", "cash"] as const;
export const sourceKinds = ["tushare", "upload", "manual"] as const;
export const qualityStatuses = ["pending", "passed", "warning", "failed"] as const;
export const runModes = ["baseline", "strict"] as const;
export const runStatuses = ["draft", "queued", "running", "completed", "failed", "blocked"] as const;

export const dataSources = mysqlTable("data_sources", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  kind: mysqlEnum("kind", sourceKinds).notNull(),
  market: mysqlEnum("market", markets),
  serverManaged: boolean("serverManaged").notNull().default(false),
  syncStatus: varchar("syncStatus", { length: 32 }).notNull().default("idle"),
  lastSyncedAt: timestamp("lastSyncedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const assets = mysqlTable("assets", {
  id: int("id").autoincrement().primaryKey(),
  market: mysqlEnum("market", markets).notNull(),
  assetType: mysqlEnum("assetType", assetTypes).notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  name: varchar("name", { length: 255 }),
  exchange: varchar("exchange", { length: 32 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  listedAt: date("listedAt"),
  delistedAt: date("delistedAt"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("assets_market_exchange_symbol_idx").on(table.market, table.exchange, table.symbol)]);

export const dataVersions = mysqlTable("data_versions", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("sourceId").references(() => dataSources.id),
  dataset: varchar("dataset", { length: 64 }).notNull(),
  market: mysqlEnum("market", markets),
  versionTag: varchar("versionTag", { length: 96 }).notNull().unique(),
  fetchedAt: timestamp("fetchedAt").notNull(),
  availableAt: timestamp("availableAt").notNull(),
  coverageStart: date("coverageStart"),
  coverageEnd: date("coverageEnd"),
  rowCount: int("rowCount").notNull().default(0),
  checksum: varchar("checksum", { length: 128 }),
  storageKey: varchar("storageKey", { length: 512 }),
  qualityStatus: mysqlEnum("qualityStatus", qualityStatuses).notNull().default("pending"),
  qualityReport: json("qualityReport"),
  createdBy: int("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("data_versions_dataset_market_idx").on(table.dataset, table.market)]);

export const marketCalendars = mysqlTable("market_calendars", {
  id: int("id").autoincrement().primaryKey(),
  market: mysqlEnum("market", markets).notNull(),
  exchange: varchar("exchange", { length: 32 }).notNull(),
  tradeDate: date("tradeDate").notNull(),
  isOpen: boolean("isOpen").notNull(),
  versionId: int("versionId").notNull().references(() => dataVersions.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [uniqueIndex("calendar_market_exchange_date_version_idx").on(table.market, table.exchange, table.tradeDate, table.versionId)]);

export const dailyBars = mysqlTable("daily_bars", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  assetId: int("assetId").notNull().references(() => assets.id),
  versionId: int("versionId").notNull().references(() => dataVersions.id),
  tradeDate: date("tradeDate").notNull(),
  open: decimal("open", { precision: 20, scale: 6 }).notNull(),
  high: decimal("high", { precision: 20, scale: 6 }).notNull(),
  low: decimal("low", { precision: 20, scale: 6 }).notNull(),
  close: decimal("close", { precision: 20, scale: 6 }).notNull(),
  preClose: decimal("preClose", { precision: 20, scale: 6 }),
  volume: decimal("volume", { precision: 24, scale: 4 }),
  amount: decimal("amount", { precision: 24, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [uniqueIndex("daily_bars_asset_date_version_idx").on(table.assetId, table.tradeDate, table.versionId), index("daily_bars_version_date_idx").on(table.versionId, table.tradeDate)]);

export const fundamentalObservations = mysqlTable("fundamental_observations", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  assetId: int("assetId").notNull().references(() => assets.id),
  versionId: int("versionId").notNull().references(() => dataVersions.id),
  field: varchar("field", { length: 100 }).notNull(),
  fiscalPeriod: date("fiscalPeriod"),
  announcedAt: timestamp("announcedAt").notNull(),
  availableAt: timestamp("availableAt").notNull(),
  value: decimal("value", { precision: 24, scale: 8 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("fundamental_pit_lookup_idx").on(table.assetId, table.field, table.availableAt)]);

export const marketRuleSets = mysqlTable("market_rule_sets", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  market: mysqlEnum("market", markets).notNull(),
  version: int("version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  config: json("config").notNull(),
  createdBy: int("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("market_rule_sets_market_name_version_idx").on(table.market, table.name, table.version)]);

export const strategies = mysqlTable("strategies", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull().unique(),
  slug: varchar("slug", { length: 160 }).notNull().unique(),
  category: varchar("category", { length: 64 }).notNull(),
  markets: json("markets").notNull(),
  description: text("description").notNull(),
  ownerId: int("ownerId").references(() => users.id),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const strategyVersions = mysqlTable("strategy_versions", {
  id: int("id").autoincrement().primaryKey(),
  strategyId: int("strategyId").notNull().references(() => strategies.id),
  version: int("version").notNull(),
  templateKey: varchar("templateKey", { length: 80 }).notNull(),
  hypothesis: text("hypothesis").notNull(),
  config: json("config").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  createdBy: int("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [uniqueIndex("strategy_versions_unique_idx").on(table.strategyId, table.version)]);

export const backtestRuns = mysqlTable("backtest_runs", {
  id: int("id").autoincrement().primaryKey(),
  strategyVersionId: int("strategyVersionId").notNull().references(() => strategyVersions.id),
  ruleSetId: int("ruleSetId").notNull().references(() => marketRuleSets.id),
  mode: mysqlEnum("mode", runModes).notNull(),
  status: mysqlEnum("status", runStatuses).notNull().default("draft"),
  startDate: date("startDate").notNull(),
  endDate: date("endDate").notNull(),
  dataVersionIds: json("dataVersionIds").notNull(),
  configSnapshot: json("configSnapshot").notNull(),
  qualityResult: json("qualityResult"),
  metrics: json("metrics"),
  errorMessage: text("errorMessage"),
  createdBy: int("createdBy").references(() => users.id),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("backtest_runs_status_created_idx").on(table.status, table.createdAt)]);

export const backtestNavs = mysqlTable("backtest_navs", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  runId: int("runId").notNull().references(() => backtestRuns.id),
  tradeDate: date("tradeDate").notNull(),
  nav: decimal("nav", { precision: 22, scale: 8 }).notNull(),
  dailyReturn: decimal("dailyReturn", { precision: 16, scale: 8 }).notNull(),
  exposure: decimal("exposure", { precision: 12, scale: 8 }).notNull(),
  turnover: decimal("turnover", { precision: 16, scale: 8 }).notNull(),
}, table => [uniqueIndex("backtest_navs_run_date_idx").on(table.runId, table.tradeDate)]);

export const backtestPositions = mysqlTable("backtest_positions", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  runId: int("runId").notNull().references(() => backtestRuns.id),
  assetId: int("assetId").notNull().references(() => assets.id),
  tradeDate: date("tradeDate").notNull(),
  quantity: decimal("quantity", { precision: 24, scale: 6 }).notNull(),
  marketValue: decimal("marketValue", { precision: 24, scale: 6 }).notNull(),
  weight: decimal("weight", { precision: 16, scale: 8 }).notNull(),
}, table => [index("backtest_positions_run_date_idx").on(table.runId, table.tradeDate)]);

export const backtestTrades = mysqlTable("backtest_trades", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  runId: int("runId").notNull().references(() => backtestRuns.id),
  assetId: int("assetId").notNull().references(() => assets.id),
  tradeDate: date("tradeDate").notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  quantity: decimal("quantity", { precision: 24, scale: 6 }).notNull(),
  price: decimal("price", { precision: 20, scale: 6 }).notNull(),
  commission: decimal("commission", { precision: 20, scale: 6 }).notNull().default("0"),
  taxes: decimal("taxes", { precision: 20, scale: 6 }).notNull().default("0"),
  slippage: decimal("slippage", { precision: 20, scale: 6 }).notNull().default("0"),
  status: varchar("status", { length: 32 }).notNull(),
  rejectionReason: varchar("rejectionReason", { length: 255 }),
}, table => [index("backtest_trades_run_date_idx").on(table.runId, table.tradeDate)]);

export const researchNotes = mysqlTable("research_notes", {
  id: int("id").autoincrement().primaryKey(),
  strategyId: int("strategyId").references(() => strategies.id),
  noteType: varchar("noteType", { length: 32 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  authorId: int("authorId").references(() => users.id),
  revision: int("revision").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const researchTodos = mysqlTable("research_todos", {
  id: int("id").autoincrement().primaryKey(),
  strategyId: int("strategyId").references(() => strategies.id),
  title: varchar("title", { length: 255 }).notNull(),
  detail: text("detail"),
  status: varchar("status", { length: 32 }).notNull().default("open"),
  assigneeId: int("assigneeId").references(() => users.id),
  createdBy: int("createdBy").references(() => users.id),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const auditEvents = mysqlTable("audit_events", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  actorId: int("actorId").references(() => users.id),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: varchar("entityId", { length: 64 }).notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  summary: json("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("audit_events_entity_idx").on(table.entityType, table.entityId, table.createdAt)]);

export const scheduledJobs = mysqlTable("scheduled_jobs", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  jobType: varchar("jobType", { length: 50 }).notNull(),
  cronExpression: varchar("cronExpression", { length: 80 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  scheduleCronTaskUid: varchar("schedule_cron_task_uid", { length: 65 }),
  config: json("config").notNull(),
  lastRunAt: timestamp("lastRunAt"),
  lastStatus: varchar("lastStatus", { length: 32 }).notNull().default("never"),
  lastError: text("lastError"),
  createdBy: int("createdBy").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("scheduled_jobs_task_uid_idx").on(table.scheduleCronTaskUid)]);

export type Asset = typeof assets.$inferSelect;
export type DataVersion = typeof dataVersions.$inferSelect;
export type MarketRuleSet = typeof marketRuleSets.$inferSelect;
export type Strategy = typeof strategies.$inferSelect;
export type StrategyVersion = typeof strategyVersions.$inferSelect;
export type BacktestRun = typeof backtestRuns.$inferSelect;
