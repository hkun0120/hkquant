import type { Market, MarketRuleConfig } from "./types";

export const DEFAULT_MARKET_RULES: Record<Market, MarketRuleConfig> = {
  CN: { commissionRate: 0.0003, minimumCommission: 5, sellTaxRate: 0.001, slippageBps: 8, lotSize: 100, settlementLagDays: 1, priceLimitPct: 0.1, haltHandling: "reject", shortSellingEnabled: false, notes: "A股研究默认：T+1、100股整手、停牌拒单与10%涨跌停假设；板块例外须另建规则集。" },
  US: { commissionRate: 0.0005, minimumCommission: 0, sellTaxRate: 0, slippageBps: 5, lotSize: 1, settlementLagDays: 0, priceLimitPct: null, haltHandling: "reject", shortSellingEnabled: false, notes: "美股研究默认不启用卖空；借券费、可借性与监管限制须在启用卖空前单独配置。" },
  HK: { commissionRate: 0.0008, minimumCommission: 0, sellTaxRate: 0, slippageBps: 8, lotSize: 1, settlementLagDays: 0, priceLimitPct: null, haltHandling: "reject", shortSellingEnabled: false, notes: "港股手数因证券而异；初始规则按资产层最小交易单位覆盖。" },
};

export function transactionCost(notional: number, side: "buy" | "sell", rule: MarketRuleConfig) {
  const commission = Math.max(notional * rule.commissionRate, rule.minimumCommission);
  const taxes = side === "sell" ? notional * rule.sellTaxRate : 0;
  const slippage = notional * (rule.slippageBps / 10_000);
  return { commission, taxes, slippage, total: commission + taxes + slippage };
}

export function roundToLot(quantity: number, lotSize: number) {
  return Math.floor(Math.max(0, quantity) / Math.max(1, lotSize)) * Math.max(1, lotSize);
}
