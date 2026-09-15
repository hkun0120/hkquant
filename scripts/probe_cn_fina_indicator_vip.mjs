import { tushareQuery } from "../server/quant/tushare.ts";

try {
  const rows = await tushareQuery("fina_indicator_vip", { period: "20221231" }, ["ts_code", "ann_date", "end_date", "ebit", "grossprofit_margin", "roic", "debt_to_assets"]);
  const nonFinancialWithEbit = rows.filter(row => Number.isFinite(Number(row.ebit)) && Number.isFinite(Number(row.grossprofit_margin))).length;
  console.log(JSON.stringify({ purpose: "仅探测A股季度全市场点时点财务指标权限与字段覆盖；不形成策略交易名单。", endpoint: "fina_indicator_vip", period: "20221231", status: "available", rowCount: rows.length, rowsWithEbitAndGrossMargin: nonFinancialWithEbit, first: rows.at(0) ?? null }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ purpose: "仅探测A股季度全市场点时点财务指标权限与字段覆盖；不形成策略交易名单。", endpoint: "fina_indicator_vip", period: "20221231", status: "unavailable", reason: error instanceof Error ? error.message : "未知错误" }, null, 2));
}
process.exit(0);
