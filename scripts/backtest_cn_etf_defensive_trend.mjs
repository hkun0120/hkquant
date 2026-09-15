import { and, eq } from "drizzle-orm";
import { assets, backtestNavs, backtestPositions, backtestRuns, backtestTrades, dailyBars, dataVersions, marketRuleSets, strategies, strategyVersions, users } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";
import { runDailyBacktest } from "../server/quant/backtest.ts";
import { DEFAULT_MARKET_RULES } from "../server/quant/marketRules.ts";

const DATA_VERSION_ID = 330002;
const RISKY = ["510050.SH", "510300.SH", "510500.SH", "512000.SH", "512010.SH", "512100.SH", "518880.SH"];
const DEFENSIVE = "511010.SH";
const LOOKBACK = 60;
const RISK_WEIGHT = 0.5;
const INITIAL_CAPITAL = 1_000_000;
const dateKey = value => new Date(value).toISOString().slice(0, 10);
const asDate = value => new Date(`${value}T00:00:00.000Z`);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const db = await getDb();
if (!db) throw new Error("研究数据库暂不可用。");
const owner = process.env.OWNER_OPEN_ID ? (await db.select().from(users).where(eq(users.openId, process.env.OWNER_OPEN_ID)).limit(1))[0] : (await db.select().from(users).where(eq(users.role, "admin")).limit(1))[0];
if (!owner) throw new Error("未找到项目管理员账户。");
const sourceVersion = (await db.select().from(dataVersions).where(eq(dataVersions.id, DATA_VERSION_ID)).limit(1))[0];
if (!sourceVersion || sourceVersion.qualityStatus !== "passed") throw new Error("复权ETF数据版本不存在或未通过质量检查。");
const rows = await db.select({ assetId: assets.id, symbol: assets.symbol, tradeDate: dailyBars.tradeDate, open: dailyBars.open, high: dailyBars.high, low: dailyBars.low, close: dailyBars.close, preClose: dailyBars.preClose, volume: dailyBars.volume, amount: dailyBars.amount }).from(dailyBars).innerJoin(assets, eq(dailyBars.assetId, assets.id)).where(eq(dailyBars.versionId, DATA_VERSION_ID));
const universe = [...RISKY, DEFENSIVE];
const bars = rows.map(row => ({ symbol: row.symbol, tradeDate: dateKey(row.tradeDate), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), preClose: row.preClose === null ? undefined : Number(row.preClose), volume: row.volume === null ? undefined : Number(row.volume), amount: row.amount === null ? undefined : Number(row.amount) })).filter(row => universe.includes(row.symbol));
const calendar = [...new Set(bars.map(row => row.tradeDate))].sort();
const bySymbol = new Map(universe.map(symbol => [symbol, bars.filter(row => row.symbol === symbol).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))]));
const monthlyLast = new Map(); calendar.forEach((tradeDate, index) => monthlyLast.set(tradeDate.slice(0, 7), index));
const targets = {}; const rebalances = [];
for (const signalIndex of monthlyLast.values()) {
  const executionDate = calendar[signalIndex + 1]; if (!executionDate || signalIndex < LOOKBACK) continue;
  const eligible = RISKY.map(symbol => { const series = bySymbol.get(symbol); const point = series?.findIndex(row => row.tradeDate === calendar[signalIndex]) ?? -1; if (point < LOOKBACK) return null; const close = series[point].close; return { symbol, momentum: close / series[point - LOOKBACK].close - 1, trendPass: close >= mean(series.slice(point - LOOKBACK + 1, point + 1).map(row => row.close)) }; }).filter(Boolean).filter(item => item.momentum > 0 && item.trendPass).sort((a, b) => b.momentum - a.momentum);
  targets[executionDate] = eligible[0] ? { [eligible[0].symbol]: RISK_WEIGHT, [DEFENSIVE]: 1 - RISK_WEIGHT } : { [DEFENSIVE]: 1 };
  rebalances.push(executionDate);
}
const strictRule = { ...DEFAULT_MARKET_RULES.CN, sellTaxRate: 0, priceLimitPct: null, notes: "ETF严格口径：T+1、100份整手、0.03%佣金（最低5元）、8bp单边滑点；ETF卖出不计股票印花税。" };
const baselineRule = { ...strictRule, commissionRate: 0, minimumCommission: 0, slippageBps: 0, settlementLagDays: 0, lotSize: 1 };
const base = { bars, rebalanceDates: rebalances, targetWeights: {}, targetWeightsByDate: targets, initialCapital: INITIAL_CAPITAL };
const baseline = runDailyBacktest({ ...base, rule: baselineRule, strict: false }); const strict = runDailyBacktest({ ...base, rule: strictRule, strict: true });
const strategy = (await db.select().from(strategies).where(eq(strategies.slug, "etf-momentum-rsrs")).limit(1))[0];
const strategyVersion = strategy ? (await db.select().from(strategyVersions).where(and(eq(strategyVersions.strategyId, strategy.id), eq(strategyVersions.version, 1))).limit(1))[0] : null;
const ruleSet = (await db.select().from(marketRuleSets).where(and(eq(marketRuleSets.market, "CN"), eq(marketRuleSets.active, true))).limit(1))[0];
if (!strategyVersion || !ruleSet) throw new Error("ETF策略模板或A股规则集尚未初始化。");
const assetIds = new Map(rows.map(row => [row.symbol, row.assetId]));
async function save(mode, result, rule) {
  const now = new Date(); const inserted = await db.insert(backtestRuns).values({ strategyVersionId: strategyVersion.id, ruleSetId: ruleSet.id, mode, status: "completed", startDate: asDate(calendar[0]), endDate: asDate(calendar.at(-1)), dataVersionIds: [DATA_VERSION_ID], configSnapshot: { template: "defensive_etf_trend", riskyUniverse: RISKY, defensiveSymbol: DEFENSIVE, lookbackDays: LOOKBACK, riskWeight: RISK_WEIGHT, selectionRule: "月末选择正60日动量且高于60日均线的最高动量风险ETF；其余配国债ETF；无合格风险资产时100%国债ETF。", signalAtCloseExecutionNextOpen: true, strictRule: rule }, qualityResult: sourceVersion.qualityReport, metrics: result.metrics, createdBy: owner.id, startedAt: now, finishedAt: new Date() }); const runId = Number(inserted[0].insertId);
  for (let index = 0; index < result.nav.length; index += 500) await db.insert(backtestNavs).values(result.nav.slice(index, index + 500).map(point => ({ runId, tradeDate: asDate(point.tradeDate), nav: String(point.nav), dailyReturn: String(point.dailyReturn), exposure: String(point.exposure), turnover: String(point.turnover) })));
  const trades = result.trades.map(trade => ({ ...trade, assetId: assetIds.get(trade.symbol) })).filter(trade => trade.assetId); for (let index = 0; index < trades.length; index += 500) await db.insert(backtestTrades).values(trades.slice(index, index + 500).map(trade => ({ runId, assetId: trade.assetId, tradeDate: asDate(trade.tradeDate), side: trade.side, quantity: String(trade.quantity), price: String(trade.price), commission: String(trade.commission), taxes: String(trade.taxes), slippage: String(trade.slippage), status: trade.status, rejectionReason: trade.rejectionReason ?? null })));
  const positions = result.positions.map(position => ({ ...position, assetId: assetIds.get(position.symbol) })).filter(position => position.assetId); for (let index = 0; index < positions.length; index += 500) await db.insert(backtestPositions).values(positions.slice(index, index + 500).map(position => ({ runId, assetId: position.assetId, tradeDate: asDate(position.tradeDate), quantity: String(position.quantity), marketValue: String(position.marketValue), weight: String(position.weight) })));
  return runId;
}
const baselineRunId = await save("baseline", baseline, baselineRule); const strictRunId = await save("strict", strict, strictRule);
console.log(JSON.stringify({ dataVersionId: DATA_VERSION_ID, period: { start: calendar[0], end: calendar.at(-1) }, candidate: { lookbackDays: LOOKBACK, riskWeight: RISK_WEIGHT, rebalances: rebalances.length, riskyUniverse: RISKY, defensiveSymbol: DEFENSIVE }, baseline: { runId: baselineRunId, metrics: baseline.metrics, trades: baseline.trades.length }, strict: { runId: strictRunId, metrics: strict.metrics, trades: strict.trades.length, rejectedTrades: strict.trades.filter(trade => trade.status === "rejected").length } }, null, 2));
process.exit(0);
