import { asc, eq } from "drizzle-orm";
import { campaign, character, gm, joinCode, observer } from "../db/schema.ts";
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

/** The characters and observers this browser holds. */
function seats(ctx: Ctx): Omit<Me, "gm"> {
  const player = currentPlayer(ctx);
  if (!player) return { characters: [], observers: [] };
  const characters = ctx.db
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
    .all();
  const observers = ctx.db
    .select({
      id: observer.id,
      name: observer.name,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignImage: campaign.backgroundImage,
    })
    .from(observer)
    .innerJoin(campaign, eq(campaign.id, observer.campaignId))
    .where(eq(observer.playerId, player.id))
    .orderBy(asc(campaign.name), asc(observer.name))
    .all();
  return { characters, observers };
}

function me(ctx: Ctx): Me {
  return { gm: currentGm(ctx), ...seats(ctx) };
}

/** Runs an email-keyed limit, logging (without the address) when it trips. */
function limitByEmail(ctx: Ctx, what: string, limit: () => void) {
  try {
    limit();
  } catch (err) {
    logger.warn(`${what} paused for one address`, { requestId: ctx.requestId, ip: ctx.ip });
    throw err;
  }
}

export function authRoutes(r: Router) {
  const loginLimiter = new RateLimiter(10, 60_000);
  // Only failed sign-ins count against an address.
  const loginEmailLimiter = new RateLimiter(10, 15 * 60_000);
  const joinLimiter = new RateLimiter(10, 60_000);
  const forgotLimiter = new RateLimiter(5, 15 * 60_000);
  // Counted for every address, known or not, so a 429 reveals nothing.
  const forgotEmailLimiter = new RateLimiter(3, 60 * 60_000);
  const resetLimiter = new RateLimiter(10, 60_000);

  r.get("/api/auth/me", me);

  r.post("/api/auth/login", async (ctx) => {
    loginLimiter.hit(ctx.ip);
    const { email, password } = await readJson(ctx, loginSchema);
    limitByEmail(ctx, "login", () => loginEmailLimiter.check(email));
    const gm = await verifyCredentials(ctx.db, email, password);
    if (!gm) {
      loginEmailLimiter.record(email);
      logger.warn("login failed", { requestId: ctx.requestId, ip: ctx.ip });
      throw new AppError(401, "That email address and password don't match.");
    }
    startLogin(ctx, gm.id);
    logger.info("login", { requestId: ctx.requestId, gmId: gm.id });
    return { gm: { id: gm.id, email: gm.email }, ...seats(ctx) };
  });

  r.post("/api/auth/logout", (ctx) => {
    endLogin(ctx);
    return { ok: true };
  });

  r.post("/api/auth/forgot", async (ctx) => {
    forgotLimiter.hit(ctx.ip);
    const { email } = await readJson(ctx, forgotSchema);
    limitByEmail(ctx, "password reset", () => forgotEmailLimiter.hit(email));
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
    const streams = ctx.events.signOut(gmId);
    logger.info("password reset", { requestId: ctx.requestId, gmId, streams });
    const row = ctx.db.select().from(gm).where(eq(gm.id, gmId)).get()!;
    return { gm: { id: row.id, email: row.email }, ...seats(ctx) };
  });

  r.post("/api/join", async (ctx) => {
    joinLimiter.hit(ctx.ip);
    const { code } = await readJson(ctx, joinSchema);
    const known = ctx.db.select().from(joinCode).where(eq(joinCode.code, code)).get();
    if (!known) {
      logger.warn("join code rejected", { requestId: ctx.requestId, ip: ctx.ip });
      throw new AppError(
        404,
        "That code didn't work. It may have been used already — ask your GM for a new one.",
        { code: "Unknown or used code." },
      );
    }
    const player = ensurePlayer(ctx);
    const taken = ctx.db.transaction((tx) => {
      // Deleting the code uses it up, so two redemptions can't both succeed.
      const used = tx.delete(joinCode).where(eq(joinCode.code, code)).returning().get();
      if (!used) return null;
      if (used.observerId !== null) {
        const o = tx
          .update(observer)
          .set({ playerId: player.id })
          .where(eq(observer.id, used.observerId))
          .returning()
          .get()!;
        return { observer: o };
      }
      const ch = tx
        .update(character)
        .set({ playerId: player.id })
        .where(eq(character.id, used.characterId!))
        .returning()
        .get()!;
      return { character: ch };
    });
    if (!taken) {
      throw new AppError(409, "That code was just used. Ask your GM for a new one.");
    }
    if (taken.observer) {
      ctx.changed(taken.observer.campaignId);
      logger.info("observer joined", {
        requestId: ctx.requestId,
        observerId: taken.observer.id,
        playerId: player.id,
      });
      return { observerId: taken.observer.id };
    }
    const claimed = taken.character;
    ctx.changed(claimed.campaignId);
    logger.info("character joined", {
      requestId: ctx.requestId,
      characterId: claimed.id,
      playerId: player.id,
    });
    return { characterId: claimed.id };
  });
}
