import { describe, expect, it } from "vitest";
import { normalizeImportedBars, resolveFieldMapping } from "./importRoute";

describe("导入字段映射", () => {
  const rows = [{ ticker: "AAPL", date: "20240102", open: "185.2", high: "187", low: "184.5", close: "186.1", volume: "42000000" }];
  it("将外部别名标准化为统一OHLCV字段", () => {
    expect(normalizeImportedBars(rows)).toEqual([{ symbol: "AAPL", tradeDate: "2024-01-02", open: 185.2, high: 187, low: 184.5, close: 186.1, preClose: null, volume: 42000000, amount: null }]);
  });
  it("记录实际命中的外部字段映射", () => {
    expect(resolveFieldMapping(rows)).toMatchObject({ symbol: "ticker", tradeDate: "date", open: "open", volume: "volume" });
  });
});
