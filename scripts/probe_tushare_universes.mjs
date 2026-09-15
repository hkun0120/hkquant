import { fetchCnCalendar, fetchCnEtfDaily, fetchHkDaily } from "../server/quant/tushare.ts";

const period = { start: "20220101", end: "20220131" };
async function probe(name, action) {
  const startedAt = Date.now();
  try { const rows = await action(); return { name, ok: true, rowCount: rows.length, firstRow: rows[0] ?? null, elapsedMs: Date.now() - startedAt }; }
  catch (error) { return { name, ok: false, error: error instanceof Error ? error.message : "未知错误", elapsedMs: Date.now() - startedAt }; }
}
const result = await Promise.all([
  probe("A股交易日历", () => fetchCnCalendar(period.start, period.end)),
  probe("A股ETF 510300.SH", () => fetchCnEtfDaily("510300.SH", period.start, period.end)),
  probe("港股ETF 02800.HK", () => fetchHkDaily("02800.HK", period.start, period.end)),
]);
console.log(JSON.stringify({ period, result }, null, 2));
