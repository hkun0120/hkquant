import { fetchCnFinaIndicator } from "../server/quant/tushare.ts";

const sample = "000001.SZ";
try {
  const rows = await fetchCnFinaIndicator(sample, "20190101", "20221231");
  console.log(JSON.stringify({ purpose: "仅探测Tushare A股公告日财务指标权限；样本代码不是策略成分推荐。", sample, status: "available", rowCount: rows.length, first: rows.at(0) ?? null, last: rows.at(-1) ?? null }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ purpose: "仅探测Tushare A股公告日财务指标权限；样本代码不是策略成分推荐。", sample, status: "unavailable", reason: error instanceof Error ? error.message : "未知错误" }, null, 2));
}
process.exit(0);
