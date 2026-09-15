import { and, eq } from "drizzle-orm";
import { users } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";
import { persistBars, syncCnCalendar } from "../server/quant/service.ts";
import { fetchCnEtfDaily, fetchHkDaily } from "../server/quant/tushare.ts";

const START = "2020-01-01";
const END = "2022-12-30";
const CN_ETFS = ["510300.SH", "510500.SH", "512100.SH", "518880.SH", "511010.SH"];
const HK_ETFS = ["02800.HK", "02828.HK", "03033.HK"];

const toBar = row => ({
  symbol: String(row.ts_code), tradeDate: String(row.trade_date), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), preClose: Number(row.pre_close), volume: Number(row.vol), amount: Number(row.amount),
});

async function resolveOwner() {
  const db = await getDb();
  if (!db) throw new Error("研究数据库暂不可用。");
  const byOwner = process.env.OWNER_OPEN_ID ? await db.select().from(users).where(eq(users.openId, process.env.OWNER_OPEN_ID)).limit(1) : [];
  const owner = byOwner[0] ?? (await db.select().from(users).where(eq(users.role, "admin")).limit(1))[0];
  if (!owner) throw new Error("未找到项目所有者账户，请先登录平台完成初始化。");
  return owner.id;
}

async function pullMany(symbols, fetcher) {
  const rows = [];
  const failures = [];
  for (const symbol of symbols) {
    try {
      const result = await fetcher(symbol, START.replaceAll("-", ""), END.replaceAll("-", ""));
      if (!result.length) failures.push({ symbol, reason: "接口返回空数据" }); else rows.push(...result.map(toBar));
    } catch (error) {
      failures.push({ symbol, reason: error instanceof Error ? error.message : "未知错误" });
    }
  }
  return { rows, failures };
}

const ownerId = await resolveOwner();
await syncCnCalendar(ownerId, START, END);
const cn = await pullMany(CN_ETFS, fetchCnEtfDaily);
const hk = await pullMany(HK_ETFS, fetchHkDaily);
const output = { period: { start: START, end: END }, cn: { symbols: CN_ETFS, rows: cn.rows.length, failures: cn.failures }, hk: { symbols: HK_ETFS, rows: hk.rows.length, failures: hk.failures } };
if (cn.rows.length) { const saved = await persistBars(ownerId, "Tushare Pro · A股ETF策略池", "CN", "SSE", "CNY", "etf", cn.rows); output.cn.versionId = saved.version.id; output.cn.quality = saved.report; }
if (hk.rows.length) { const saved = await persistBars(ownerId, "Tushare Pro · 港股ETF策略池", "HK", "HKEX", "HKD", "etf", hk.rows); output.hk.versionId = saved.version.id; output.hk.quality = saved.report; }
console.log(JSON.stringify(output, null, 2));
