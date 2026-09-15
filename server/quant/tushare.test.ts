import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCnAdjFactor, fetchCnEtfAdj, fetchCnFinaIndicator, fetchUsDaily, fetchUsFinaIndicator } from "./tushare";

describe("Tushare ETF复权因子适配器", () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.TUSHARE_TOKEN;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.TUSHARE_TOKEN = originalToken;
  });

  it("以服务端凭证请求fund_adj，并只返回复权字段", async () => {
    process.env.TUSHARE_TOKEN = "server-only-test-token";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { fields: ["ts_code", "trade_date", "adj_factor"], items: [["510300.SH", "20220104", 1.25]] } }), { status: 200 }));

    await expect(fetchCnEtfAdj("510300.SH", "20220101", "20220131")).resolves.toEqual([{ ts_code: "510300.SH", trade_date: "20220104", adj_factor: 1.25 }]);
    expect(global.fetch).toHaveBeenCalledWith("https://api.tushare.pro", expect.objectContaining({ method: "POST", body: expect.stringContaining('\"api_name\":\"fund_adj\"') }));
  });

  it("使用独立的美股日线和公告日财务指标端点", async () => {
    process.env.TUSHARE_TOKEN = "server-only-test-token";
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { fields: ["ts_code", "trade_date", "close"], items: [["AAPL", "20220103", 182.01]] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { fields: ["ts_code", "end_date", "notice_date", "gross_profit"], items: [["AAPL", "20211231", "20220127", 100]] } }), { status: 200 }));

    await expect(fetchUsDaily("AAPL", "20220101", "20220131")).resolves.toEqual([{ ts_code: "AAPL", trade_date: "20220103", close: 182.01 }]);
    await expect(fetchUsFinaIndicator("AAPL", "20200101", "20221231")).resolves.toEqual([{ ts_code: "AAPL", end_date: "20211231", notice_date: "20220127", gross_profit: 100 }]);
    const bodies = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(call => String(call[1]?.body));
    expect(bodies.some(body => body.includes('"api_name":"us_daily"'))).toBe(true);
    expect(bodies.some(body => body.includes('\"api_name\":\"us_fina_indicator\"'))).toBe(true);
  });

  it("请求A股公告日财务指标而不把报告期当作可用时间", async () => {
    process.env.TUSHARE_TOKEN = "server-only-test-token";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { fields: ["ts_code", "ann_date", "end_date", "ebit"], items: [["000001.SZ", "20220310", "20211231", 20]] } }), { status: 200 }));

    await expect(fetchCnFinaIndicator("000001.SZ", "20190101", "20221231")).resolves.toEqual([{ ts_code: "000001.SZ", ann_date: "20220310", end_date: "20211231", ebit: 20 }]);
    expect(global.fetch).toHaveBeenCalledWith("https://api.tushare.pro", expect.objectContaining({ body: expect.stringContaining('\"api_name\":\"fina_indicator\"') }));
  });

  it("单独请求A股股票复权因子以调整历史价格序列", async () => {
    process.env.TUSHARE_TOKEN = "server-only-test-token";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { fields: ["ts_code", "trade_date", "adj_factor"], items: [["600000.SH", "20220104", 1.32]] } }), { status: 200 }));

    await expect(fetchCnAdjFactor("600000.SH", "20220101", "20220131")).resolves.toEqual([{ ts_code: "600000.SH", trade_date: "20220104", adj_factor: 1.32 }]);
    expect(global.fetch).toHaveBeenCalledWith("https://api.tushare.pro", expect.objectContaining({ body: expect.stringContaining('\"api_name\":\"adj_factor\"') }));
  });
});
