import { eq } from "drizzle-orm";
import { assets, dailyBars, dataVersions } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";
import { runDailyBacktest } from "../server/quant/backtest.ts";
import { DEFAULT_MARKET_RULES } from "../server/quant/marketRules.ts";

const DATA_VERSION_ID = 330002;
const RISKY = ["510050.SH", "510300.SH", "510500.SH", "512000.SH", "512010.SH", "512100.SH", "518880.SH"];
const DEFENSIVE = "511010.SH";
const LOOKBACKS = [60, 120];
const RISK_WEIGHTS = [0.3, 0.5, 0.7];
const INITIAL_CAPITAL = 1_000_000;
const dateKey = value => new Date(value).toISOString().slice(0, 10);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const standardDeviation = values => Math.sqrt(values.reduce((sum, value) => sum + (value - mean(values)) ** 2, 0) / Math.max(1, values.length - 1));
const compact = value => Number(value.toFixed(6));
function perYear(nav) {
  return ["2020", "2021", "2022"].map(year => {
    const returns = nav.filter(point => point.tradeDate.startsWith(year)).map(point => point.dailyReturn); let equity = 1; let peak = 1; let drawdown = 0;
    for (const value of returns) { equity *= 1 + value; peak = Math.max(peak, equity); drawdown = Math.min(drawdown, equity / peak - 1); }
    const annual = returns.length ? equity ** (252 / returns.length) - 1 : 0; const volatility = returns.length > 1 ? standardDeviation(returns) * Math.sqrt(252) : 0;
    return { year, totalReturn: compact(equity - 1), sharpe: compact(volatility ? annual / volatility : 0), maximumDrawdown: compact(drawdown) };
  });
}
const db = await getDb();
if (!db) throw new Error("研究数据库暂不可用。");
const version = (await db.select().from(dataVersions).where(eq(dataVersions.id, DATA_VERSION_ID)).limit(1))[0];
if (!version || version.qualityStatus !== "passed") throw new Error("复权ETF数据版本不存在或未通过质量检查。");
const rows = await db.select({ symbol: assets.symbol, tradeDate: dailyBars.tradeDate, open: dailyBars.open, high: dailyBars.high, low: dailyBars.low, close: dailyBars.close, preClose: dailyBars.preClose, volume: dailyBars.volume, amount: dailyBars.amount }).from(dailyBars).innerJoin(assets, eq(dailyBars.assetId, assets.id)).where(eq(dailyBars.versionId, DATA_VERSION_ID));
const universe = [...RISKY, DEFENSIVE];
const bars = rows.map(row => ({ symbol: row.symbol, tradeDate: dateKey(row.tradeDate), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), preClose: row.preClose === null ? undefined : Number(row.preClose), volume: row.volume === null ? undefined : Number(row.volume), amount: row.amount === null ? undefined : Number(row.amount) })).filter(row => universe.includes(row.symbol));
const calendar = [...new Set(bars.map(row => row.tradeDate))].sort();
const bySymbol = new Map(universe.map(symbol => [symbol, bars.filter(row => row.symbol === symbol).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))]));
const monthlyLast = new Map(); calendar.forEach((tradeDate, index) => monthlyLast.set(tradeDate.slice(0, 7), index));
const rule = { ...DEFAULT_MARKET_RULES.CN, sellTaxRate: 0, priceLimitPct: null, notes: "ETF严格口径：T+1、100份整手、0.03%佣金（最低5元）与8bp单边滑点；ETF卖出不计股票印花税。" };
const results = [];
for (const lookbackDays of LOOKBACKS) for (const riskWeight of RISK_WEIGHTS) {
  const targets = {}; const rebalanceDates = [];
  for (const signalIndex of monthlyLast.values()) {
    const executionDate = calendar[signalIndex + 1]; if (!executionDate || signalIndex < lookbackDays) continue;
    const eligible = RISKY.map(symbol => { const series = bySymbol.get(symbol); const point = series?.findIndex(row => row.tradeDate === calendar[signalIndex]) ?? -1; if (point < lookbackDays) return null; const close = series[point].close; return { symbol, momentum: close / series[point - lookbackDays].close - 1, trendPass: close >= mean(series.slice(point - lookbackDays + 1, point + 1).map(row => row.close)) }; }).filter(Boolean).filter(item => item.momentum > 0 && item.trendPass).sort((a, b) => b.momentum - a.momentum);
    targets[executionDate] = eligible[0] ? { [eligible[0].symbol]: riskWeight, [DEFENSIVE]: 1 - riskWeight } : { [DEFENSIVE]: 1 };
    rebalanceDates.push(executionDate);
  }
  const result = runDailyBacktest({ bars, rebalanceDates, targetWeights: {}, targetWeightsByDate: targets, initialCapital: INITIAL_CAPITAL, rule, strict: true });
  results.push({ lookbackDays, riskWeight, rebalances: rebalanceDates.length, trades: result.trades.length, rejectedTrades: result.trades.filter(trade => trade.status === "rejected").length, metrics: Object.fromEntries(Object.entries(result.metrics).map(([key, value]) => [key, typeof value === "number" ? compact(value) : value])), yearly: perYear(result.nav) });
}
console.log(JSON.stringify({ dataVersionId: DATA_VERSION_ID, period: { start: calendar[0], end: calendar.at(-1) }, universe: { risky: RISKY, defensive: DEFENSIVE }, rule: "月末收盘信号、下一交易日开盘成交；每期选择正动量且高于自身趋势均线的最高动量风险ETF，按风险权重配置，其余配置国债ETF；无合格风险ETF时100%国债ETF。", results }, null, 2));
process.exit(0);
