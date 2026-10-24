import { and, asc, eq } from "drizzle-orm";
import { campaign, character, gm } from "../db/schema.ts";
import {
  currentGm,
  currentPlayer,
  endLogin,
  ensurePlayer,
  finishPasswordReset,
  hashPassword,
  startLogin,
  startPasswordReset,
  verifyCredentials,
} from "../lib/auth.ts";
import { AppError } from "../lib/errors.ts";
import { readJson, type Ctx, type Router } from "../lib/http.ts";
import { logger } from "../lib/logger.ts";
import { RateLimiter } from "../lib/rate-limit.ts";
import {
  forgotSchema,
  joinSchema,
  loginSchema,
  resetSchema,
} from "../../shared/schemas.ts";
import type { Me } from "../../shared/types.ts";

function me(ctx: Ctx): Me {
  const player = currentPlayer(ctx);
  const characters = player
    ? ctx.db
        .select({
          id: character.id,
          name: character.name,
          campaignId: campaign.id,
          campaignName: campaign.name,
          campaignImage: campaign.backgroundImage,
        })
        .from(character)
        .innerJoin(campaign, eq(campaign.id, character.campaignId))
        .where(eq(character.playerId, player.id))
        .orderBy(asc(campaign.name), asc(character.name))
        .all()
    : [];
  return { gm: currentGm(ctx), characters };
}

export function authRoutes(r: Router) {
  const loginLimiter = new RateLimiter(10, 60_000);
  const joinLimiter = new RateLimiter(10, 60_000);
  const forgotLimiter = new RateLimiter(5, 15 * 60_000);
  const resetLimiter = new RateLimiter(10, 60_000);

  r.get("/api/auth/me", me);

  r.post("/api/auth/login", async (ctx) => {
    loginLimiter.hit(ctx.ip);
    const { email, password } = await readJson(ctx, loginSchema);
    const gm = await verifyCredentials(ctx.db, email, password);
    if (!gm) {
      logger.warn("login failed", { requestId: ctx.requestId, ip: ctx.ip });
      throw new AppError(401, "That email address and password don't match.");
    }
    startLogin(ctx, gm.id);
    logger.info("login", { requestId: ctx.requestId, gmId: gm.id });
    return { gm: { id: gm.id, email: gm.email }, characters: me(ctx).characters };
  });

  r.post("/api/auth/logout", (ctx) => {
    endLogin(ctx);
    return { ok: true };
  });

  r.post("/api/auth/forgot", async (ctx) => {
    forgotLimiter.hit(ctx.ip);
    const { email } = await readJson(ctx, forgotSchema);
    const row = ctx.db.select().from(gm).where(eq(gm.email, email)).get();
    if (!row) {
      logger.info("password reset for unknown address", {
        requestId: ctx.requestId,
        ip: ctx.ip,
      });
      return { ok: true };
    }
    const token = startPasswordReset(ctx.db, row.id);
    const link = `${ctx.config.appUrl}/reset#${token}`;
    logger.info("password reset requested", { requestId: ctx.requestId, gmId: row.id });
    // Not awaited, so the reply takes as long whether or not the address
    // belongs to a GM.
    ctx.config.mailer
      .send({
        to: row.email,
        subject: "Reset your Phat Loot password",
        text:
          "Someone asked to reset the password for your Phat Loot GM account.\n\n" +
          `To choose a new password, open this link within the next hour:\n\n${link}\n\n` +
          "If it wasn't you, you can ignore this email; your password hasn't changed.\n",
      })
      .catch((err) => {
        logger.error("password reset email failed", {
          requestId: ctx.requestId,
          gmId: row.id,
          err,
        });
      });
    return { ok: true };
  });

  r.post("/api/auth/reset", async (ctx) => {
    resetLimiter.hit(ctx.ip);
    const { token, password } = await readJson(ctx, resetSchema);
    const gmId = finishPasswordReset(ctx.db, token, await hashPassword(password));
    if (!gmId) {
      logger.warn("password reset link rejected", { requestId: ctx.requestId, ip: ctx.ip });
      throw new AppError(
        400,
        "That reset link has expired or was already used. Ask for a new one.",
      );
    }
    // Every login, this browser's included, was ended; sign it back in.
    startLogin(ctx, gmId);
    logger.info("password reset", { requestId: ctx.requestId, gmId });
    const row = ctx.db.select().from(gm).where(eq(gm.id, gmId)).get()!;
    return { gm: { id: row.id, email: row.email }, characters: me(ctx).characters };
  });

  r.post("/api/join", async (ctx) => {
    joinLimiter.hit(ctx.ip);
    const { code } = await readJson(ctx, joinSchema);
    const target = ctx.db
      .select()
      .from(character)
      .where(eq(character.joinCode, code))
      .get();
    if (!target) {
      logger.warn("join code rejected", { requestId: ctx.requestId, ip: ctx.ip });
      throw new AppError(
        404,
        "That code didn't work. It may have been used already — ask your GM for a new one.",
        { code: "Unknown or used code." },
      );
    }
    const player = ensurePlayer(ctx);
    // Guard on the code so two simultaneous redemptions can't both succeed.
    const claimed = ctx.db
      .update(character)
      .set({ playerId: player.id, joinCode: null })
      .where(and(eq(character.id, target.id), eq(character.joinCode, code)))
      .returning()
      .get();
    if (!claimed) {
      throw new AppError(409, "That code was just used. Ask your GM for a new one.");
    }
    ctx.changed(claimed.campaignId);
    logger.info("character joined", {
      requestId: ctx.requestId,
      characterId: claimed.id,
      playerId: player.id,
    });
    return { characterId: claimed.id };
  });
}
