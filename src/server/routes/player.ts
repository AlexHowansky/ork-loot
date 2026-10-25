import { eq } from "drizzle-orm";
import { campaign, character, observer } from "../db/schema.ts";
import { requireOwnedCharacter, requireOwnedObserver } from "../lib/auth.ts";
import { notFound } from "../lib/errors.ts";
import { readJson, uuidParam, type Router } from "../lib/http.ts";
import { sseResponse } from "../lib/events.ts";
import { logger } from "../lib/logger.ts";
import { campaignView } from "../domain/campaign.ts";
import { claimLoot, claimNotice, releaseLoot } from "../domain/loot.ts";
import { claimSchema, releaseSchema } from "../../shared/schemas.ts";
import type { PlayView, WatchView } from "../../shared/types.ts";

export function playerRoutes(r: Router) {
  r.get("/api/play/:id", (ctx): PlayView => {
    const me = requireOwnedCharacter(ctx, uuidParam(ctx));
    const c = ctx.db.select().from(campaign).where(eq(campaign.id, me.campaignId)).get();
    if (!c) throw notFound("That campaign");
    return { ...campaignView(ctx.db, c, { forGm: false }), me: { id: me.id, name: me.name } };
  });

  r.get("/api/play/:id/events", (ctx) => {
    const me = requireOwnedCharacter(ctx, uuidParam(ctx));
    return sseResponse(ctx, me.campaignId, {
      gm: false,
      presence: { seatId: me.id, playerId: me.playerId! },
    });
  });

  r.post("/api/play/:id/claim", async (ctx) => {
    const me = requireOwnedCharacter(ctx, uuidParam(ctx));
    const { lootId, quantity } = await readJson(ctx, claimSchema);
    const row = claimLoot(ctx.db, me, lootId, quantity);
    ctx.changed(me.campaignId, claimNotice("claimed", me, row));
    logger.info("loot claimed", {
      requestId: ctx.requestId,
      characterId: me.id,
      lootId: row.id,
      quantity,
    });
    return { id: row.id };
  });

  r.post("/api/play/:id/release", async (ctx) => {
    const me = requireOwnedCharacter(ctx, uuidParam(ctx));
    const { lootId } = await readJson(ctx, releaseSchema);
    const row = releaseLoot(ctx.db, me, lootId);
    ctx.changed(me.campaignId, claimNotice("released", me, row));
    logger.info("claim released", { requestId: ctx.requestId, characterId: me.id, lootId });
    return { ok: true };
  });

  /** Lets a browser stop playing a character it holds. */
  r.delete("/api/play/:id", (ctx) => {
    const me = requireOwnedCharacter(ctx, uuidParam(ctx));
    ctx.db.update(character).set({ playerId: null }).where(eq(character.id, me.id)).run();
    ctx.changed(me.campaignId);
    logger.info("character left", { requestId: ctx.requestId, characterId: me.id });
    return { ok: true };
  });

  // Observers see what players see, but have nothing to claim or release.
  r.get("/api/watch/:id", (ctx): WatchView => {
    const o = requireOwnedObserver(ctx, uuidParam(ctx));
    const c = ctx.db.select().from(campaign).where(eq(campaign.id, o.campaignId)).get();
    if (!c) throw notFound("That campaign");
    return { ...campaignView(ctx.db, c, { forGm: false }), observer: { id: o.id, name: o.name } };
  });

  r.get("/api/watch/:id/events", (ctx) => {
    const o = requireOwnedObserver(ctx, uuidParam(ctx));
    return sseResponse(ctx, o.campaignId, {
      gm: false,
      presence: { seatId: o.id, playerId: o.playerId! },
    });
  });

  /** Lets a browser stop observing a campaign. */
  r.delete("/api/watch/:id", (ctx) => {
    const o = requireOwnedObserver(ctx, uuidParam(ctx));
    ctx.db.update(observer).set({ playerId: null }).where(eq(observer.id, o.id)).run();
    ctx.changed(o.campaignId);
    logger.info("observer left", { requestId: ctx.requestId, observerId: o.id });
    return { ok: true };
  });
}
