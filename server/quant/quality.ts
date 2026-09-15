import type { CanonicalBar, QualityReport } from "./types";

const requiredFields = ["symbol", "tradeDate", "open", "high", "low", "close"] as const;

export function toDateKey(value: string | Date) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const compact = value.replace(/[^0-9]/g, "");
  if (/^\d{8}$/.test(compact)) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return value.slice(0, 10);
}

export function validateDailyBars(rows: CanonicalBar[]): QualityReport {
  let missingCount = 0;
  let invalidOhlcCount = 0;
  let duplicateCount = 0;
  let outOfOrderCount = 0;
  const seen = new Set<string>();
  const lastDateBySymbol = new Map<string, string>();
  const directionBySymbol = new Map<string, number>();
  const dates: string[] = [];

  for (const row of rows) {
    for (const field of requiredFields) {
      if (row[field] === undefined || row[field] === null || row[field] === "") missingCount++;
    }
    const date = toDateKey(row.tradeDate);
    dates.push(date);
    const key = `${row.symbol}|${date}`;
    if (seen.has(key)) duplicateCount++;
    seen.add(key);
    const prior = lastDateBySymbol.get(row.symbol);
    if (prior && date !== prior) {
      const nextDirection = date > prior ? 1 : -1;
      const direction = directionBySymbol.get(row.symbol);
      if (direction !== undefined && direction !== nextDirection) outOfOrderCount++;
      else directionBySymbol.set(row.symbol, nextDirection);
    }
    lastDateBySymbol.set(row.symbol, date);
    if (![row.open, row.high, row.low, row.close].every(Number.isFinite) || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close) || row.low > row.high) invalidOhlcCount++;
  }

  const messages: string[] = [];
  if (!rows.length) messages.push("数据集为空，无法用于回测。");
  if (missingCount) messages.push(`发现 ${missingCount} 个必填字段缺失。`);
  if (duplicateCount) messages.push(`发现 ${duplicateCount} 条重复的资产—交易日记录。`);
  if (outOfOrderCount) messages.push(`发现 ${outOfOrderCount} 处时间逆序。`);
  if (invalidOhlcCount) messages.push(`发现 ${invalidOhlcCount} 条不满足OHLC约束的记录。`);
  const blocking = !rows.length || missingCount > 0 || duplicateCount > 0 || outOfOrderCount > 0 || invalidOhlcCount > 0;
  return {
    status: blocking ? "failed" : "passed",
    rowCount: rows.length,
    duplicateCount,
    missingCount,
    invalidOhlcCount,
    outOfOrderCount,
    coverageStart: dates.length ? dates.sort()[0] : undefined,
    coverageEnd: dates.length ? dates.sort().at(-1) : undefined,
    messages: blocking ? messages : ["日频OHLCV完整性、唯一性、时间顺序与OHLC约束检查通过。"],
  };
}

export function assertStrictRunAllowed(report: QualityReport, dataAvailableAt: Date, signalAt: Date, executeAt: Date) {
  if (report.status === "failed") throw new Error("数据质量检查未通过，严格可交易回测已阻止启动。");
  if (dataAvailableAt > signalAt) throw new Error("信号时点早于数据可用时间，存在前视风险。");
  if (executeAt <= signalAt) throw new Error("严格可交易回测要求成交至少晚于信号一个可交易时点。");
}
