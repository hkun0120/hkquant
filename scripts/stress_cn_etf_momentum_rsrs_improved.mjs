import { eq } from "drizzle-orm";
import { assets, dailyBars, dataVersions } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";
import { runDailyBacktest } from "../server/quant/backtest.ts";
import { DEFAULT_MARKET_RULES } from "../server/quant/marketRules.ts";

const DATA_VERSION_ID = 330002;
const INITIAL_CAPITAL = 1_000_000;
const UNIVERSE = ["510050.SH", "510300.SH", "510500.SH", "512000.SH", "512010.SH", "512100.SH", "518880.SH", "511010.SH"];
const LOOKBACKS = [40, 60, 80];
const RSRS_FLOORS = [0.8, 0.85];
const TREND_FILTERS = [0, 120];
const RSRS_WINDOW = 18;
const dateKey = value => new Date(value).toISOString().slice(0, 10);
const monthKey = value => value.slice(0, 7);
const mean = xs => xs.reduce((sum, value) => sum + value, 0) / xs.length;
const standardDeviation = xs => Math.sqrt(xs.reduce((sum, value) => sum + (value - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
const slope = points => { const x = points.map(point => point.low); const y = points.map(point => point.high); const mx = mean(x); const my = mean(y); const covariance = points.reduce((sum, point, index) => sum + (x[index] - mx) * (point.high - my), 0); const variance = x.reduce((sum, value) => sum + (value - mx) ** 2, 0); return variance ? covariance / variance : 0; };
const ratio = value => Number(value.toFixed(6));

function yearlyMetrics(nav) {
  return ["2020", "2021", "2022"].map(year => {
    const points = nav.filter(point => point.tradeDate.startsWith(year)); const returns = points.map(point => point.dailyReturn);
    let cumulative = 1; let peak = 1; let maximumDrawdown = 0;
    for (const dailyReturn of returns) { cumulative *= 1 + dailyReturn; peak = Math.max(peak, cumulative); maximumDrawdown = Math.min(maximumDrawdown, cumulative / peak - 1); }
    const volatility = returns.length > 1 ? standardDeviation(returns) * Math.sqrt(252) : 0; const annualized = returns.length ? cumulative ** (252 / returns.length) - 1 : 0;
    return { year, totalReturn: ratio(cumulative - 1), annualizedReturn: ratio(annualized), annualizedVolatility: ratio(volatility), sharpe: ratio(volatility ? annualized / volatility : 0), maximumDrawdown: ratio(maximumDrawdown), tradingDays: returns.length };
  });
}

function targetsFor(parameters, bySymbol, calendar) {
  const monthlyLast = new Map(); calendar.forEach((date, index) => monthlyLast.set(monthKey(date), index));
  const targets = {}; const rebalanceDates = [];
  for (const signalIndex of monthlyLast.values()) {
    const executionDate = calendar[signalIndex + 1];
    if (!executionDate || signalIndex < Math.max(parameters.lookbackDays, parameters.trendFilterDays, RSRS_WINDOW)) continue;
    const candidates = UNIVERSE.map(symbol => {
      const series = bySymbol.get(symbol) ?? []; const point = series.findIndex(row => row.tradeDate === calendar[signalIndex]);
      if (point < parameters.lookbackDays || point < RSRS_WINDOW || point < parameters.trendFilterDays) return null;
      const now = series[point]; const past = series[point - parameters.lookbackDays]; const trendAverage = parameters.trendFilterDays ? mean(series.slice(point - parameters.trendFilterDays + 1, point + 1).map(row => row.close)) : null;
      return { symbol, momentum: now.close / past.close - 1, rsrsSlope: slope(series.slice(point - RSRS_WINDOW + 1, point + 1)), trendPass: trendAverage === null || now.close >= trendAverage };
    }).filter(Boolean).filter(item => item.momentum > 0 && item.rsrsSlope > parameters.rsrsFloor && item.trendPass).sort((a, b) => b.momentum - a.momentum || b.rsrsSlope - a.rsrsSlope);
    targets[executionDate] = candidates[0] ? { [candidates[0].symbol]: 1 } : {};
    rebalanceDates.push(executionDate);
  }
  return { targets, rebalanceDates };
}

const db = await getDb();
if (!db) throw new Error("研究数据库暂不可用。");
const version = (await db.select().from(dataVersions).where(eq(dataVersions.id, DATA_VERSION_ID)).limit(1))[0];
if (!version || version.qualityStatus !== "passed") throw new Error("复权ETF数据版本不存在或未通过质量检查。");
const rows = await db.select({ symbol: assets.symbol, tradeDate: dailyBars.tradeDate, open: dailyBars.open, high: dailyBars.high, low: dailyBars.low, close: dailyBars.close, preClose: dailyBars.preClose, volume: dailyBars.volume, amount: dailyBars.amount }).from(dailyBars).innerJoin(assets, eq(dailyBars.assetId, assets.id)).where(eq(dailyBars.versionId, DATA_VERSION_ID));
const bars = rows.map(row => ({ symbol: row.symbol, tradeDate: dateKey(row.tradeDate), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), preClose: row.preClose === null ? undefined : Number(row.preClose), volume: row.volume === null ? undefined : Number(row.volume), amount: row.amount === null ? undefined : Number(row.amount) })).filter(row => UNIVERSE.includes(row.symbol));
const calendar = [...new Set(bars.map(row => row.tradeDate))].sort();
const bySymbol = new Map(UNIVERSE.map(symbol => [symbol, bars.filter(row => row.symbol === symbol).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))]));
const rule = { ...DEFAULT_MARKET_RULES.CN, sellTaxRate: 0, priceLimitPct: null, notes: "ETF严格口径：T+1、100份整手、0.03%佣金（最低5元）、8bp滑点；国内ETF卖出不计股票印花税。" };
const results = LOOKBACKS.flatMap(lookbackDays => RSRS_FLOORS.flatMap(rsrsFloor => TREND_FILTERS.map(trendFilterDays => {
  const parameters = { lookbackDays, rsrsFloor, trendFilterDays }; const { targets, rebalanceDates } = targetsFor(parameters, bySymbol, calendar); const result = runDailyBacktest({ bars, rebalanceDates, targetWeights: {}, targetWeightsByDate: targets, initialCapital: INITIAL_CAPITAL, rule, strict: true });
  return { ...parameters, rebalances: rebalanceDates.length, trades: result.trades.length, rejectedTrades: result.trades.filter(trade => trade.status === "rejected").length, metrics: Object.fromEntries(Object.entries(result.metrics).map(([key, value]) => [key, typeof value === "number" ? ratio(value) : value])), yearly: yearlyMetrics(result.nav) };
})));
console.log(JSON.stringify({ dataVersionId: DATA_VERSION_ID, source: "Tushare Pro fund_daily × fund_adj", period: { start: calendar[0], end: calendar.at(-1) }, universe: UNIVERSE, execution: "月末收盘信号，下一交易日开盘成交；严格规则含T+1、100份整手、佣金与8bp单边滑点。无符合条件标的时持有现金。", fixedParameters: { rsrsWindow: RSRS_WINDOW }, results }, null, 2));
process.exit(0);
