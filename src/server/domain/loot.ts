import { and, desc, eq, gte, inArray, isNull, ne, type SQL } from "drizzle-orm";
import type { DbOrTx as Db } from "../db/client.ts";
import {
  campaign,
  character,
  loot,
  pettyCashEntry,
  session,
  split,
  splitShare,
  type Campaign,
  type Character,
  type Loot,
} from "../db/schema.ts";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.ts";
import { campaignLoot, computePool, splitHistory } from "./campaign.ts";
import { listNames } from "../../shared/names.ts";
import type { LiveNotice, SplitView } from "../../shared/types.ts";

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
 * UPDATE stop two players from claiming the same units. Only the GM can
 * claim an unidentified item.
 */
export function claimLoot(
  db: Db,
  who: Character,
  lootId: number,
  quantity: number,
  byGm = false,
): Loot {
  assertCanClaim(who);
  return db.transaction((tx) => {
    const item = lootInCampaign(tx, lootId, who.campaignId);
    if (item.status !== "available") throw alreadyGone();
    if (item.unidentified && !byGm) {
      throw badRequest("That item hasn't been identified yet, so it can't be claimed.");
    }
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
        location: item.location,
        description: item.description,
        link: item.link,
        quantity,
        value: item.value,
        marketPct: item.marketPct,
        unidentified: item.unidentified,
        status: "claimed",
        characterId: who.id,
      })
      .returning()
      .get();
  });
}

/**
 * Tells other tabs that a character claimed or released some loot, or
 * that the GM did on their behalf.
 */
export function claimNotice(
  kind: LiveNotice["kind"],
  who: Character,
  item: Loot,
  byGm = false,
): LiveNotice {
  return { kind, byGm, character: who.name, item: item.name, quantity: item.quantity };
}

const sameOrNull = <T>(col: Parameters<typeof eq>[0], v: T | null): SQL =>
  v === null ? isNull(col) : eq(col, v);

/**
 * Releases a character's claim back to the pool, merging it into an
 * identical available row from the same session when there is one.
 * Returns the claim as it was before its release.
 */
export function releaseLoot(db: Db, who: Character, lootId: number): Loot {
  return db.transaction((tx) => {
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
          eq(loot.unidentified, item.unidentified),
          sameOrNull(loot.location, item.location),
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
    return item;
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

function splitPlan(db: Db, campaignId: string) {
  // Read afresh so a split inside a transaction sees current petty cash.
  const c = db.select().from(campaign).where(eq(campaign.id, campaignId)).get();
  if (!c) throw notFound("That campaign");
  const chars = db
    .select()
    .from(character)
    .where(eq(character.campaignId, c.id))
    .all();
  const rows = campaignLoot(db, c.id);
  const computed = computePool(rows, chars, c);
  // A character with no shares and no claims sits the split out entirely,
  // so it leaves no trace in the split's history.
  const taking = computed.allocations
    .map((a, i) => ({ a, ch: chars[i]! }))
    .filter(({ a }) => a.shares > 0 || a.claimed > 0);
  return {
    allowDebt: c.allowDebt,
    pettyCash: c.pettyCash,
    pettyCashIn: computed.pool.pettyCashIn,
    total: computed.total,
    chars: taking.map((t) => t.ch),
    rows,
    pool: computed.pool,
    allocations: taking.map((t) => t.a),
    leftover: computed.leftover,
  };
}

/** What a split would pay out right now, without changing anything. */
export function previewSplit(db: Db, c: Campaign): SplitView {
  const { chars, pool, allocations, leftover, total, pettyCashIn } = splitPlan(db, c.id);
  return {
    id: 0,
    createdAt: Date.now(),
    total,
    pettyCash: pettyCashIn,
    totalShares: pool.totalShares,
    leftover,
    shares: allocations
      .map((a, i) => ({
        characterId: a.id,
        characterName: chars[i]!.name,
        shares: a.shares,
        gross: a.gross,
        claimed: a.claimed,
        debtIn: a.debt,
        net: a.net,
      }))
      .sort((a, b) => a.characterName.localeCompare(b.characterName)),
  };
}

/**
 * Sells the pool, first bringing petty cash to its hold: any excess is paid
 * out with the loot, any shortfall is kept back from it. Records each
 * character's payout, adds what doesn't divide evenly to petty cash, writes
 * the net change to the petty cash ledger, and marks claimed items bought
 * and available items sold. Party and left-behind items are untouched. A
 * payout below zero becomes the character's debt if the campaign allows
 * it; otherwise the split is refused.
 */
export function runSplit(db: Db, c: Campaign): SplitView {
  const id = db.transaction((tx) => {
    const { allowDebt, chars, rows, pool, allocations, leftover, total, pettyCash, pettyCashIn } =
      splitPlan(tx, c.id);
    if (pool.totalShares === 0) {
      throw badRequest("Give at least one character a share before running a split.");
    }
    // Unidentified items stay in the pool until they can be valued.
    const sold = rows.filter(
      (r) => !r.unidentified && (r.status === "available" || r.status === "claimed"),
    );
    if (sold.length === 0) {
      throw badRequest("There's no available or claimed loot to split.");
    }
    if (!allowDebt) {
      const owing = allocations
        .map((a, i) => (a.net < 0 ? chars[i]!.name : null))
        .filter((n) => n !== null);
      if (owing.length) {
        throw badRequest(
          `${listNames(owing)} would end the split owing, because their claims ` +
            "are worth more than their share. Release some claims, or allow " +
            "debt in the campaign's settings.",
        );
      }
    }
    const created = tx
      .insert(split)
      .values({ campaignId: c.id, total, pettyCashIn, totalShares: pool.totalShares })
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
          debtIn: a.debt,
          net: a.net,
        })),
      )
      .run();
    for (const a of allocations) {
      const debt = Math.max(0, -a.net);
      if (debt !== a.debt) {
        tx.update(character).set({ debt }).where(eq(character.id, a.id)).run();
      }
    }
    const change = leftover - pettyCashIn;
    if (change !== 0) {
      tx.update(campaign)
        .set({ pettyCash: pettyCash + change })
        .where(eq(campaign.id, c.id))
        .run();
      tx.insert(pettyCashEntry)
        .values({
          campaignId: c.id,
          date: created.createdAt.toISOString().slice(0, 10),
          description: "Loot split",
          amount: change,
          splitId: created.id,
        })
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

/**
 * Undoes the campaign's most recent split: bought items go back to their
 * claimants and sold items back to the pool, each character's debt returns
 * to what it was, the split's change to petty cash is reversed (along with
 * its ledger entry), and the split leaves the history. A claim can't go
 * back to a character who now has no shares, so that item returns to the
 * pool. If petty cash has since been spent below what the split added, the
 * undo is refused rather than leave it negative.
 */
export function undoSplit(db: Db, c: Campaign, splitId: number): void {
  db.transaction((tx) => {
    const latest = tx
      .select()
      .from(split)
      .where(eq(split.campaignId, c.id))
      .orderBy(desc(split.createdAt), desc(split.id))
      .get();
    if (!latest || latest.id !== splitId) {
      throw conflict(
        "Only the most recent split can be undone. The list has been refreshed.",
      );
    }
    const taking = tx.select().from(splitShare).where(eq(splitShare.splitId, splitId)).all();
    const leftover = latest.total - taking.reduce((n, sh) => n + sh.gross, 0);
    const change = leftover - latest.pettyCashIn;
    const current = tx
      .select({ pettyCash: campaign.pettyCash })
      .from(campaign)
      .where(eq(campaign.id, c.id))
      .get()!.pettyCash;
    if (current - change < 0) {
      throw badRequest(
        "This split can't be undone, because petty cash has since been spent " +
          "below what the split put in. Add a petty cash entry paying it back first.",
      );
    }
    const rows = tx.select().from(loot).where(eq(loot.splitId, splitId)).all();
    const shares = new Map(
      tx
        .select({ id: character.id, shares: character.shares })
        .from(character)
        .where(eq(character.campaignId, c.id))
        .all()
        .map((ch) => [ch.id, ch.shares]),
    );
    for (const r of rows) {
      const backToClaimant =
        r.status === "bought" && r.characterId !== null && (shares.get(r.characterId) ?? 0) > 0;
      const status: Loot["status"] = backToClaimant
        ? "claimed"
        : r.status === "bought" || r.status === "sold"
          ? "available"
          : r.status;
      tx.update(loot)
        .set({
          status,
          splitId: null,
          characterId: status === "available" ? null : r.characterId,
        })
        .where(eq(loot.id, r.id))
        .run();
    }
    for (const sh of taking) {
      if (sh.characterId === null) continue;
      tx.update(character)
        .set({ debt: sh.debtIn })
        .where(eq(character.id, sh.characterId))
        .run();
    }
    tx.update(campaign)
      .set({ pettyCash: current - change })
      .where(eq(campaign.id, c.id))
      .run();
    // Its petty cash ledger entry goes with it.
    tx.delete(split).where(eq(split.id, splitId)).run();
  });
}
