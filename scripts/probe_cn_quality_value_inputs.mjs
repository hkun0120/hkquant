import { tushareQuery } from "../server/quant/tushare.ts";

async function inspect(label, request, summarize) {
  try {
    const rows = await request();
    return { status: "available", rowCount: rows.length, ...summarize(rows) };
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : "未知错误" };
  }
}

const result = {
  purpose: "仅探测A股质量价值因子所需的批量公告日资产负债表和历史总市值权限；不生成策略持仓。",
  balancesheetVip: await inspect("balancesheet_vip", () => tushareQuery("balancesheet_vip", { period: "20221231" }, ["ts_code", "ann_date", "f_ann_date", "end_date", "comp_type", "money_cap", "st_borr", "lt_borr", "bond_payable", "total_liab"]), rows => ({ rowsWithAnnouncementDate: rows.filter(row => String(row.ann_date ?? "").length === 8).length, first: rows.at(0) ?? null })),
  dailyBasic: await inspect("daily_basic", () => tushareQuery("daily_basic", { trade_date: "20221230" }, ["ts_code", "trade_date", "close", "turnover_rate", "total_mv", "circ_mv"]), rows => ({ rowsWithTotalMarketValue: rows.filter(row => Number.isFinite(Number(row.total_mv)) && Number(row.total_mv) > 0).length, first: rows.at(0) ?? null })),
};
console.log(JSON.stringify(result, null, 2));
process.exit(0);
