import { eq } from "drizzle-orm";
import { campaign, character } from "../db/schema.ts";
import { requireOwnedCharacter } from "../lib/auth.ts";
import { notFound } from "../lib/errors.ts";
import { readJson, uuidParam, type Router } from "../lib/http.ts";
import { sseResponse } from "../lib/events.ts";
import { logger } from "../lib/logger.ts";
import { campaignView } from "../domain/campaign.ts";
import { claimLoot, claimNotice, releaseLoot } from "../domain/loot.ts";
import { claimSchema, releaseSchema } from "../../shared/schemas.ts";
import type { PlayView } from "../../shared/types.ts";

export function playerRoutes(r: Router) {
  r.get("/api/play/:id", (ctx): PlayView => {
    const me = requireOwnedCharacter(ctx, uuidParam(ctx));
    const c = ctx.db.select().from(campaign).where(eq(campaign.id, me.campaignId)).get();
    if (!c) throw notFound("That campaign");
    return { ...campaignView(ctx.db, c, { forGm: false }), me: { id: me.id, name: me.name } };
  });

  r.get("/api/play/:id/events", (ctx) => {
    const me = requireOwnedCharacter(ctx, uuidParam(ctx));
    return sseResponse(ctx, me.campaignId);
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
}
