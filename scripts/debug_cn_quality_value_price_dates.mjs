import { eq } from "drizzle-orm";
import { dailyBars } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";

const db = await getDb();
if (!db) throw new Error("研究数据库暂不可用。");
const rows = await db.select({ tradeDate: dailyBars.tradeDate }).from(dailyBars).where(eq(dailyBars.versionId, 360002)).limit(12);
const dateKey = value => new Date(value).toISOString().slice(0, 10);
console.log(JSON.stringify(rows.map(row => ({ raw: row.tradeDate, type: typeof row.tradeDate, constructor: row.tradeDate?.constructor?.name, iso: row.tradeDate instanceof Date ? row.tradeDate.toISOString() : null, dateKey: dateKey(row.tradeDate) })), null, 2));
process.exit(0);
