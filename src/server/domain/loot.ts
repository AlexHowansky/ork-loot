import { and, eq, gte, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { DbOrTx as Db } from "../db/client.ts";
import {
  campaign,
  character,
  loot,
  session,
  split,
  splitShare,
  type Campaign,
  type Character,
  type Loot,
} from "../db/schema.ts";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.ts";
import { campaignLoot, computePool, splitHistory } from "./campaign.ts";
import type { SplitView } from "../../shared/types.ts";

/** A loot row together with the campaign that owns it, or a 404. */
export function lootInCampaign(db: Db, lootId: number, campaignId: string) {
  const row = db
    .select({ loot })
    .from(loot)
    .innerJoin(session, eq(session.id, loot.sessionId))
    .where(and(eq(loot.id, lootId), eq(session.campaignId, campaignId)))
    .get();
  if (!row) throw notFound("That item");
  return row.loot;
}

const alreadyGone = () =>
  conflict(
    "Someone else got to that item first. The list has been refreshed.",
  );

/** Refuses a claim for a character who takes no share of splits. */
export function assertCanClaim(who: Character): void {
  if (who.shares === 0) {
    throw badRequest(
      `${who.name} has no shares, so they can't claim loot.`,
      { characterId: "Choose a character with at least 1 share." },
    );
  }
}

/**
 * Claims `quantity` of an available loot row for a character. Claiming part
 * of a stack leaves the rest available on the original row and puts the
 * claimed part on a new row. The status and quantity guards in each
 * UPDATE stop two players from claiming the same units.
 */
export function claimLoot(
  db: Db,
  who: Character,
  lootId: number,
  quantity: number,
): Loot {
  assertCanClaim(who);
  return db.transaction((tx) => {
    const item = lootInCampaign(tx, lootId, who.campaignId);
    if (item.status !== "available") throw alreadyGone();
    if (quantity > item.quantity) {
      throw badRequest(
        `There ${item.quantity === 1 ? "is" : "are"} only ${item.quantity} to claim.`,
        { quantity: `At most ${item.quantity}.` },
      );
    }
    if (quantity === item.quantity) {
      const updated = tx
        .update(loot)
        .set({ status: "claimed", characterId: who.id })
        .where(
          and(
            eq(loot.id, item.id),
            eq(loot.status, "available"),
            eq(loot.quantity, quantity),
          ),
        )
        .returning()
        .get();
      if (!updated) throw alreadyGone();
      return updated;
    }
    const reduced = tx
      .update(loot)
      .set({ quantity: item.quantity - quantity })
      .where(
        and(
          eq(loot.id, item.id),
          eq(loot.status, "available"),
          gte(loot.quantity, quantity + 1),
        ),
      )
      .returning()
      .get();
    if (!reduced) throw alreadyGone();
    return tx
      .insert(loot)
      .values({
        sessionId: item.sessionId,
        name: item.name,
        description: item.description,
        link: item.link,
        quantity,
        value: item.value,
        marketPct: item.marketPct,
        status: "claimed",
        characterId: who.id,
      })
      .returning()
      .get();
  });
}

const sameOrNull = <T>(col: Parameters<typeof eq>[0], v: T | null): SQL =>
  v === null ? isNull(col) : eq(col, v);

/**
 * Releases a character's claim back to the pool, merging it into an
 * identical available row from the same session when there is one.
 */
export function releaseLoot(db: Db, who: Character, lootId: number): void {
  db.transaction((tx) => {
    const item = lootInCampaign(tx, lootId, who.campaignId);
    if (item.status !== "claimed" || item.characterId !== who.id) {
      throw badRequest("You can only release items you've claimed.");
    }
    const twin = tx
      .select()
      .from(loot)
      .where(
        and(
          ne(loot.id, item.id),
          eq(loot.sessionId, item.sessionId),
          eq(loot.status, "available"),
          eq(loot.name, item.name),
          eq(loot.marketPct, item.marketPct),
          sameOrNull(loot.description, item.description),
          sameOrNull(loot.link, item.link),
          sameOrNull(loot.value, item.value),
        ),
      )
      .get();
    if (twin) {
      tx.update(loot)
        .set({ quantity: twin.quantity + item.quantity })
        .where(eq(loot.id, twin.id))
        .run();
      tx.delete(loot).where(eq(loot.id, item.id)).run();
    } else {
      tx.update(loot)
        .set({ status: "available", characterId: null })
        .where(eq(loot.id, item.id))
        .run();
    }
  });
}

/** Releases every claim a character holds; returns how many. */
export function releaseAllClaims(db: Db, who: Character): number {
  return db.transaction((tx) => {
    const claims = tx
      .select({ id: loot.id })
      .from(loot)
      .where(and(eq(loot.characterId, who.id), eq(loot.status, "claimed")))
      .all();
    for (const c of claims) releaseLoot(tx, who, c.id);
    return claims.length;
  });
}

function splitPlan(db: Db, c: Campaign) {
  const chars = db
    .select()
    .from(character)
    .where(eq(character.campaignId, c.id))
    .all();
  const rows = campaignLoot(db, c.id);
  const computed = computePool(rows, chars);
  // A character with no shares and no claims sits the split out entirely,
  // so it leaves no trace in the split's history.
  const taking = computed.allocations
    .map((a, i) => ({ a, ch: chars[i]! }))
    .filter(({ a }) => a.shares > 0 || a.claimed > 0);
  return {
    chars: taking.map((t) => t.ch),
    rows,
    pool: computed.pool,
    allocations: taking.map((t) => t.a),
    leftover: computed.leftover,
  };
}

/** What a split would pay out right now, without changing anything. */
export function previewSplit(db: Db, c: Campaign): SplitView {
  const { chars, pool, allocations, leftover } = splitPlan(db, c);
  return {
    id: 0,
    createdAt: Date.now(),
    total: pool.sellable,
    totalShares: pool.totalShares,
    leftover,
    shares: allocations
      .map((a, i) => ({
        characterId: a.id,
        characterName: chars[i]!.name,
        shares: a.shares,
        gross: a.gross,
        claimed: a.claimed,
        net: a.net,
      }))
      .sort((a, b) => a.characterName.localeCompare(b.characterName)),
  };
}

/**
 * Sells the pool: records each character's payout, adds the leftover to
 * petty cash, marks claimed items bought and available items sold. Party and
 * left-behind items are untouched.
 */
export function runSplit(db: Db, c: Campaign): SplitView {
  const id = db.transaction((tx) => {
    const { chars, rows, pool, allocations, leftover } = splitPlan(tx, c);
    if (pool.totalShares === 0) {
      throw badRequest("Give at least one character a share before running a split.");
    }
    const sold = rows.filter((r) => r.status === "available" || r.status === "claimed");
    if (sold.length === 0) {
      throw badRequest("There's no available or claimed loot to split.");
    }
    const created = tx
      .insert(split)
      .values({ campaignId: c.id, total: pool.sellable, totalShares: pool.totalShares })
      .returning()
      .get();
    tx.insert(splitShare)
      .values(
        allocations.map((a, i) => ({
          splitId: created.id,
          characterId: a.id,
          characterName: chars[i]!.name,
          shares: a.shares,
          gross: a.gross,
          claimed: a.claimed,
          net: a.net,
        })),
      )
      .run();
    if (leftover > 0) {
      tx.update(campaign)
        .set({ pettyCash: sql`${campaign.pettyCash} + ${leftover}` })
        .where(eq(campaign.id, c.id))
        .run();
    }
    const ids = (status: Loot["status"]) =>
      sold.filter((r) => r.status === status).map((r) => r.id);
    const claimedIds = ids("claimed");
    const availableIds = ids("available");
    if (claimedIds.length) {
      tx.update(loot)
        .set({ status: "bought", splitId: created.id })
        .where(and(inArray(loot.id, claimedIds), eq(loot.status, "claimed")))
        .run();
    }
    if (availableIds.length) {
      tx.update(loot)
        .set({ status: "sold", splitId: created.id })
        .where(and(inArray(loot.id, availableIds), eq(loot.status, "available")))
        .run();
    }
    return created.id;
  });
  const view = splitHistory(db, c.id).find((s) => s.id === id);
  if (!view) throw new AppError(500, "The split was saved but couldn't be read back.");
  return view;
}
