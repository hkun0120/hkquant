import { fetchUsDaily, fetchUsFinaIndicator } from "../server/quant/tushare.ts";

const sample = "AAPL";
async function inspect(label, request) {
  try {
    const rows = await request();
    return { status: "available", rowCount: rows.length, first: rows.at(0) ?? null, last: rows.at(-1) ?? null };
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : "未知错误" };
  }
}

const result = {
  purpose: "仅探测Tushare美股历史日线与公告日财务指标的访问权限；AAPL不是策略成分推荐。",
  entity: sample,
  daily: await inspect("us_daily", () => fetchUsDaily(sample, "20220101", "20220131")),
  fundamentals: await inspect("us_fina_indicator", () => fetchUsFinaIndicator(sample, "20200101", "20221231")),
};
console.log(JSON.stringify(result, null, 2));
process.exit(0);
