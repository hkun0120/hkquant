import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Tushare 服务端凭证", () => {
  it("仅在服务端环境读取令牌且不会向客户端暴露凭证", () => {
    const token = process.env.TUSHARE_TOKEN;
    expect(token, "TUSHARE_TOKEN 必须只在服务端环境中配置").toBeTruthy();
    const clientEntry = readFileSync(join(process.cwd(), "client", "src", "pages", "Home.tsx"), "utf8");
    expect(clientEntry).not.toContain(token!);
    expect(clientEntry).not.toContain("TUSHARE_TOKEN");
  });
});
