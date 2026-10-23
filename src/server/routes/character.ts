import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { campaign, character, loot, splitShare } from "../db/schema.ts";
import { newJoinCode, requireGm } from "../lib/auth.ts";
import { conflict, notFound } from "../lib/errors.ts";
import { readJson, uuidParam, type Router } from "../lib/http.ts";
import { logger } from "../lib/logger.ts";
import { ownedCampaign } from "../domain/campaign.ts";
import { characterSchema } from "../../shared/schemas.ts";

/** The character with this id if `gmId` runs its campaign; else a 404. */
export function ownedCharacter(db: Db, gmId: string, characterId: string) {
  const row = db
    .select({ character })
    .from(character)
    .innerJoin(campaign, eq(campaign.id, character.campaignId))
    .where(and(eq(character.id, characterId), eq(campaign.gmId, gmId)))
    .get();
  if (!row) throw notFound("That character");
  return row.character;
}

function assertNameFree(db: Db, campaignId: string, name: string, exceptId = "") {
  const clash = db
    .select({ id: character.id })
    .from(character)
    .where(
      and(
        eq(character.campaignId, campaignId),
        sql`lower(${character.name}) = lower(${name})`,
        ne(character.id, exceptId),
      ),
    )
    .get();
  if (clash) {
    throw conflict(`There's already a character called “${name}” in this campaign.`);
  }
}

/** A join code not used by any other character. */
function freshCode(db: Db): string {
  for (;;) {
    const code = newJoinCode();
    const taken = db
      .select({ id: character.id })
      .from(character)
      .where(eq(character.joinCode, code))
      .get();
    if (!taken) return code;
  }
}

export function characterRoutes(r: Router) {
  r.post("/api/campaigns/:id/characters", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    const input = await readJson(ctx, characterSchema);
    assertNameFree(ctx.db, c.id, input.name);
    const row = ctx.db
      .insert(character)
      .values({ ...input, campaignId: c.id, joinCode: freshCode(ctx.db) })
      .returning()
      .get();
    logger.info("character created", { requestId: ctx.requestId, characterId: row.id });
    return { id: row.id };
  });

  r.patch("/api/characters/:id", async (ctx) => {
    const ch = ownedCharacter(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    const input = await readJson(ctx, characterSchema);
    assertNameFree(ctx.db, ch.campaignId, input.name, ch.id);
    ctx.db.update(character).set(input).where(eq(character.id, ch.id)).run();
    return { id: ch.id };
  });

  r.post("/api/characters/:id/code", (ctx) => {
    const ch = ownedCharacter(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    const joinCode = freshCode(ctx.db);
    // A new code also signs out whoever holds the character now.
    ctx.db
      .update(character)
      .set({ joinCode, playerId: null })
      .where(eq(character.id, ch.id))
      .run();
    logger.info("join code regenerated", {
      requestId: ctx.requestId,
      characterId: ch.id,
      signedOut: ch.playerId !== null,
    });
    return { joinCode };
  });

  r.delete("/api/characters/:id", (ctx) => {
    const ch = ownedCharacter(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    ctx.db.transaction((tx) => {
      const bought = tx
        .select({ n: sql<number>`count(*)` })
        .from(loot)
        .where(and(eq(loot.characterId, ch.id), eq(loot.status, "bought")))
        .get();
      const history = tx
        .select({ n: sql<number>`count(*)` })
        .from(splitShare)
        .where(eq(splitShare.characterId, ch.id))
        .get();
      if ((bought?.n ?? 0) > 0 || (history?.n ?? 0) > 0) {
        throw conflict(
          `${ch.name} has taken part in a loot split, so they can't be ` +
            "deleted without losing history.",
        );
      }
      // Anything they had claimed goes back into the pool.
      tx.update(loot)
        .set({ status: "active", characterId: null })
        .where(eq(loot.characterId, ch.id))
        .run();
      tx.delete(character).where(eq(character.id, ch.id)).run();
    });
    logger.info("character deleted", { requestId: ctx.requestId, characterId: ch.id });
    return { ok: true };
  });
}
