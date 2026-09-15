import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { assets, auditEvents, backtestNavs, backtestPositions, backtestRuns, backtestTrades, dataSources, dataVersions, dailyBars, fundamentalObservations, marketCalendars, marketRuleSets, researchMembers, researchNotes, researchTodos, scheduledJobs, strategies, strategyVersions, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { notifyOwner } from "../_core/notification";
import { DEFAULT_MARKET_RULES } from "./marketRules";
import { assertStrictRunAllowed, toDateKey, validateDailyBars } from "./quality";
import { runDailyBacktest } from "./backtest";
import { fetchCnBasics, fetchCnCalendar, fetchCnDaily, fetchCnEtfDaily, fetchHkDaily } from "./tushare";
import type { AssetType, CanonicalBar, Market } from "./types";

const asDate = (value: string) => new Date(`${toDateKey(value)}T00:00:00.000Z`);
const tag = (prefix: string) => `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
const tradingWeekKey = (date: string) => { const value = asDate(date); value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7)); return value.toISOString().slice(0, 10); };

async function dbOrThrow() { const db = await getDb(); if (!db) throw new Error("研究数据库暂不可用。"); return db; }
async function alert(title: string, content: string) { try { await notifyOwner({ title, content }); } catch { /* owner alert is best-effort and must not expose credentials */ } }
async function recordAudit(actorId: number, entityType: string, entityId: string, action: string, summary: Record<string, unknown>) {
  const db = await dbOrThrow(); await db.insert(auditEvents).values({ actorId, entityType, entityId, action, summary });
}
async function sourceFor(name: string, kind: "tushare" | "upload" | "manual", market: Market | null, serverManaged: boolean) {
  const db = await dbOrThrow(); const current = await db.select().from(dataSources).where(eq(dataSources.name, name)).limit(1);
  if (current[0]) return current[0];
  await db.insert(dataSources).values({ name, kind, market, serverManaged });
  return (await db.select().from(dataSources).where(eq(dataSources.name, name)).limit(1))[0]!;
}
async function upsertAsset(input: { market: Market; assetType: AssetType; symbol: string; name?: string | null; exchange: string; currency: string; listedAt?: string | null }) {
  const db = await dbOrThrow();
  await db.insert(assets).values({ ...input, listedAt: input.listedAt ? asDate(input.listedAt) : null }).onDuplicateKeyUpdate({ set: { name: input.name ?? null, active: true, listedAt: input.listedAt ? asDate(input.listedAt) : null } });
  return (await db.select().from(assets).where(and(eq(assets.market, input.market), eq(assets.exchange, input.exchange), eq(assets.symbol, input.symbol))).limit(1))[0]!;
}

export async function ensureStarterContent(userId: number) {
  const db = await dbOrThrow();
  const member = await db.select().from(researchMembers).where(eq(researchMembers.userId, userId)).limit(1);
  if (!member[0]) await db.insert(researchMembers).values({ userId, accessRole: "owner", active: true, grantedBy: userId });
  for (const [market, config] of Object.entries(DEFAULT_MARKET_RULES) as [Market, typeof DEFAULT_MARKET_RULES.CN][]) {
    const name = `${market} 严格可交易日频 v1`;
    const exists = await db.select().from(marketRuleSets).where(and(eq(marketRuleSets.market, market), eq(marketRuleSets.name, name), eq(marketRuleSets.version, 1))).limit(1);
    if (!exists[0]) await db.insert(marketRuleSets).values({ name, market, version: 1, active: true, config, createdBy: userId });
  }
  const templates = [
    { name: "EBIT/EV 质量价值", slug: "ebit-ev-quality-value", category: "equity_factor", markets: ["CN", "US", "HK"], description: "按历史披露日可得的EBIT/EV构建质量价值横截面组合。", templateKey: "ebit_ev_quality", hypothesis: "高EBIT/EV资产在非前视、成本后条件下提供质量价值风险补偿。", config: { rebalance: "monthly", topN: 50, signalDelayTradingSessions: 1, requireFundamentalAvailableAt: true } },
    { name: "真实ETF动量—RSRS", slug: "etf-momentum-rsrs", category: "etf_rotation", markets: ["CN", "US", "HK"], description: "以真实可交易ETF的中期动量和RSRS/趋势过滤建立战术轮动。", templateKey: "etf_momentum_rsrs", hypothesis: "在成本和执行延迟后，趋势过滤可改善ETF动量的回撤特征。", config: { rebalance: "weekly", lookbackDays: 60, holdCount: 3, signalDelayTradingSessions: 1, strictExecution: true } },
    { name: "市场状态覆盖", slug: "market-regime-overlay", category: "market_timing", markets: ["CN", "US", "HK"], description: "使用波动率与换手率等市场状态信号缩放组合总风险。", templateKey: "market_regime_overlay", hypothesis: "市场状态信号只调整风险暴露，不作为单独高收益主张。", config: { rebalance: "weekly", volatilityWindow: 20, turnoverWindow: 20, maxExposure: 1, signalDelayTradingSessions: 1 } },
  ];
  for (const template of templates) {
    const existing = await db.select().from(strategies).where(eq(strategies.slug, template.slug)).limit(1);
    if (!existing[0]) { await db.insert(strategies).values({ name: template.name, slug: template.slug, category: template.category, markets: template.markets, description: template.description, ownerId: userId }); const strategy = (await db.select().from(strategies).where(eq(strategies.slug, template.slug)).limit(1))[0]!; await db.insert(strategyVersions).values({ strategyId: strategy.id, version: 1, templateKey: template.templateKey, hypothesis: template.hypothesis, config: template.config, status: "research-ready", createdBy: userId }); }
  }
  const scheduled = await db.select().from(scheduledJobs).where(eq(scheduledJobs.name, "daily-research-refresh")).limit(1);
  if (!scheduled[0]) await db.insert(scheduledJobs).values({ name: "daily-research-refresh", jobType: "data_sync_and_paper_backtest", cronExpression: "0 0 9 * * 1-5", enabled: false, config: { symbols: ["000300.SH"], markets: ["CN"], researchOnly: true }, createdBy: userId });
}

export async function hasResearchAccess(userId: number, isProjectAdmin: boolean) {
  if (isProjectAdmin) return true;
  const db = await dbOrThrow();
  const member = (await db.select().from(researchMembers).where(and(eq(researchMembers.userId, userId), eq(researchMembers.active, true))).limit(1))[0];
  return Boolean(member);
}

export async function dashboardSnapshot() {
  const db = await dbOrThrow();
  const [versions, allStrategies, runs, notes, todos] = await Promise.all([db.select().from(dataVersions).orderBy(desc(dataVersions.createdAt)).limit(8), db.select().from(strategies).orderBy(desc(strategies.updatedAt)), db.select().from(backtestRuns).orderBy(desc(backtestRuns.createdAt)).limit(8), db.select().from(researchNotes).orderBy(desc(researchNotes.updatedAt)).limit(8), db.select().from(researchTodos).orderBy(desc(researchTodos.updatedAt)).limit(12)]);
  return { versions, strategies: allStrategies, runs, notes, todos, checks: { passed: versions.filter(v => v.qualityStatus === "passed").length, failed: versions.filter(v => v.qualityStatus === "failed").length } };
}

export async function syncCnCalendar(userId: number, startDate: string, endDate: string) {
  try {
    const source = await sourceFor("Tushare Pro · A股", "tushare", "CN", true); const rows = await fetchCnCalendar(startDate.replaceAll("-", ""), endDate.replaceAll("-", "")); const db = await dbOrThrow(); const now = new Date(); const versionTag = tag("cn-calendar");
    await db.insert(dataVersions).values({ sourceId: source.id, dataset: "market_calendar", market: "CN", versionTag, fetchedAt: now, availableAt: now, coverageStart: asDate(startDate), coverageEnd: asDate(endDate), rowCount: rows.length, qualityStatus: "passed", qualityReport: { messages: ["来自服务端Tushare同步。"] }, createdBy: userId });
    const version = (await db.select().from(dataVersions).where(eq(dataVersions.versionTag, versionTag)).limit(1))[0]!;
    if (rows.length) await db.insert(marketCalendars).values(rows.map(row => ({ market: "CN" as const, exchange: String(row.exchange ?? "SSE"), tradeDate: asDate(String(row.cal_date)), isOpen: String(row.is_open) === "1", versionId: version.id })));
    await db.update(dataSources).set({ syncStatus: "success", lastSyncedAt: now }).where(eq(dataSources.id, source.id)); await recordAudit(userId, "data_version", String(version.id), "sync_calendar", { source: "tushare", rowCount: rows.length }); return version;
  } catch (error) { await alert("量化研究平台：A股交易日历同步失败", error instanceof Error ? error.message : "未知错误"); throw error; }
}

export async function syncCnBasics(userId: number) {
  try {
    const source = await sourceFor("Tushare Pro · A股", "tushare", "CN", true); const rows = await fetchCnBasics(); const db = await dbOrThrow(); const now = new Date(); const versionTag = tag("cn-basics");
    for (const row of rows) { const code = String(row.ts_code); await upsertAsset({ market: "CN", assetType: "stock", symbol: code, name: String(row.name ?? ""), exchange: code.endsWith(".SH") ? "SSE" : code.endsWith(".SZ") ? "SZSE" : "BSE", currency: "CNY", listedAt: row.list_date ? String(row.list_date) : null }); }
    await db.insert(dataVersions).values({ sourceId: source.id, dataset: "asset_master", market: "CN", versionTag, fetchedAt: now, availableAt: now, rowCount: rows.length, qualityStatus: "passed", qualityReport: { messages: ["证券基础信息同步完成。"] }, createdBy: userId }); const version = (await db.select().from(dataVersions).where(eq(dataVersions.versionTag, versionTag)).limit(1))[0]!;
    await db.update(dataSources).set({ syncStatus: "success", lastSyncedAt: now }).where(eq(dataSources.id, source.id)); await recordAudit(userId, "data_version", String(version.id), "sync_asset_master", { source: "tushare", rowCount: rows.length }); return version;
  } catch (error) { await alert("量化研究平台：A股资产主数据同步失败", error instanceof Error ? error.message : "未知错误"); throw error; }
}

export async function persistBars(userId: number, sourceName: string, market: Market, exchange: string, currency: string, assetType: AssetType, rawRows: CanonicalBar[], storageKey?: string, importMetadata?: Record<string, unknown>) {
  const normalized = rawRows.map(row => ({ ...row, tradeDate: toDateKey(row.tradeDate) })); const report = validateDailyBars(normalized); const rows = [...normalized].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.tradeDate.localeCompare(b.tradeDate)); const source = await sourceFor(sourceName, sourceName.startsWith("Tushare") ? "tushare" : "upload", market, sourceName.startsWith("Tushare")); const db = await dbOrThrow(); const now = new Date(); const versionTag = tag(`${market.toLowerCase()}-daily`);
  const qualityReport = { ...report, ...(importMetadata ? { importMetadata } : {}) };
  await db.insert(dataVersions).values({ sourceId: source.id, dataset: "daily_bars", market, versionTag, fetchedAt: now, availableAt: now, coverageStart: report.coverageStart ? asDate(report.coverageStart) : null, coverageEnd: report.coverageEnd ? asDate(report.coverageEnd) : null, rowCount: rows.length, storageKey, qualityStatus: report.status, qualityReport, createdBy: userId }); const version = (await db.select().from(dataVersions).where(eq(dataVersions.versionTag, versionTag)).limit(1))[0]!;
  if (report.status === "failed") { await alert("量化研究平台：数据质量检查失败", report.messages.join(" ")); await recordAudit(userId, "data_version", String(version.id), "quality_failed", report); return { version, report }; }
  const assetCache = new Map<string, number>();
  for (const row of rows) { let assetId = assetCache.get(row.symbol); if (!assetId) { const asset = await upsertAsset({ market, assetType, symbol: row.symbol, exchange, currency }); assetId = asset.id; assetCache.set(row.symbol, assetId); } }
  const mapped = rows.map(row => ({ assetId: assetCache.get(row.symbol)!, versionId: version.id, tradeDate: asDate(row.tradeDate), open: String(row.open), high: String(row.high), low: String(row.low), close: String(row.close), preClose: row.preClose === undefined || row.preClose === null ? null : String(row.preClose), volume: row.volume === undefined || row.volume === null ? null : String(row.volume), amount: row.amount === undefined || row.amount === null ? null : String(row.amount) }));
  for (let cursor = 0; cursor < mapped.length; cursor += 500) await db.insert(dailyBars).values(mapped.slice(cursor, cursor + 500));
  await db.update(dataSources).set({ syncStatus: "success", lastSyncedAt: now }).where(eq(dataSources.id, source.id)); await recordAudit(userId, "data_version", String(version.id), "persist_daily_bars", { source: sourceName, rowCount: rows.length, report }); return { version, report };
}

export async function syncCnDaily(userId: number, symbol: string, startDate: string, endDate: string) {
  try {
    const sourceRows = await fetchCnDaily(symbol, startDate.replaceAll("-", ""), endDate.replaceAll("-", ""));
    const exchange = symbol.endsWith(".SH") ? "SSE" : symbol.endsWith(".SZ") ? "SZSE" : "BSE";
    const result = await persistBars(userId, "Tushare Pro · A股", "CN", exchange, "CNY", symbol.startsWith("0") || symbol.startsWith("3") || symbol.startsWith("6") ? "stock" : "index", sourceRows.map(row => ({ symbol: String(row.ts_code), tradeDate: String(row.trade_date), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), preClose: Number(row.pre_close), volume: Number(row.vol), amount: Number(row.amount) })));
    const db = await dbOrThrow(); const calendarRows = await db.select({ tradeDate: marketCalendars.tradeDate }).from(marketCalendars).where(and(eq(marketCalendars.market, "CN"), eq(marketCalendars.isOpen, true), gte(marketCalendars.tradeDate, asDate(startDate)), lte(marketCalendars.tradeDate, asDate(endDate))));
    const expected = new Set(calendarRows.map(row => toDateKey(row.tradeDate))); const received = new Set(sourceRows.map(row => toDateKey(String(row.trade_date)))); const missingDates = Array.from(expected).filter(date => !received.has(date));
    if (missingDates.length) { const coverage = { expectedTradingDays: expected.size, receivedTradingDays: received.size, missingDates: missingDates.slice(0, 20), status: "warning" }; await db.update(dataVersions).set({ qualityStatus: "warning", qualityReport: { ...result.report, coverage } }).where(eq(dataVersions.id, result.version.id)); await alert("量化研究平台：日线数据覆盖中断", `${symbol} 缺少${missingDates.length}个交易日数据。`); return { ...result, coverage }; }
    return result;
  } catch (error) { await alert("量化研究平台：A股日线同步失败", error instanceof Error ? error.message : "未知错误"); throw error; }
}

const todayKey = () => new Date().toISOString().slice(0, 10);
export async function syncCnEtfDaily(userId: number, symbol: string, startDate: string, endDate: string) {
  try { const sourceRows = await fetchCnEtfDaily(symbol, startDate.replaceAll("-", ""), endDate.replaceAll("-", "")); const exchange = symbol.endsWith(".SH") ? "SSE" : "SZSE"; return persistBars(userId, "Tushare Pro · A股ETF", "CN", exchange, "CNY", "etf", sourceRows.map(row => ({ symbol: String(row.ts_code), tradeDate: String(row.trade_date), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), preClose: Number(row.pre_close), volume: Number(row.vol), amount: Number(row.amount) }))); } catch (error) { await alert("量化研究平台：A股ETF日线同步失败", error instanceof Error ? error.message : "未知错误"); throw error; }
}
export async function syncHkDaily(userId: number, symbol: string, startDate: string, endDate: string) {
  try { const sourceRows = await fetchHkDaily(symbol, startDate.replaceAll("-", ""), endDate.replaceAll("-", "")); return persistBars(userId, "Tushare Pro · 港股", "HK", "HKEX", "HKD", "stock", sourceRows.map(row => ({ symbol: String(row.ts_code), tradeDate: String(row.trade_date), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), preClose: Number(row.pre_close), volume: Number(row.vol), amount: Number(row.amount) }))); } catch (error) { await alert("量化研究平台：港股日线同步失败", error instanceof Error ? error.message : "未知错误"); throw error; }
}
export async function runScheduledResearchRefresh(taskUid: string) {
  const db = await dbOrThrow();
  const job = (await db.select().from(scheduledJobs).where(eq(scheduledJobs.scheduleCronTaskUid, taskUid)).limit(1))[0];
  if (!job) return { ok: true, skipped: "orphan" as const };
  if (!job.enabled || !job.createdBy) return { ok: true, skipped: "disabled" as const };
  const currentWindow = job.jobType === "hk_historical_data_backfill" ? new Date().toISOString().slice(0, 13) : todayKey();
  const previousWindow = job.lastRunAt ? (job.jobType === "hk_historical_data_backfill" ? job.lastRunAt.toISOString().slice(0, 13) : job.lastRunAt.toISOString().slice(0, 10)) : null;
  if (previousWindow === currentWindow) return { ok: true, skipped: "already_run" as const };
  try {
    const config = job.config as { symbols?: string[]; hkHistoricalSymbols?: string[]; hkCompletedSymbols?: string[]; hkStartDate?: string; hkEndDate?: string }; const start = new Date(); start.setUTCDate(start.getUTCDate() - 7); const startDate = start.toISOString().slice(0, 10); const endDate = todayKey();
    await syncCnCalendar(job.createdBy, startDate, endDate);
    for (const symbol of config.symbols ?? []) await syncCnDaily(job.createdBy, symbol, startDate, endDate);
    const completed = config.hkCompletedSymbols ?? []; const nextHkSymbol = (config.hkHistoricalSymbols ?? []).find(symbol => !completed.includes(symbol));
    if (nextHkSymbol) { await syncHkDaily(job.createdBy, nextHkSymbol, config.hkStartDate ?? "2020-01-01", config.hkEndDate ?? "2022-12-30"); config.hkCompletedSymbols = [...completed, nextHkSymbol]; }
    await db.update(scheduledJobs).set({ config, lastRunAt: new Date(), lastStatus: "success", lastError: null }).where(eq(scheduledJobs.id, job.id));
    await recordAudit(job.createdBy, "scheduled_job", String(job.id), "daily_refresh_success", { startDate, endDate, symbols: config.symbols ?? [] }); return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const isRateLimited = /频率超限|rate limit|too many requests/i.test(message);
    await db.update(scheduledJobs).set({ lastRunAt: new Date(), lastStatus: isRateLimited ? "rate_limited" : "failed", lastError: message }).where(eq(scheduledJobs.id, job.id));
    if (isRateLimited) { await alert("量化研究平台：港股数据频率限制", "港股策略池将在下一个小时窗口继续拉取，未使用替代数据源。"); return { ok: true, skipped: "rate_limited" as const }; }
    await alert("量化研究平台：日度研究任务失败", message); throw error;
  }
}

export async function listStrategiesWithVersions() { const db = await dbOrThrow(); return db.select({ strategy: strategies, version: strategyVersions }).from(strategies).leftJoin(strategyVersions, eq(strategies.id, strategyVersions.strategyId)).orderBy(strategies.name, desc(strategyVersions.version)); }
export async function getDailyResearchJob() { const db = await dbOrThrow(); return (await db.select().from(scheduledJobs).where(eq(scheduledJobs.name, "daily-research-refresh")).limit(1))[0] ?? null; }
export async function setDailyResearchJobState(enabled: boolean) { const db = await dbOrThrow(); const job = await getDailyResearchJob(); if (!job) throw new Error("日度研究任务尚未初始化。"); await db.update(scheduledJobs).set({ enabled, lastStatus: enabled ? "scheduled" : "paused" }).where(eq(scheduledJobs.id, job.id)); return { ...job, enabled, lastStatus: enabled ? "scheduled" : "paused" }; }
export async function recordFundamentalObservation(userId: number, input: { assetId: number; versionId: number; field: string; fiscalPeriod?: string; announcedAt: string; availableAt: string; value: number }) { if (new Date(input.availableAt) < new Date(input.announcedAt)) throw new Error("基本面可用时间不得早于披露时间。"); const db = await dbOrThrow(); const result = await db.insert(fundamentalObservations).values({ assetId: input.assetId, versionId: input.versionId, field: input.field, fiscalPeriod: input.fiscalPeriod ? asDate(input.fiscalPeriod) : null, announcedAt: new Date(input.announcedAt), availableAt: new Date(input.availableAt), value: String(input.value) }); const id = Number(result[0].insertId); await recordAudit(userId, "fundamental_observation", String(id), "record", { assetId: input.assetId, field: input.field, announcedAt: input.announcedAt, availableAt: input.availableAt }); return id; }
export async function latestFundamentalsAsOf(assetIds: number[], fields: string[], signalAt: string) { const db = await dbOrThrow(); const rows = await db.select().from(fundamentalObservations).where(and(inArray(fundamentalObservations.assetId, assetIds), inArray(fundamentalObservations.field, fields), lte(fundamentalObservations.availableAt, new Date(signalAt)))).orderBy(desc(fundamentalObservations.availableAt)); const seen = new Set<string>(); return rows.filter(row => { const key = `${row.assetId}:${row.field}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
export async function forkStrategyVersion(userId: number, input: { sourceVersionId: number; hypothesis: string; config: Record<string, unknown>; status?: string }) { const db = await dbOrThrow(); const source = (await db.select().from(strategyVersions).where(eq(strategyVersions.id, input.sourceVersionId)).limit(1))[0]; if (!source) throw new Error("源策略版本不存在。"); const latest = (await db.select().from(strategyVersions).where(eq(strategyVersions.strategyId, source.strategyId)).orderBy(desc(strategyVersions.version)).limit(1))[0]; const nextVersion = (latest?.version ?? 0) + 1; const result = await db.insert(strategyVersions).values({ strategyId: source.strategyId, version: nextVersion, templateKey: source.templateKey, hypothesis: input.hypothesis, config: input.config, status: input.status ?? "research-ready", createdBy: userId }); const id = Number(result[0].insertId); await recordAudit(userId, "strategy_version", String(id), "fork", { sourceVersionId: source.id, version: nextVersion }); return id; }
export async function listRuleSets() { const db = await dbOrThrow(); return db.select().from(marketRuleSets).where(eq(marketRuleSets.active, true)).orderBy(marketRuleSets.market, marketRuleSets.name); }

export async function createResearchNote(userId: number, input: { strategyId?: number; noteType: string; title: string; body: string }) { const db = await dbOrThrow(); const result = await db.insert(researchNotes).values({ ...input, authorId: userId }); const id = Number(result[0].insertId); await recordAudit(userId, "research_note", String(id), "create", { title: input.title, noteType: input.noteType }); return id; }
export async function createResearchTodo(userId: number, input: { strategyId?: number; title: string; detail?: string }) { const db = await dbOrThrow(); const result = await db.insert(researchTodos).values({ ...input, createdBy: userId, assigneeId: userId }); const id = Number(result[0].insertId); await recordAudit(userId, "research_todo", String(id), "create", { title: input.title }); return id; }
export async function grantResearchMember(ownerId: number, email: string, accessRole: "editor" | "viewer") { const db = await dbOrThrow(); const user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0]; if (!user) throw new Error("该成员尚未使用此邮箱登录过平台，暂无法授权。"); await db.insert(researchMembers).values({ userId: user.id, accessRole, active: true, grantedBy: ownerId }).onDuplicateKeyUpdate({ set: { accessRole, active: true, grantedBy: ownerId } }); await recordAudit(ownerId, "research_member", String(user.id), "grant", { email, accessRole }); return { id: user.id, email: user.email, name: user.name, accessRole }; }

export async function runBacktest(userId: number, input: { strategyVersionId: number; ruleSetId: number; dataVersionId: number; startDate: string; endDate: string; targetWeights: Record<string, number>; mode: "baseline" | "strict"; initialCapital: number }) {
  const db = await dbOrThrow(); const [version] = await db.select().from(dataVersions).where(eq(dataVersions.id, input.dataVersionId)).limit(1); const [ruleSet] = await db.select().from(marketRuleSets).where(eq(marketRuleSets.id, input.ruleSetId)).limit(1); if (!version || !ruleSet) throw new Error("数据版本或规则集不存在。");
  const quality = version.qualityReport as { status?: "passed" | "warning" | "failed" } | null; const dateRows = await db.select({ bar: dailyBars, asset: assets }).from(dailyBars).innerJoin(assets, eq(dailyBars.assetId, assets.id)).where(and(eq(dailyBars.versionId, input.dataVersionId)));
  const bars = dateRows.map(row => ({ symbol: row.asset.symbol, tradeDate: toDateKey(row.bar.tradeDate), open: Number(row.bar.open), high: Number(row.bar.high), low: Number(row.bar.low), close: Number(row.bar.close), preClose: row.bar.preClose === null ? null : Number(row.bar.preClose), volume: row.bar.volume === null ? null : Number(row.bar.volume), amount: row.bar.amount === null ? null : Number(row.bar.amount) })).filter(row => row.tradeDate >= toDateKey(input.startDate) && row.tradeDate <= toDateKey(input.endDate));
  const allDates = Array.from(new Set(bars.map(bar => bar.tradeDate))).sort(); if (!allDates.length) throw new Error("选定数据版本在回测区间内没有日线数据。");
  // 版本的fetchedAt/availableAt用于审计数据取得时间；日频价格在严格模式中按信号日收盘后、下一交易日可成交的时序处理。
  if (input.mode === "strict") assertStrictRunAllowed((quality ?? { status: "failed" }) as never, asDate(allDates[0]), asDate(allDates[0]), asDate(allDates[1] ?? allDates[0]));
  const rebalanceDates = allDates.filter((date, index) => index > 0 && tradingWeekKey(date) !== tradingWeekKey(allDates[index - 1]));
  const result = runDailyBacktest({ bars, rebalanceDates, targetWeights: input.targetWeights, initialCapital: input.initialCapital, rule: ruleSet.config as never, strict: input.mode === "strict" });
  await db.insert(backtestRuns).values({ strategyVersionId: input.strategyVersionId, ruleSetId: input.ruleSetId, mode: input.mode, status: "completed", startDate: asDate(input.startDate), endDate: asDate(input.endDate), dataVersionIds: [input.dataVersionId], configSnapshot: { targetWeights: input.targetWeights, initialCapital: input.initialCapital }, qualityResult: quality, metrics: result.metrics, createdBy: userId, startedAt: new Date(), finishedAt: new Date() }); const run = (await db.select().from(backtestRuns).orderBy(desc(backtestRuns.id)).limit(1))[0]!;
  if (result.nav.length) await db.insert(backtestNavs).values(result.nav.map(point => ({ runId: run.id, tradeDate: asDate(point.tradeDate), nav: String(point.nav), dailyReturn: String(point.dailyReturn), exposure: String(point.exposure), turnover: String(point.turnover) })));
  if (result.positions.length) { const symbols = Array.from(new Set(result.positions.map(position => position.symbol))); const positionAssets = await db.select().from(assets).where(inArray(assets.symbol, symbols)); const ids = new Map(positionAssets.map(asset => [asset.symbol, asset.id])); await db.insert(backtestPositions).values(result.positions.filter(position => ids.has(position.symbol)).map(position => ({ runId: run.id, assetId: ids.get(position.symbol)!, tradeDate: asDate(position.tradeDate), quantity: String(position.quantity), marketValue: String(position.marketValue), weight: String(position.weight) }))); }
  if (result.trades.length) { const symbols = Array.from(new Set(result.trades.map(trade => trade.symbol))); const tradedAssets = await db.select().from(assets).where(inArray(assets.symbol, symbols)); const ids = new Map(tradedAssets.map(asset => [asset.symbol, asset.id])); await db.insert(backtestTrades).values(result.trades.filter(trade => ids.has(trade.symbol)).map(trade => ({ runId: run.id, assetId: ids.get(trade.symbol)!, tradeDate: asDate(trade.tradeDate), side: trade.side, quantity: String(trade.quantity), price: String(trade.price), commission: String(trade.commission), taxes: String(trade.taxes), slippage: String(trade.slippage), status: trade.status, rejectionReason: trade.rejectionReason ?? null }))); }
  await recordAudit(userId, "backtest_run", String(run.id), "complete", { mode: input.mode, dataVersionId: input.dataVersionId, metrics: result.metrics }); return { run, result };
}

export async function runBacktestComparison(userId: number, input: Omit<Parameters<typeof runBacktest>[1], "mode">) {
  const baseline = await runBacktest(userId, { ...input, mode: "baseline" });
  const strict = await runBacktest(userId, { ...input, mode: "strict" });
  return { baseline: { runId: baseline.run.id, metrics: baseline.result.metrics }, strict: { runId: strict.run.id, metrics: strict.result.metrics } };
}
