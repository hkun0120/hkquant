const TUSHARE_API_URL = "https://api.tushare.pro";

type TushareResponse<T> = { code: number; msg?: string; data?: { fields: string[]; items: T[][] } };

export async function tushareQuery<T extends string | number | null>(apiName: string, params: Record<string, unknown>, fields?: string[]) {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error("未配置服务端Tushare访问凭证。");
  const response = await fetch(TUSHARE_API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_name: apiName, token, params, fields: fields?.join(",") }), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Tushare请求失败：HTTP ${response.status}`);
  const payload = (await response.json()) as TushareResponse<T>;
  if (payload.code !== 0 || !payload.data) throw new Error(`Tushare请求失败：${payload.msg ?? `代码${payload.code}`}`);
  return payload.data.items.map(item => Object.fromEntries(payload.data!.fields.map((field, index) => [field, item[index]]))) as Record<string, T>[];
}

export async function fetchCnCalendar(startDate: string, endDate: string) {
  return tushareQuery("trade_cal", { exchange: "SSE", start_date: startDate, end_date: endDate }, ["exchange", "cal_date", "is_open"]);
}

export async function fetchCnBasics() {
  return tushareQuery("stock_basic", { exchange: "", list_status: "L" }, ["ts_code", "symbol", "name", "area", "industry", "list_date"]);
}

export async function fetchCnDaily(symbol: string, startDate: string, endDate: string) {
  return tushareQuery("daily", { ts_code: symbol, start_date: startDate, end_date: endDate }, ["ts_code", "trade_date", "open", "high", "low", "close", "pre_close", "vol", "amount"]);
}

export async function fetchCnEtfDaily(symbol: string, startDate: string, endDate: string) {
  return tushareQuery("fund_daily", { ts_code: symbol, start_date: startDate, end_date: endDate }, ["ts_code", "trade_date", "open", "high", "low", "close", "pre_close", "vol", "amount"]);
}

export async function fetchCnEtfAdj(symbol: string, startDate: string, endDate: string) {
  return tushareQuery("fund_adj", { ts_code: symbol, start_date: startDate, end_date: endDate }, ["ts_code", "trade_date", "adj_factor"]);
}

export async function fetchHkDaily(symbol: string, startDate: string, endDate: string) {
  return tushareQuery("hk_daily", { ts_code: symbol, start_date: startDate, end_date: endDate }, ["ts_code", "trade_date", "open", "high", "low", "close", "pre_close", "vol", "amount"]);
}

export async function fetchUsDaily(symbol: string, startDate: string, endDate: string) {
  return tushareQuery("us_daily", { ts_code: symbol, start_date: startDate, end_date: endDate }, ["ts_code", "trade_date", "open", "high", "low", "close", "pre_close", "vol", "amount", "turnover_ratio", "total_mv", "pe", "pb"]);
}

export async function fetchUsFinaIndicator(symbol: string, startDate: string, endDate: string) {
  return tushareQuery("us_fina_indicator", { ts_code: symbol, start_date: startDate, end_date: endDate }, ["ts_code", "end_date", "notice_date", "report_type", "currency", "operate_income", "gross_profit", "gross_profit_ratio", "roa", "roe_avg", "debt_asset_ratio"]);
}

export async function fetchCnFinaIndicator(symbol: string, startDate: string, endDate: string) {
  return tushareQuery("fina_indicator", { ts_code: symbol, start_date: startDate, end_date: endDate }, ["ts_code", "ann_date", "end_date", "ebit", "grossprofit_margin", "roic", "debt_to_assets"]);
}

export async function fetchCnAdjFactor(symbol: string, startDate: string, endDate: string) {
  return tushareQuery("adj_factor", { ts_code: symbol, start_date: startDate, end_date: endDate }, ["ts_code", "trade_date", "adj_factor"]);
}
