import { readFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { assets, dailyBars, dataSources, dataVersions, users } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";
import { fetchCnAdjFactor, fetchCnDaily } from "../server/quant/tushare.ts";
import { validateDailyBars } from "../server/quant/quality.ts";

const START = "2020-06-01";
const END = "2022-12-30";
const selection = JSON.parse(await readFile(new URL("../research_outputs_cn_quality_value_pit_selection.json", import.meta.url), "utf8"));
const symbols = [...new Set(selection.selections.flatMap(snapshot => snapshot.selected.map(item => item.symbol)))].sort();
const date = value => new Date(`${value}T00:00:00.000Z`);
const normalizedDate = value => { const raw = String(value); return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw; };
const db = await getDb();
if (!db) throw new Error("研究数据库暂不可用。");
const owner = process.env.OWNER_OPEN_ID ? (await db.select().from(users).where(eq(users.openId, process.env.OWNER_OPEN_ID)).limit(1))[0] : (await db.select().from(users).where(eq(users.role, "admin")).limit(1))[0];
if (!owner) throw new Error("未找到项目管理员账户。");
let source = (await db.select().from(dataSources).where(eq(dataSources.name, "Tushare Pro · A股质量价值复权策略池")).limit(1))[0];
if (!source) { await db.insert(dataSources).values({ name: "Tushare Pro · A股质量价值复权策略池", kind: "tushare", market: "CN", serverManaged: true, syncStatus: "running" }); source = (await db.select().from(dataSources).where(eq(dataSources.name, "Tushare Pro · A股质量价值复权策略池")).limit(1))[0]; }
const bars = []; const failures = [];
for (const symbol of symbols) {
  try {
    const [rawRows, adjustmentRows] = await Promise.all([
      fetchCnDaily(symbol, START.replaceAll("-", ""), END.replaceAll("-", "")),
      fetchCnAdjFactor(symbol, START.replaceAll("-", ""), END.replaceAll("-", "")),
    ]);
    const adjustmentByDate = new Map(adjustmentRows.map(row => [String(row.trade_date), Number(row.adj_factor)]));
    if (!rawRows.length) throw new Error("日线接口返回空数据");
    for (const row of rawRows) {
      const factor = adjustmentByDate.get(String(row.trade_date));
      if (!Number.isFinite(factor) || factor <= 0) throw new Error(`缺少有效复权因子：${String(row.trade_date)}`);
      bars.push({ symbol, tradeDate: String(row.trade_date), open: Number(row.open) * factor, high: Number(row.high) * factor, low: Number(row.low) * factor, close: Number(row.close) * factor, preClose: Number(row.pre_close) * factor, volume: Number(row.vol), amount: Number(row.amount) });
    }
  } catch (error) { failures.push({ symbol, reason: error instanceof Error ? error.message : "未知错误" }); }
}
if (failures.length) { await db.update(dataSources).set({ syncStatus: "failed" }).where(eq(dataSources.id, source.id)); console.log(JSON.stringify({ status: "failed", symbols, failures }, null, 2)); process.exit(1); }
const report = validateDailyBars(bars);
if (report.status === "failed") { await db.update(dataSources).set({ syncStatus: "failed" }).where(eq(dataSources.id, source.id)); console.log(JSON.stringify({ status: "failed", reason: "质量检查失败", report }, null, 2)); process.exit(1); }
const tag = `cn-quality-value-adjusted-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
await db.insert(dataVersions).values({ sourceId: source.id, dataset: "daily_bars", market: "CN", versionTag: tag, fetchedAt: new Date(), availableAt: new Date(), coverageStart: date(START), coverageEnd: date(END), rowCount: bars.length, qualityStatus: report.status, qualityReport: { ...report, adjustmentBasis: "daily OHLC × adj_factor；成交量和成交额保持原始口径。", purpose: "A股质量价值点时点候选的模拟回测价格版本。" }, createdBy: owner.id });
const version = (await db.select().from(dataVersions).where(eq(dataVersions.versionTag, tag)).limit(1))[0];
const existingAssets = await db.select().from(assets).where(and(eq(assets.market, "CN"), inArray(assets.symbol, symbols)));
const assetBySymbol = new Map(existingAssets.map(asset => [asset.symbol, asset]));
for (const symbol of symbols.filter(symbol => !assetBySymbol.has(symbol))) {
  const exchange = symbol.endsWith(".SH") ? "SSE" : "SZSE";
  await db.insert(assets).values({ market: "CN", assetType: "stock", symbol, exchange, currency: "CNY", active: true });
  const inserted = (await db.select().from(assets).where(and(eq(assets.market, "CN"), eq(assets.exchange, exchange), eq(assets.symbol, symbol))).limit(1))[0];
  if (inserted) assetBySymbol.set(symbol, inserted);
}
const stored = bars.map(row => ({ assetId: assetBySymbol.get(row.symbol)?.id, versionId: version.id, tradeDate: date(normalizedDate(row.tradeDate)), open: String(row.open), high: String(row.high), low: String(row.low), close: String(row.close), preClose: String(row.preClose), volume: String(row.volume), amount: String(row.amount) })).filter(row => row.assetId);
for (let index = 0; index < stored.length; index += 500) await db.insert(dailyBars).values(stored.slice(index, index + 500));
await db.update(dataSources).set({ syncStatus: "success", lastSyncedAt: new Date() }).where(eq(dataSources.id, source.id));
console.log(JSON.stringify({ status: "success", versionId: version.id, period: { start: START, end: END }, symbols, rowCount: stored.length, quality: report, adjustmentBasis: "daily OHLC × adj_factor；成交量和成交额保持原始口径。" }, null, 2));
process.exit(0);
