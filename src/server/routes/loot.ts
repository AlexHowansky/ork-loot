import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { campaign, character, loot, session } from "../db/schema.ts";
import { requireGm } from "../lib/auth.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { idParam, readJson, type Router } from "../lib/http.ts";
import { logger } from "../lib/logger.ts";
import { lootView } from "../domain/campaign.ts";
import { claimLoot, releaseLoot } from "../domain/loot.ts";
import { ownedSession } from "./session.ts";
import { gmClaimSchema, lootSchema, lootUpdateSchema } from "../../shared/schemas.ts";
import { CHARACTER_STATUSES, type LootStatus } from "../../shared/status.ts";

function ownedLoot(db: Db, gmId: string, lootId: number) {
  const row = db
    .select({ loot, campaignId: campaign.id })
    .from(loot)
    .innerJoin(session, eq(session.id, loot.sessionId))
    .innerJoin(campaign, eq(campaign.id, session.campaignId))
    .where(and(eq(loot.id, lootId), eq(campaign.gmId, gmId)))
    .get();
  if (!row) throw notFound("That item");
  return row;
}

function campaignCharacter(db: Db, campaignId: string, characterId: string) {
  const ch = db
    .select()
    .from(character)
    .where(and(eq(character.id, characterId), eq(character.campaignId, campaignId)))
    .get();
  if (!ch) {
    throw badRequest("That character isn't in this campaign.", {
      characterId: "Choose a character from this campaign.",
    });
  }
  return ch;
}

/**
 * Claimed and bought items need a character from this campaign; every
 * other status clears it.
 */
function checkOwner(
  db: Db,
  campaignId: string,
  status: LootStatus,
  characterId: string | null,
): string | null {
  if (!CHARACTER_STATUSES.includes(status)) return null;
  if (characterId === null) {
    throw badRequest("Choose which character has this item.", {
      characterId: "Required for claimed or bought items.",
    });
  }
  return campaignCharacter(db, campaignId, characterId).id;
}

export function lootRoutes(r: Router) {
  r.post("/api/sessions/:id/loot", async (ctx) => {
    const { session: s } = ownedSession(ctx.db, requireGm(ctx).id, idParam(ctx));
    const input = await readJson(ctx, lootSchema);
    const characterId = checkOwner(ctx.db, s.campaignId, input.status, input.characterId);
    const row = ctx.db
      .insert(loot)
      .values({ ...input, characterId, sessionId: s.id })
      .returning()
      .get();
    logger.info("loot added", { requestId: ctx.requestId, lootId: row.id });
    return lootView(row);
  });

  r.patch("/api/loot/:id", async (ctx) => {
    const { loot: item, campaignId } = ownedLoot(ctx.db, requireGm(ctx).id, idParam(ctx));
    const input = await readJson(ctx, lootUpdateSchema);
    const status = input.status ?? item.status;
    const characterId = checkOwner(
      ctx.db,
      campaignId,
      status,
      input.characterId !== undefined ? input.characterId : item.characterId,
    );
    const row = ctx.db
      .update(loot)
      .set({ ...input, status, characterId })
      .where(eq(loot.id, item.id))
      .returning()
      .get();
    logger.info("loot updated", { requestId: ctx.requestId, lootId: item.id, status });
    return lootView(row!);
  });

  /** The GM claims part or all of an available row for a character. */
  r.post("/api/loot/:id/claim", async (ctx) => {
    const { loot: item, campaignId } = ownedLoot(ctx.db, requireGm(ctx).id, idParam(ctx));
    const { characterId, quantity } = await readJson(ctx, gmClaimSchema);
    const who = campaignCharacter(ctx.db, campaignId, characterId);
    const row = claimLoot(ctx.db, who, item.id, quantity);
    logger.info("loot claimed by gm", {
      requestId: ctx.requestId,
      characterId: who.id,
      lootId: row.id,
      quantity,
    });
    return lootView(row);
  });

  /** The GM releases a character's claim back to the pool. */
  r.post("/api/loot/:id/release", (ctx) => {
    const { loot: item, campaignId } = ownedLoot(ctx.db, requireGm(ctx).id, idParam(ctx));
    if (item.status !== "claimed" || item.characterId === null) {
      throw badRequest("Only claimed items can be released.");
    }
    const who = campaignCharacter(ctx.db, campaignId, item.characterId);
    releaseLoot(ctx.db, who, item.id);
    logger.info("claim released by gm", {
      requestId: ctx.requestId,
      characterId: who.id,
      lootId: item.id,
    });
    return { ok: true };
  });

  r.delete("/api/loot/:id", (ctx) => {
    const { loot: item } = ownedLoot(ctx.db, requireGm(ctx).id, idParam(ctx));
    ctx.db.delete(loot).where(eq(loot.id, item.id)).run();
    logger.info("loot deleted", { requestId: ctx.requestId, lootId: item.id });
    return { ok: true };
  });
}
