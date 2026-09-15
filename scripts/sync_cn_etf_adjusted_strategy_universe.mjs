import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";
import { persistBars, syncCnCalendar } from "../server/quant/service.ts";
import { fetchCnEtfAdj, fetchCnEtfDaily } from "../server/quant/tushare.ts";

const START = "2020-01-01";
const END = "2022-12-30";
const SYMBOLS = ["510050.SH", "510300.SH", "510500.SH", "512000.SH", "512010.SH", "512100.SH", "518880.SH", "511010.SH"];
const db = await getDb();
if (!db) throw new Error("研究数据库暂不可用。");
const owner = process.env.OWNER_OPEN_ID ? (await db.select().from(users).where(eq(users.openId, process.env.OWNER_OPEN_ID)).limit(1))[0] : (await db.select().from(users).where(eq(users.role, "admin")).limit(1))[0];
if (!owner) throw new Error("未找到项目管理员账户。");

const bars = [];
const failures = [];
await syncCnCalendar(owner.id, START, END);
for (const symbol of SYMBOLS) {
  try {
    const [rawRows, adjustmentRows] = await Promise.all([
      fetchCnEtfDaily(symbol, START.replaceAll("-", ""), END.replaceAll("-", "")),
      fetchCnEtfAdj(symbol, START.replaceAll("-", ""), END.replaceAll("-", "")),
    ]);
    const adjustmentByDate = new Map(adjustmentRows.map(row => [String(row.trade_date), Number(row.adj_factor)]));
    const adjustedRows = rawRows.map(row => {
      const adjustment = adjustmentByDate.get(String(row.trade_date));
      if (!Number.isFinite(adjustment) || adjustment <= 0) throw new Error(`缺少有效复权因子：${String(row.trade_date)}`);
      return {
        symbol: String(row.ts_code), tradeDate: String(row.trade_date),
        open: Number(row.open) * adjustment, high: Number(row.high) * adjustment,
        low: Number(row.low) * adjustment, close: Number(row.close) * adjustment,
        preClose: Number(row.pre_close) * adjustment, volume: Number(row.vol), amount: Number(row.amount),
      };
    });
    if (!adjustedRows.length) failures.push({ symbol, reason: "接口返回空数据" });
    else bars.push(...adjustedRows);
  } catch (error) {
    failures.push({ symbol, reason: error instanceof Error ? error.message : "未知错误" });
  }
}
const result = bars.length ? await persistBars(owner.id, "Tushare Pro · A股ETF复权动量策略池", "CN", "SSE", "CNY", "etf", bars) : null;
console.log(JSON.stringify({ period: { start: START, end: END }, symbols: SYMBOLS, rowCount: bars.length, failures, versionId: result?.version.id ?? null, quality: result?.report ?? null, adjustmentBasis: "fund_daily OHLC × fund_adj adj_factor；成交量与成交额保持原始口径。" }, null, 2));
process.exit(0);
