import type { Express, Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { runScheduledResearchRefresh } from "./service";

export function registerScheduledResearchRoute(app: Express) {
  app.post("/api/scheduled/research-refresh", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const result = await runScheduledResearchRefresh(user.taskUid);
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "日度研究任务失败";
      if (/频率超限|rate limit|too many requests/i.test(message)) return res.json({ ok: true, skipped: "rate_limited", timestamp: new Date().toISOString() });
      return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
    }
  });
}
