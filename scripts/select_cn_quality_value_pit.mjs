import { tushareQuery } from "../server/quant/tushare.ts";

const SNAPSHOTS = [
  { fiscalPeriod: "20191231", signalDate: "20200529", executionDate: "20200601" },
  { fiscalPeriod: "20201231", signalDate: "20210531", executionDate: "20210601" },
  { fiscalPeriod: "20211231", signalDate: "20220531", executionDate: "20220601" },
];
const asNumber = value => Number.isFinite(Number(value)) ? Number(value) : null;
const key = row => String(row.ts_code ?? "");
const isMainBoardIndustrial = row => row.comp_type === "1" && /^(000|001|002|600|601|603)/.test(key(row));

function latestByCode(rows, dateField) {
  const selected = new Map();
  for (const row of rows) {
    const prior = selected.get(key(row));
    if (!prior || String(row[dateField] ?? "") > String(prior[dateField] ?? "")) selected.set(key(row), row);
  }
  return selected;
}

function rankDescending(rows, field) {
  return [...rows].sort((a, b) => b[field] - a[field]).map((row, index) => ({ ...row, [`${field}Rank`]: index + 1 }));
}

const selections = [];
for (const snapshot of SNAPSHOTS) {
  const [indicators, income, balance, valuations] = await Promise.all([
    tushareQuery("fina_indicator_vip", { period: snapshot.fiscalPeriod }, ["ts_code", "ann_date", "end_date", "comp_type", "ebit", "grossprofit_margin", "roic"]),
    tushareQuery("income_vip", { period: snapshot.fiscalPeriod }, ["ts_code", "ann_date", "f_ann_date", "end_date", "comp_type", "total_revenue", "oper_cost", "ebit"]),
    tushareQuery("balancesheet_vip", { period: snapshot.fiscalPeriod }, ["ts_code", "ann_date", "f_ann_date", "end_date", "comp_type", "money_cap", "st_borr", "lt_borr", "bond_payable", "total_assets"]),
    tushareQuery("daily_basic", { trade_date: snapshot.signalDate.replaceAll("-", "") }, ["ts_code", "trade_date", "turnover_rate", "total_mv", "circ_mv"]),
  ]);
  const indicatorByCode = latestByCode(indicators.filter(row => String(row.ann_date ?? "") <= snapshot.signalDate.replaceAll("-", "")), "ann_date");
  const incomeByCode = latestByCode(income.filter(row => String(row.ann_date ?? "") <= snapshot.signalDate.replaceAll("-", "") && isMainBoardIndustrial(row)), "f_ann_date");
  const balanceByCode = latestByCode(balance.filter(row => String(row.ann_date ?? "") <= snapshot.signalDate.replaceAll("-", "") && isMainBoardIndustrial(row)), "f_ann_date");
  const valuationByCode = new Map(valuations.map(row => [key(row), row]));
  const candidates = [];
  for (const [symbol, indicator] of indicatorByCode) {
    const incomeRow = incomeByCode.get(symbol); const balanceRow = balanceByCode.get(symbol); const valuation = valuationByCode.get(symbol);
    if (!incomeRow || !balanceRow || !valuation || !isMainBoardIndustrial(incomeRow) || !isMainBoardIndustrial(balanceRow)) continue;
    const revenue = asNumber(incomeRow.total_revenue); const operatingCost = asNumber(incomeRow.oper_cost); const ebit = asNumber(indicator.ebit) ?? asNumber(incomeRow.ebit); const totalAssets = asNumber(balanceRow.total_assets); const totalMv = asNumber(valuation.total_mv); const cash = asNumber(balanceRow.money_cap); const shortDebt = asNumber(balanceRow.st_borr) ?? 0; const longDebt = asNumber(balanceRow.lt_borr) ?? 0; const bonds = asNumber(balanceRow.bond_payable) ?? 0;
    if (![revenue, operatingCost, ebit, totalAssets, totalMv, cash].every(value => value !== null) || totalAssets <= 0 || totalMv <= 3_000_000 || ebit <= 0 || revenue <= operatingCost) continue;
    const enterpriseValue = totalMv * 10_000 + shortDebt + longDebt + bonds - cash;
    if (enterpriseValue <= 0) continue;
    candidates.push({ symbol, fiscalPeriod: snapshot.fiscalPeriod, announcedAt: String(indicator.ann_date), signalDate: snapshot.signalDate, executionDate: snapshot.executionDate, ebitToEv: ebit / enterpriseValue, grossProfitability: (revenue - operatingCost) / totalAssets, totalMarketValueCny: totalMv * 10_000, enterpriseValueCny: enterpriseValue, roic: asNumber(indicator.roic), turnoverRate: asNumber(valuation.turnover_rate) });
  }
  const withEbitRank = rankDescending(candidates, "ebitToEv");
  const withBothRanks = rankDescending(withEbitRank, "grossProfitability").map(row => ({ ...row, compositeRank: row.ebitToEvRank + row.grossProfitabilityRank })).sort((a, b) => a.compositeRank - b.compositeRank || b.ebitToEv - a.ebitToEv);
  selections.push({ ...snapshot, rawRows: { indicators: indicators.length, income: income.length, balance: balance.length, valuations: valuations.length }, candidateCount: withBothRanks.length, selected: withBothRanks.slice(0, 10) });
}
console.log(JSON.stringify({ purpose: "A股质量价值点时点候选构造；年度财报仅在公告日后，以次一交易日执行。非金融主板、历史总市值至少300亿元、前十等权，仅用于模拟研究。", formula: { ebitToEv: "EBIT / (历史总市值 + 短期借款 + 长期借款 + 应付债券 − 货币资金)", grossProfitability: "(营业总收入 − 营业成本) / 总资产" }, source: "Tushare Pro fina_indicator_vip + income_vip + balancesheet_vip + daily_basic", selections }, null, 2));
process.exit(0);
