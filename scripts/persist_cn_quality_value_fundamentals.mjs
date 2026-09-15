import { readFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { assets, dataSources, dataVersions, fundamentalObservations, users } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";

const selection = JSON.parse(await readFile(new URL("../research_outputs_cn_quality_value_pit_selection.json", import.meta.url), "utf8"));
const toIso = value => { const raw = String(value); return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw; };
const date = value => new Date(`${toIso(value)}T00:00:00.000Z`);
const symbols = [...new Set(selection.selections.flatMap(snapshot => snapshot.selected.map(item => item.symbol)))];
const db = await getDb();
if (!db) throw new Error("研究数据库暂不可用。");
const owner = process.env.OWNER_OPEN_ID ? (await db.select().from(users).where(eq(users.openId, process.env.OWNER_OPEN_ID)).limit(1))[0] : (await db.select().from(users).where(eq(users.role, "admin")).limit(1))[0];
if (!owner) throw new Error("未找到项目管理员账户。");
let source = (await db.select().from(dataSources).where(eq(dataSources.name, "Tushare Pro · A股质量价值点时点因子")).limit(1))[0];
if (!source) { await db.insert(dataSources).values({ name: "Tushare Pro · A股质量价值点时点因子", kind: "tushare", market: "CN", serverManaged: true, syncStatus: "running" }); source = (await db.select().from(dataSources).where(eq(dataSources.name, "Tushare Pro · A股质量价值点时点因子")).limit(1))[0]; }
const assetRows = await db.select().from(assets).where(and(eq(assets.market, "CN"), inArray(assets.symbol, symbols)));
const assetBySymbol = new Map(assetRows.map(asset => [asset.symbol, asset.id]));
if (assetBySymbol.size !== symbols.length) throw new Error("部分质量价值候选资产未登记，不能持久化基本面观测。");
const versionTag = `cn-quality-value-pit-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
const observationCount = selection.selections.reduce((sum, snapshot) => sum + snapshot.selected.length * 2, 0);
await db.insert(dataVersions).values({ sourceId: source.id, dataset: "fundamentals", market: "CN", versionTag, fetchedAt: new Date(), availableAt: date(selection.selections[0].executionDate), coverageStart: date(selection.selections[0].fiscalPeriod), coverageEnd: date(selection.selections.at(-1).fiscalPeriod), rowCount: observationCount, qualityStatus: "passed", qualityReport: { sourceArtifact: "research_outputs_cn_quality_value_pit_selection.json", fields: ["ebit_to_ev", "gross_profitability"], timeRule: "announcedAt采用财报公告日；availableAt保守取年度信号后的下一交易日开盘，以保证不前视。", formula: selection.formula }, createdBy: owner.id });
const version = (await db.select().from(dataVersions).where(eq(dataVersions.versionTag, versionTag)).limit(1))[0];
const observations = selection.selections.flatMap(snapshot => snapshot.selected.flatMap(item => [
  { assetId: assetBySymbol.get(item.symbol), versionId: version.id, field: "ebit_to_ev", fiscalPeriod: date(item.fiscalPeriod), announcedAt: date(item.announcedAt), availableAt: date(snapshot.executionDate), value: String(item.ebitToEv) },
  { assetId: assetBySymbol.get(item.symbol), versionId: version.id, field: "gross_profitability", fiscalPeriod: date(item.fiscalPeriod), announcedAt: date(item.announcedAt), availableAt: date(snapshot.executionDate), value: String(item.grossProfitability) },
]));
for (let index = 0; index < observations.length; index += 500) await db.insert(fundamentalObservations).values(observations.slice(index, index + 500));
await db.update(dataSources).set({ syncStatus: "success", lastSyncedAt: new Date() }).where(eq(dataSources.id, source.id));
console.log(JSON.stringify({ status: "success", versionId: version.id, sourceArtifact: "research_outputs_cn_quality_value_pit_selection.json", symbols: symbols.length, observations: observations.length, fields: ["ebit_to_ev", "gross_profitability"], timeRule: "公告日后，保守到下一交易日开盘可用。" }, null, 2));
process.exit(0);
