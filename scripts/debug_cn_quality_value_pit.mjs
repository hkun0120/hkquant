import { tushareQuery } from "../server/quant/tushare.ts";

const period = "20211231";
const signalDate = "20220531";
const code = row => String(row.ts_code ?? "");
const industrial = row => String(row.comp_type ?? "") === "1" && /^(000|001|002|600|601|603)/.test(code(row));
const latest = (rows, field) => rows.reduce((map, row) => { const existing = map.get(code(row)); if (!existing || String(row[field] ?? "") > String(existing[field] ?? "")) map.set(code(row), row); return map; }, new Map());
const [indicators, income, balance, valuations] = await Promise.all([
  tushareQuery("fina_indicator_vip", { period }, ["ts_code", "ann_date", "end_date", "comp_type", "ebit", "grossprofit_margin", "roic"]),
  tushareQuery("income_vip", { period }, ["ts_code", "ann_date", "f_ann_date", "end_date", "comp_type", "total_revenue", "oper_cost", "ebit"]),
  tushareQuery("balancesheet_vip", { period }, ["ts_code", "ann_date", "f_ann_date", "end_date", "comp_type", "money_cap", "st_borr", "lt_borr", "bond_payable", "total_assets"]),
  tushareQuery("daily_basic", { trade_date: signalDate }, ["ts_code", "trade_date", "turnover_rate", "total_mv", "circ_mv"]),
]);
const i = latest(indicators.filter(row => String(row.ann_date ?? "") <= signalDate), "ann_date");
const n = latest(income.filter(row => String(row.ann_date ?? "") <= signalDate && industrial(row)), "ann_date");
const b = latest(balance.filter(row => String(row.ann_date ?? "") <= signalDate && industrial(row)), "ann_date");
const v = new Map(valuations.map(row => [code(row), row]));
const common = [...i.keys()].filter(symbol => n.has(symbol) && b.has(symbol) && v.has(symbol) && industrial(n.get(symbol)) && industrial(b.get(symbol)));
const diagnostics = common.map(symbol => ({ symbol, ebit: i.get(symbol).ebit ?? n.get(symbol).ebit, revenue: n.get(symbol).total_revenue, operatingCost: n.get(symbol).oper_cost, assets: b.get(symbol).total_assets, cash: b.get(symbol).money_cap, totalMv: v.get(symbol).total_mv }));
const numeric = diagnostics.filter(row => [row.ebit, row.revenue, row.operatingCost, row.assets, row.cash, row.totalMv].every(value => Number.isFinite(Number(value))));
console.log(JSON.stringify({ period, signalDate, counts: { indicators: indicators.length, income: income.length, balance: balance.length, valuations: valuations.length, industrialIndicators: i.size, industrialIncome: n.size, industrialBalance: b.size, intersection: common.length, numeric: numeric.length }, samples: { indicator: indicators.at(0), income: income.at(0), balance: balance.at(0), common: diagnostics.slice(0, 5) } }, null, 2));
process.exit(0);
