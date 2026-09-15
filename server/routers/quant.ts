import { z } from "zod";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "../../shared/const";
import { updateHeartbeatJob } from "../_core/heartbeat";
import { researchEditorProcedure, researchOwnerProcedure, researchProcedure, router } from "../_core/trpc";
import { createResearchNote, createResearchTodo, dashboardSnapshot, ensureStarterContent, forkStrategyVersion, getDailyResearchJob, grantResearchMember, latestFundamentalsAsOf, listRuleSets, listStrategiesWithVersions, recordFundamentalObservation, runBacktest, runBacktestComparison, setDailyResearchJobState, syncCnBasics, syncCnCalendar, syncCnDaily, syncCnEtfDaily, syncHkDaily } from "../quant/service";

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const quantRouter = router({
  bootstrap: researchOwnerProcedure.mutation(({ ctx }) => ensureStarterContent(ctx.user.id)),
  dashboard: researchProcedure.query(() => dashboardSnapshot()),
  strategies: researchProcedure.query(() => listStrategiesWithVersions()),
  ruleSets: researchProcedure.query(() => listRuleSets()),
  dailyTask: researchOwnerProcedure.query(() => getDailyResearchJob()),
  syncCalendar: researchEditorProcedure.input(z.object({ startDate: dateInput, endDate: dateInput })).mutation(({ ctx, input }) => syncCnCalendar(ctx.user.id, input.startDate, input.endDate)),
  syncCnBasics: researchEditorProcedure.mutation(({ ctx }) => syncCnBasics(ctx.user.id)),
  syncCnDaily: researchEditorProcedure.input(z.object({ symbol: z.string().min(5).max(16), startDate: dateInput, endDate: dateInput })).mutation(({ ctx, input }) => syncCnDaily(ctx.user.id, input.symbol.toUpperCase(), input.startDate, input.endDate)),
  syncCnEtfDaily: researchEditorProcedure.input(z.object({ symbol: z.string().regex(/^\d{6}\.(SH|SZ)$/), startDate: dateInput, endDate: dateInput })).mutation(({ ctx, input }) => syncCnEtfDaily(ctx.user.id, input.symbol.toUpperCase(), input.startDate, input.endDate)),
  syncHkDaily: researchEditorProcedure.input(z.object({ symbol: z.string().regex(/^\d{5}\.HK$/), startDate: dateInput, endDate: dateInput })).mutation(({ ctx, input }) => syncHkDaily(ctx.user.id, input.symbol.toUpperCase(), input.startDate, input.endDate)),
  createNote: researchEditorProcedure.input(z.object({ strategyId: z.number().int().positive().optional(), noteType: z.string().min(2).max(32), title: z.string().min(2).max(255), body: z.string().min(2) })).mutation(({ ctx, input }) => createResearchNote(ctx.user.id, input)),
  createTodo: researchEditorProcedure.input(z.object({ strategyId: z.number().int().positive().optional(), title: z.string().min(2).max(255), detail: z.string().max(2000).optional() })).mutation(({ ctx, input }) => createResearchTodo(ctx.user.id, input)),
  grantMember: researchOwnerProcedure.input(z.object({ email: z.string().email(), accessRole: z.enum(["editor", "viewer"]) })).mutation(({ ctx, input }) => grantResearchMember(ctx.user.id, input.email, input.accessRole)),
  recordFundamental: researchEditorProcedure.input(z.object({ assetId: z.number().int().positive(), versionId: z.number().int().positive(), field: z.string().min(1).max(100), fiscalPeriod: dateInput.optional(), announcedAt: z.string().datetime(), availableAt: z.string().datetime(), value: z.number().finite() })).mutation(({ ctx, input }) => recordFundamentalObservation(ctx.user.id, input)),
  fundamentalsAsOf: researchProcedure.input(z.object({ assetIds: z.array(z.number().int().positive()).min(1), fields: z.array(z.string().min(1)).min(1), signalAt: z.string().datetime() })).query(({ input }) => latestFundamentalsAsOf(input.assetIds, input.fields, input.signalAt)),
  forkStrategyVersion: researchEditorProcedure.input(z.object({ sourceVersionId: z.number().int().positive(), hypothesis: z.string().min(5), config: z.record(z.string(), z.unknown()), status: z.string().min(2).max(32).optional() })).mutation(({ ctx, input }) => forkStrategyVersion(ctx.user.id, input)),
  runBacktest: researchEditorProcedure.input(z.object({ strategyVersionId: z.number().int().positive(), ruleSetId: z.number().int().positive(), dataVersionId: z.number().int().positive(), startDate: dateInput, endDate: dateInput, targetWeights: z.record(z.string(), z.number().positive()).refine(values => Object.values(values).reduce((sum, value) => sum + value, 0) <= 1, "目标权重之和不可超过100%"), mode: z.enum(["baseline", "strict"]), initialCapital: z.number().positive().default(1_000_000) })).mutation(({ ctx, input }) => runBacktest(ctx.user.id, input)),
  compareBacktest: researchEditorProcedure.input(z.object({ strategyVersionId: z.number().int().positive(), ruleSetId: z.number().int().positive(), dataVersionId: z.number().int().positive(), startDate: dateInput, endDate: dateInput, targetWeights: z.record(z.string(), z.number().positive()).refine(values => Object.values(values).reduce((sum, value) => sum + value, 0) <= 1, "目标权重之和不可超过100%"), initialCapital: z.number().positive().default(1_000_000) })).mutation(({ ctx, input }) => runBacktestComparison(ctx.user.id, input)),
  setDailyTaskEnabled: researchOwnerProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => { const job = await getDailyResearchJob(); if (!job?.scheduleCronTaskUid) throw new Error("日度任务尚未绑定托管计划。"); const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? ""; await updateHeartbeatJob(job.scheduleCronTaskUid, { enable: input.enabled }, sessionToken); return setDailyResearchJobState(input.enabled); }),
});
