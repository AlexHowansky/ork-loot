import { and, asc, eq } from "drizzle-orm";
import { campaign, character } from "../db/schema.ts";
import {
  currentGm,
  currentPlayer,
  endLogin,
  ensurePlayer,
  startLogin,
  verifyCredentials,
} from "../lib/auth.ts";
import { AppError } from "../lib/errors.ts";
import { readJson, type Ctx, type Router } from "../lib/http.ts";
import { logger } from "../lib/logger.ts";
import { RateLimiter } from "../lib/rate-limit.ts";
import { joinSchema, loginSchema } from "../../shared/schemas.ts";
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

  r.get("/api/auth/me", me);

  r.post("/api/auth/login", async (ctx) => {
    loginLimiter.hit(ctx.ip);
    const { username, password } = await readJson(ctx, loginSchema);
    const gm = await verifyCredentials(ctx.db, username, password);
    if (!gm) {
      logger.warn("login failed", { requestId: ctx.requestId, ip: ctx.ip });
      throw new AppError(401, "That username and password don't match.");
    }
    startLogin(ctx, gm.id);
    logger.info("login", { requestId: ctx.requestId, gmId: gm.id });
    return { gm: { id: gm.id, username: gm.username }, characters: me(ctx).characters };
  });

  r.post("/api/auth/logout", (ctx) => {
    endLogin(ctx);
    return { ok: true };
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
    logger.info("character joined", {
      requestId: ctx.requestId,
      characterId: claimed.id,
      playerId: player.id,
    });
    return { characterId: claimed.id };
  });
}
