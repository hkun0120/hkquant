import { roundToLot, transactionCost } from "./marketRules";
import type { BacktestMetrics, CanonicalBar, MarketRuleConfig } from "./types";

export type TargetWeights = Record<string, number>;
export type BacktestTrade = { tradeDate: string; symbol: string; side: "buy" | "sell"; quantity: number; price: number; commission: number; taxes: number; slippage: number; status: "filled" | "rejected"; rejectionReason?: string };
export type BacktestPoint = { tradeDate: string; nav: number; dailyReturn: number; exposure: number; turnover: number };
export type BacktestPosition = { tradeDate: string; symbol: string; quantity: number; marketValue: number; weight: number };
export type BacktestResult = { nav: BacktestPoint[]; trades: BacktestTrade[]; positions: BacktestPosition[]; metrics: BacktestMetrics };

function strictRejection(bar: CanonicalBar, side: "buy" | "sell", rule: MarketRuleConfig) {
  if (bar.volume !== undefined && bar.volume !== null && bar.volume <= 0) return "停牌或零成交量：严格模式拒绝成交";
  if (!rule.priceLimitPct || !bar.preClose || bar.preClose <= 0) return undefined;
  const upper = bar.preClose * (1 + rule.priceLimitPct);
  const lower = bar.preClose * (1 - rule.priceLimitPct);
  if (side === "buy" && bar.open >= upper - 1e-6) return "涨停开盘：严格模式拒绝买入";
  if (side === "sell" && bar.open <= lower + 1e-6) return "跌停开盘：严格模式拒绝卖出";
  return undefined;
}

export function runDailyBacktest(input: { bars: CanonicalBar[]; rebalanceDates: string[]; targetWeights: TargetWeights; targetWeightsByDate?: Record<string, TargetWeights>; initialCapital: number; rule: MarketRuleConfig; strict: boolean }) : BacktestResult {
  const grouped = new Map<string, CanonicalBar[]>();
  input.bars.forEach(bar => grouped.set(bar.tradeDate, [...(grouped.get(bar.tradeDate) ?? []), bar]));
  const dates = Array.from(grouped.keys()).sort();
  let cash = input.initialCapital;
  let priorNav = cash;
  const positions = new Map<string, number>();
  const nav: BacktestPoint[] = [];
  const trades: BacktestTrade[] = [];
  const positionSnapshots: BacktestPosition[] = [];
  const rebalance = new Set(input.rebalanceDates);
  const purchaseDate = new Map<string, string>();
  const lastClose = new Map<string, number>();

  for (const date of dates) {
    const bars = grouped.get(date)!;
    const bySymbol = new Map(bars.map(bar => [bar.symbol, bar]));
    let turnover = 0;
    if (rebalance.has(date)) {
      const targetWeights = input.targetWeightsByDate?.[date] ?? input.targetWeights;
      const currentNav = cash + Array.from(positions.entries()).reduce((sum, [symbol, quantity]) => sum + quantity * (bySymbol.get(symbol)?.open ?? lastClose.get(symbol) ?? 0), 0);
      for (const [symbol, quantity] of Array.from(positions.entries())) {
        if (targetWeights[symbol] || !bySymbol.has(symbol)) continue;
        const bar = bySymbol.get(symbol)!;
        if (input.strict && input.rule.settlementLagDays > 0 && purchaseDate.get(symbol) === date) {
          trades.push({ tradeDate: date, symbol, side: "sell", quantity, price: bar.open, commission: 0, taxes: 0, slippage: 0, status: "rejected", rejectionReason: "T+1约束：当日买入不可卖出" });
          continue;
        }
        const rejectionReason = input.strict ? strictRejection(bar, "sell", input.rule) : undefined;
        if (rejectionReason) { trades.push({ tradeDate: date, symbol, side: "sell", quantity, price: bar.open, commission: 0, taxes: 0, slippage: 0, status: "rejected", rejectionReason }); continue; }
        const notional = quantity * bar.open;
        const cost = transactionCost(notional, "sell", input.rule);
        cash += notional - cost.total; turnover += notional; positions.delete(symbol);
        trades.push({ tradeDate: date, symbol, side: "sell", quantity, price: bar.open, commission: cost.commission, taxes: cost.taxes, slippage: cost.slippage, status: "filled" });
      }
      for (const [symbol, weight] of Object.entries(targetWeights)) {
        const bar = bySymbol.get(symbol); if (!bar) continue;
        const targetValue = currentNav * weight;
        const currentValue = (positions.get(symbol) ?? 0) * bar.open;
        let quantity = roundToLot((targetValue - currentValue) / bar.open, input.rule.lotSize);
        if (quantity <= 0) continue;
        const rejectionReason = input.strict ? strictRejection(bar, "buy", input.rule) : undefined;
        if (rejectionReason) { trades.push({ tradeDate: date, symbol, side: "buy", quantity, price: bar.open, commission: 0, taxes: 0, slippage: 0, status: "rejected", rejectionReason }); continue; }
        const proportionalUnitCost = bar.open * (1 + input.rule.commissionRate + input.rule.slippageBps / 10_000);
        const cashAfterMinimumCommission = Math.max(0, cash - input.rule.minimumCommission);
        const affordableByRate = cash / proportionalUnitCost;
        const affordableByMinimum = cashAfterMinimumCommission / (bar.open * (1 + input.rule.slippageBps / 10_000));
        quantity = Math.min(quantity, roundToLot(Math.max(0, Math.min(affordableByRate, affordableByMinimum)), input.rule.lotSize));
        if (quantity <= 0) continue;
        let notional = quantity * bar.open;
        let cost = transactionCost(notional, "buy", input.rule);
        if (cash < notional + cost.total) { quantity -= input.rule.lotSize; notional = quantity * bar.open; cost = transactionCost(notional, "buy", input.rule); }
        if (quantity <= 0) continue;
        cash -= notional + cost.total; turnover += notional; positions.set(symbol, (positions.get(symbol) ?? 0) + quantity); purchaseDate.set(symbol, date);
        trades.push({ tradeDate: date, symbol, side: "buy", quantity, price: bar.open, commission: cost.commission, taxes: cost.taxes, slippage: cost.slippage, status: "filled" });
      }
    }
    bars.forEach(bar => lastClose.set(bar.symbol, bar.close));
    const total = cash + Array.from(positions.entries()).reduce((sum, [symbol, quantity]) => sum + quantity * (bySymbol.get(symbol)?.close ?? lastClose.get(symbol) ?? 0), 0);
    Array.from(positions.entries()).forEach(([symbol, quantity]) => {
      const marketValue = quantity * (bySymbol.get(symbol)?.close ?? lastClose.get(symbol) ?? 0);
      positionSnapshots.push({ tradeDate: date, symbol, quantity, marketValue, weight: total ? marketValue / total : 0 });
    });
    nav.push({ tradeDate: date, nav: total, dailyReturn: priorNav ? total / priorNav - 1 : 0, exposure: total ? (total - cash) / total : 0, turnover: priorNav ? turnover / priorNav : 0 }); priorNav = total;
  }
  return { nav, trades, positions: positionSnapshots, metrics: calculateMetrics(nav) };
}

export function calculateMetrics(nav: BacktestPoint[]): BacktestMetrics {
  if (!nav.length) return { totalReturn: 0, annualizedReturn: 0, annualizedVolatility: 0, sharpe: null, maximumDrawdown: 0, averageTurnover: 0, tradingDays: 0 };
  const returns = nav.slice(1).map(point => point.dailyReturn);
  const totalReturn = nav.at(-1)!.nav / nav[0].nav - 1;
  const annualizedReturn = Math.pow(1 + totalReturn, 252 / Math.max(1, returns.length)) - 1;
  const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length);
  const std = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1));
  let peak = -Infinity; let maxDrawdown = 0;
  nav.forEach(point => { peak = Math.max(peak, point.nav); maxDrawdown = Math.min(maxDrawdown, point.nav / peak - 1); });
  return { totalReturn, annualizedReturn, annualizedVolatility: std * Math.sqrt(252), sharpe: std ? mean / std * Math.sqrt(252) : null, maximumDrawdown: maxDrawdown, averageTurnover: nav.reduce((sum, point) => sum + point.turnover, 0) / nav.length, tradingDays: nav.length };
}
