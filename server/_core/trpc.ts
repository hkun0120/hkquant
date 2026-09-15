import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { and, eq } from "drizzle-orm";
import { researchMembers } from "../../drizzle/schema";
import { getDb } from "../db";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

const requireResearchMember = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  if (ctx.user.role === "admin") return next({ ctx: { ...ctx, user: ctx.user } });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "研究数据库暂不可用。" });
  const member = (await db.select().from(researchMembers).where(and(eq(researchMembers.userId, ctx.user.id), eq(researchMembers.active, true))).limit(1))[0];
  if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号未获量化研究空间授权。" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const researchProcedure = protectedProcedure.use(requireResearchMember);
export const researchEditorProcedure = protectedProcedure.use(t.middleware(async opts => {
  if (!opts.ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  if (opts.ctx.user.role === "admin") return opts.next({ ctx: { ...opts.ctx, user: opts.ctx.user } });
  const db = await getDb(); const member = db ? (await db.select().from(researchMembers).where(and(eq(researchMembers.userId, opts.ctx.user.id), eq(researchMembers.active, true))).limit(1))[0] : null;
  if (!member || member.accessRole === "viewer") throw new TRPCError({ code: "FORBIDDEN", message: "当前账号没有研究空间写入权限。" });
  return opts.next({ ctx: { ...opts.ctx, user: opts.ctx.user } });
}));
export const researchOwnerProcedure = protectedProcedure.use(t.middleware(async opts => {
  if (!opts.ctx.user || opts.ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "仅项目所有者可执行此操作。" });
  return opts.next({ ctx: { ...opts.ctx, user: opts.ctx.user } });
}));

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
