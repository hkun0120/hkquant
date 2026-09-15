export type Market = "CN" | "US" | "HK";
export type AssetType = "stock" | "etf" | "index" | "future" | "cash";

export type CanonicalBar = {
  symbol: string;
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  preClose?: number | null;
  volume?: number | null;
  amount?: number | null;
};

export type QualityReport = {
  status: "passed" | "warning" | "failed";
  rowCount: number;
  duplicateCount: number;
  missingCount: number;
  invalidOhlcCount: number;
  outOfOrderCount: number;
  coverageStart?: string;
  coverageEnd?: string;
  messages: string[];
};

export type MarketRuleConfig = {
  commissionRate: number;
  minimumCommission: number;
  sellTaxRate: number;
  slippageBps: number;
  lotSize: number;
  settlementLagDays: number;
  priceLimitPct?: number | null;
  haltHandling: "reject" | "carry";
  shortSellingEnabled: boolean;
  notes?: string;
};

export type BacktestMetrics = {
  totalReturn: number;
  annualizedReturn: number;
  annualizedVolatility: number;
  sharpe: number | null;
  maximumDrawdown: number;
  averageTurnover: number;
  tradingDays: number;
};
