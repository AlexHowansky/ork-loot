import { and, eq, gte, inArray, isNull, ne, type SQL } from "drizzle-orm";
import type { DbOrTx as Db } from "../db/client.ts";
import {
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
export function lootInCampaign(db: Db, lootId: number, campaignId: number) {
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

/**
 * Claims `quantity` of an active loot row for a character. Claiming part
 * of a stack leaves the rest active on the original row and puts the
 * claimed part on a new row. The status and quantity guards in each
 * UPDATE stop two players from claiming the same units.
 */
export function claimLoot(
  db: Db,
  who: Character,
  lootId: number,
  quantity: number,
): Loot {
  return db.transaction((tx) => {
    const item = lootInCampaign(tx, lootId, who.campaignId);
    if (item.status !== "active") throw alreadyGone();
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
            eq(loot.status, "active"),
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
          eq(loot.status, "active"),
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
 * identical active row from the same session when there is one.
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
          eq(loot.status, "active"),
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
        .set({ status: "active", characterId: null })
        .where(eq(loot.id, item.id))
        .run();
    }
  });
}

function splitPlan(db: Db, c: Campaign) {
  const chars = db
    .select()
    .from(character)
    .where(eq(character.campaignId, c.id))
    .all();
  const rows = campaignLoot(db, c.id);
  const { pool, allocations } = computePool(rows, chars);
  return { chars, rows, pool, allocations };
}

/** What a split would pay out right now, without changing anything. */
export function previewSplit(db: Db, c: Campaign): SplitView {
  const { chars, pool, allocations } = splitPlan(db, c);
  return {
    id: 0,
    createdAt: Date.now(),
    total: pool.sellable,
    totalShares: pool.totalShares,
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
 * Sells the pool: records each character's payout, marks claimed items
 * bought and active items sold. Party and left-behind items are untouched.
 */
export function runSplit(db: Db, c: Campaign): SplitView {
  const id = db.transaction((tx) => {
    const { chars, rows, pool, allocations } = splitPlan(tx, c);
    if (chars.length === 0) {
      throw badRequest("Add at least one character before running a split.");
    }
    const sold = rows.filter((r) => r.status === "active" || r.status === "claimed");
    if (sold.length === 0) {
      throw badRequest("There's no active or claimed loot to split.");
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
    const ids = (status: Loot["status"]) =>
      sold.filter((r) => r.status === status).map((r) => r.id);
    const claimedIds = ids("claimed");
    const activeIds = ids("active");
    if (claimedIds.length) {
      tx.update(loot)
        .set({ status: "bought", splitId: created.id })
        .where(and(inArray(loot.id, claimedIds), eq(loot.status, "claimed")))
        .run();
    }
    if (activeIds.length) {
      tx.update(loot)
        .set({ status: "sold", splitId: created.id })
        .where(and(inArray(loot.id, activeIds), eq(loot.status, "active")))
        .run();
    }
    return created.id;
  });
  const view = splitHistory(db, c.id).find((s) => s.id === id);
  if (!view) throw new AppError(500, "The split was saved but couldn't be read back.");
  return view;
}
