import { and, eq } from "drizzle-orm";
import { assets, backtestNavs, backtestPositions, backtestRuns, backtestTrades, dailyBars, dataVersions, marketRuleSets, strategies, strategyVersions, users } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";
import { runDailyBacktest } from "../server/quant/backtest.ts";
import { DEFAULT_MARKET_RULES } from "../server/quant/marketRules.ts";

const DATA_VERSION_ID = 330002;
const INITIAL_CAPITAL = 1_000_000;
const LOOKBACK = 60;
const RSRS_WINDOW = 18;
const universe = ["510050.SH", "510300.SH", "510500.SH", "512000.SH", "512010.SH", "512100.SH", "518880.SH", "511010.SH"];
const asDate = value => new Date(`${value}T00:00:00.000Z`);
const dateKey = value => new Date(value).toISOString().slice(0, 10);
const weekKey = value => { const d = asDate(value); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return dateKey(d); };
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const slope = points => { const x = points.map(point => point.low); const mx = mean(x); const my = mean(points.map(point => point.high)); const cov = points.reduce((sum, point, i) => sum + (x[i] - mx) * (point.high - my), 0); const variance = x.reduce((sum, value) => sum + (value - mx) ** 2, 0); return variance ? cov / variance : 0; };
const std = xs => Math.sqrt(xs.reduce((sum, x) => sum + (x - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));

const db = await getDb();
if (!db) throw new Error("研究数据库暂不可用。");
const owner = process.env.OWNER_OPEN_ID ? (await db.select().from(users).where(eq(users.openId, process.env.OWNER_OPEN_ID)).limit(1))[0] : (await db.select().from(users).where(eq(users.role, "admin")).limit(1))[0];
if (!owner) throw new Error("未找到平台管理员。");
const sourceVersion = (await db.select().from(dataVersions).where(eq(dataVersions.id, DATA_VERSION_ID)).limit(1))[0];
if (!sourceVersion || sourceVersion.qualityStatus !== "passed") throw new Error("目标数据版本未通过质量检查。");
const rows = await db.select({ assetId: assets.id, symbol: assets.symbol, tradeDate: dailyBars.tradeDate, open: dailyBars.open, high: dailyBars.high, low: dailyBars.low, close: dailyBars.close, preClose: dailyBars.preClose, volume: dailyBars.volume, amount: dailyBars.amount }).from(dailyBars).innerJoin(assets, eq(dailyBars.assetId, assets.id)).where(eq(dailyBars.versionId, DATA_VERSION_ID));
const bars = rows.map(row => ({ assetId: row.assetId, symbol: row.symbol, tradeDate: dateKey(row.tradeDate), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), preClose: row.preClose === null ? undefined : Number(row.preClose), volume: row.volume === null ? undefined : Number(row.volume), amount: row.amount === null ? undefined : Number(row.amount) })).filter(row => universe.includes(row.symbol));
const bySymbol = new Map(universe.map(symbol => [symbol, bars.filter(row => row.symbol === symbol).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))]));
const calendar = [...new Set(bars.map(row => row.tradeDate))].sort();
const indexByDate = new Map(calendar.map((date, index) => [date, index]));
const weeklyLast = new Map(); calendar.forEach((date, index) => weeklyLast.set(weekKey(date), index));
const targets = {}; const rebalanceDates = [];
for (const signalIndex of weeklyLast.values()) {
  const executionDate = calendar[signalIndex + 1]; if (!executionDate || signalIndex < LOOKBACK) continue;
  const candidates = universe.map(symbol => { const series = bySymbol.get(symbol) ?? []; const point = series.findIndex(row => row.tradeDate === calendar[signalIndex]); if (point < LOOKBACK || point < RSRS_WINDOW) return null; const now = series[point]; const past = series[point - LOOKBACK]; const rsrsSlope = slope(series.slice(point - RSRS_WINDOW + 1, point + 1)); return { symbol, momentum: now.close / past.close - 1, rsrsSlope }; }).filter(Boolean).filter(item => item.momentum > 0 && item.rsrsSlope > 0.85).sort((a, b) => b.momentum - a.momentum || b.rsrsSlope - a.rsrsSlope);
  const benchmark = bySymbol.get("510300.SH") ?? []; const benchmarkIndex = benchmark.findIndex(row => row.tradeDate === calendar[signalIndex]); const recentReturns = benchmarkIndex >= 20 ? benchmark.slice(benchmarkIndex - 19, benchmarkIndex + 1).map((row, idx, array) => idx ? row.close / array[idx - 1].close - 1 : 0).slice(1) : []; const annualizedVol = recentReturns.length > 1 ? std(recentReturns) * Math.sqrt(252) : 0;
  const exposure = annualizedVol > 0.25 ? 0.5 : 1; targets[executionDate] = candidates[0] ? { [candidates[0].symbol]: exposure } : {}; rebalanceDates.push(executionDate);
}
const strictRule = { ...DEFAULT_MARKET_RULES.CN, sellTaxRate: 0, priceLimitPct: null, notes: "ETF研究严格口径：T+1、100份整手、0.03%佣金（最低5元）、8bp滑点；国内ETF卖出不计股票印花税。" };
const baselineRule = { ...strictRule, commissionRate: 0, minimumCommission: 0, slippageBps: 0, settlementLagDays: 0, lotSize: 1 };
const baseInput = { bars, rebalanceDates, targetWeights: {}, targetWeightsByDate: targets, initialCapital: INITIAL_CAPITAL };
const baseline = runDailyBacktest({ ...baseInput, rule: baselineRule, strict: false });
const strict = runDailyBacktest({ ...baseInput, rule: strictRule, strict: true });
const strategy = (await db.select().from(strategies).where(eq(strategies.slug, "etf-momentum-rsrs")).limit(1))[0];
const strategyVersion = strategy ? (await db.select().from(strategyVersions).where(and(eq(strategyVersions.strategyId, strategy.id), eq(strategyVersions.version, 1))).limit(1))[0] : null;
const ruleSet = (await db.select().from(marketRuleSets).where(and(eq(marketRuleSets.market, "CN"), eq(marketRuleSets.active, true))).limit(1))[0];
if (!strategyVersion || !ruleSet) throw new Error("策略模板或A股规则集尚未初始化。");
const assetIds = new Map(rows.map(row => [row.symbol, row.assetId]));
async function save(mode, result, rule) {
  const now = new Date(); const inserted = await db.insert(backtestRuns).values({ strategyVersionId: strategyVersion.id, ruleSetId: ruleSet.id, mode, status: "completed", startDate: asDate(calendar[0]), endDate: asDate(calendar.at(-1)), dataVersionIds: [DATA_VERSION_ID], configSnapshot: { template: "etf_momentum_rsrs", universe, lookbackDays: LOOKBACK, rsrsWindow: RSRS_WINDOW, rsrsSlopeFloor: 0.85, weeklySignalAtClose: true, executionOnNextTradingOpen: true, regimeVolatilityWindow: 20, regimeVolatilityThreshold: 0.25, strictRule: rule, rebalances: rebalanceDates.length }, qualityResult: sourceVersion.qualityReport, metrics: result.metrics, createdBy: owner.id, startedAt: now, finishedAt: new Date() }); const runId = Number(inserted[0].insertId);
  for (let start = 0; start < result.nav.length; start += 500) await db.insert(backtestNavs).values(result.nav.slice(start, start + 500).map(point => ({ runId, tradeDate: asDate(point.tradeDate), nav: String(point.nav), dailyReturn: String(point.dailyReturn), exposure: String(point.exposure), turnover: String(point.turnover) })));
  const trades = result.trades.map(trade => ({ ...trade, assetId: assetIds.get(trade.symbol) })).filter(trade => trade.assetId); for (let start = 0; start < trades.length; start += 500) await db.insert(backtestTrades).values(trades.slice(start, start + 500).map(trade => ({ runId, assetId: trade.assetId, tradeDate: asDate(trade.tradeDate), side: trade.side, quantity: String(trade.quantity), price: String(trade.price), commission: String(trade.commission), taxes: String(trade.taxes), slippage: String(trade.slippage), status: trade.status, rejectionReason: trade.rejectionReason ?? null })));
  const positions = result.positions.map(position => ({ ...position, assetId: assetIds.get(position.symbol) })).filter(position => position.assetId); for (let start = 0; start < positions.length; start += 500) await db.insert(backtestPositions).values(positions.slice(start, start + 500).map(position => ({ runId, assetId: position.assetId, tradeDate: asDate(position.tradeDate), quantity: String(position.quantity), marketValue: String(position.marketValue), weight: String(position.weight) })));
  return runId;
}
const baselineRunId = await save("baseline", baseline, baselineRule); const strictRunId = await save("strict", strict, strictRule);
console.log(JSON.stringify({ dataVersionId: DATA_VERSION_ID, period: { start: calendar[0], end: calendar.at(-1) }, universe, signalRule: { lookbackDays: LOOKBACK, rsrsWindow: RSRS_WINDOW, rsrsSlopeFloor: 0.85, signalToExecution: "至少一个交易时点" }, rebalances: rebalanceDates.length, baseline: { runId: baselineRunId, metrics: baseline.metrics, trades: baseline.trades.length }, strict: { runId: strictRunId, metrics: strict.metrics, trades: strict.trades.length, rejectedTrades: strict.trades.filter(trade => trade.status === "rejected").length } }, null, 2));
process.exit(0);
