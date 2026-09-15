import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";
import { persistBars, syncCnCalendar } from "../server/quant/service.ts";
import { fetchCnEtfDaily } from "../server/quant/tushare.ts";

const START = "2020-01-01";
const END = "2022-12-30";
const SYMBOLS = ["510050.SH", "510300.SH", "510500.SH", "512000.SH", "512010.SH", "512100.SH", "518880.SH", "511010.SH"];
const db = await getDb();
if (!db) throw new Error("研究数据库暂不可用。");
const owner = process.env.OWNER_OPEN_ID ? (await db.select().from(users).where(eq(users.openId, process.env.OWNER_OPEN_ID)).limit(1))[0] : (await db.select().from(users).where(eq(users.role, "admin")).limit(1))[0];
if (!owner) throw new Error("未找到项目管理员账户。");
const bars = []; const failures = [];
await syncCnCalendar(owner.id, START, END);
for (const symbol of SYMBOLS) {
  try {
    const rows = await fetchCnEtfDaily(symbol, START.replaceAll("-", ""), END.replaceAll("-", ""));
    if (!rows.length) failures.push({ symbol, reason: "接口返回空数据" });
    else bars.push(...rows.map(row => ({ symbol: String(row.ts_code), tradeDate: String(row.trade_date), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), preClose: Number(row.pre_close), volume: Number(row.vol), amount: Number(row.amount) })));
  } catch (error) { failures.push({ symbol, reason: error instanceof Error ? error.message : "未知错误" }); }
}
const result = bars.length ? await persistBars(owner.id, "Tushare Pro · A股ETF扩展动量策略池", "CN", "SSE", "CNY", "etf", bars) : null;
console.log(JSON.stringify({ period: { start: START, end: END }, symbols: SYMBOLS, rowCount: bars.length, failures, versionId: result?.version.id ?? null, quality: result?.report ?? null }, null, 2));
process.exit(0);
