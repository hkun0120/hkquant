import { describe, expect, it } from "vitest";
import { runDailyBacktest } from "./backtest";
import { DEFAULT_MARKET_RULES, roundToLot, transactionCost } from "./marketRules";
import { assertStrictRunAllowed, validateDailyBars } from "./quality";

const bars = [
  { symbol: "510300.SH", tradeDate: "2022-01-03", open: 4, high: 4.1, low: 3.9, close: 4.05, volume: 1000 },
  { symbol: "510300.SH", tradeDate: "2022-01-04", open: 4.05, high: 4.2, low: 4, close: 4.15, volume: 1100 },
  { symbol: "510300.SH", tradeDate: "2022-01-05", open: 4.15, high: 4.3, low: 4.1, close: 4.2, volume: 1200 },
];

describe("数据质量与严格回测规则", () => {
  it("识别重复记录、时间逆序和无效OHLC", () => {
    const report = validateDailyBars([...bars, { ...bars[0] }, { ...bars[1], tradeDate: "2021-12-31", high: 3, low: 4 }]);
    expect(report.status).toBe("failed");
    expect(report.duplicateCount).toBe(1);
    expect(report.outOfOrderCount).toBeGreaterThan(0);
    expect(report.invalidOhlcCount).toBeGreaterThan(0);
  });

  it("拒绝前视数据与同一时点成交", () => {
    const report = validateDailyBars(bars);
    expect(() => assertStrictRunAllowed(report, new Date("2022-01-04"), new Date("2022-01-03"), new Date("2022-01-04"))).toThrow("前视风险");
    expect(() => assertStrictRunAllowed(report, new Date("2022-01-03"), new Date("2022-01-03"), new Date("2022-01-03"))).toThrow("晚于信号");
  });

  it("接受供应商统一倒序的日线返回", () => {
    const report = validateDailyBars([...bars].reverse());
    expect(report.status).toBe("passed");
    expect(report.outOfOrderCount).toBe(0);
  });
});

describe("日频模拟成交", () => {
  it("应用A股整手、佣金、税费和严格T+1拒单规则", () => {
    expect(roundToLot(260, 100)).toBe(200);
    expect(transactionCost(10_000, "sell", DEFAULT_MARKET_RULES.CN).taxes).toBe(10);
    const result = runDailyBacktest({ bars, rebalanceDates: ["2022-01-03", "2022-01-04"], targetWeights: { "510300.SH": 1 }, initialCapital: 100_000, rule: DEFAULT_MARKET_RULES.CN, strict: true });
    expect(result.nav).toHaveLength(3);
    expect(result.trades.some(trade => trade.status === "filled")).toBe(true);
    expect(result.metrics.tradingDays).toBe(3);
  });

  it("在交易成本存在时将买入规模调整为可支付的整手", () => {
    const result = runDailyBacktest({ bars, rebalanceDates: ["2022-01-03"], targetWeights: { "510300.SH": 1 }, initialCapital: 100_000, rule: DEFAULT_MARKET_RULES.CN, strict: true });
    const purchase = result.trades.find(trade => trade.side === "buy" && trade.status === "filled");
    expect(purchase).toBeTruthy();
    expect(purchase!.quantity % 100).toBe(0);
    expect(purchase!.quantity * purchase!.price + purchase!.commission + purchase!.slippage).toBeLessThanOrEqual(100_000);
  });

  it("在高价标的与最低佣金条件下立即计算可支付整手", () => {
    const highPriceBars = [{ symbol: "511010.SH", tradeDate: "2022-01-03", open: 129, high: 130, low: 128, close: 129, volume: 1_000 }];
    const result = runDailyBacktest({ bars: highPriceBars, rebalanceDates: ["2022-01-03"], targetWeights: { "511010.SH": 1 }, initialCapital: 10_000, rule: DEFAULT_MARKET_RULES.CN, strict: true });
    const purchase = result.trades.find(trade => trade.side === "buy" && trade.status === "filled");
    expect(purchase).toBeUndefined();
  });

  it("在严格模式下拒绝停牌和涨跌停开盘成交", () => {
    const limitBars = [
      { symbol: "000001.SZ", tradeDate: "2022-01-03", open: 11, high: 11, low: 10.8, close: 11, preClose: 10, volume: 1000 },
      { symbol: "000001.SZ", tradeDate: "2022-01-04", open: 11, high: 11, low: 11, close: 11, preClose: 10, volume: 0 },
    ];
    const result = runDailyBacktest({ bars: limitBars, rebalanceDates: ["2022-01-03", "2022-01-04"], targetWeights: { "000001.SZ": 1 }, initialCapital: 100_000, rule: DEFAULT_MARKET_RULES.CN, strict: true });
    expect(result.trades.every(trade => trade.status === "rejected")).toBe(true);
    expect(result.trades.map(trade => trade.rejectionReason).join(" ")).toMatch(/涨停|停牌/);
  });
});
