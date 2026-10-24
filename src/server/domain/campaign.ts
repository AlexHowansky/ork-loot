import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
  type Loot,
} from "../db/schema.ts";
import { subtotal } from "../../shared/money.ts";
import type {
  CampaignInfo,
  CampaignSummary,
  CampaignView,
  LootView,
  PettyCashEntryView,
  PoolView,
  SplitView,
} from "../../shared/types.ts";
import { allocate, pettyCashFlow } from "./split.ts";
import { notFound } from "../lib/errors.ts";

export function campaignInfo(c: Campaign): CampaignInfo {
  return {
    id: c.id,
    name: c.name,
    startDate: c.startDate,
    backgroundImage: c.backgroundImage,
    currencyLabel: c.currencyLabel,
    currencyDecimals: c.currencyDecimals,
    baseReferenceUrl: c.baseReferenceUrl,
    pettyCash: c.pettyCash,
    pettyCashHold: c.pettyCashHold,
    allowDebt: c.allowDebt,
  };
}

/**
 * A loot row for the client. Players see an unidentified item's name but
 * not its description, link (whose page would give the price) or value.
 */
export function lootView(row: Loot, forGm = true): LootView {
  if (row.unidentified && !forGm) {
    return {
      ...lootView(row),
      description: null,
      link: null,
      value: null,
      subtotal: 0,
    };
  }
  return {
    id: row.id,
    sessionId: row.sessionId,
    name: row.name,
    description: row.description,
    link: row.link,
    quantity: row.quantity,
    value: row.value,
    marketPct: row.marketPct,
    unidentified: row.unidentified,
    status: row.status,
    characterId: row.characterId,
    splitId: row.splitId,
    subtotal: subtotal(row.quantity, row.value, row.marketPct),
  };
}

/** The campaign with this id if `gmId` owns it; otherwise a 404. */
export function ownedCampaign(db: Db, gmId: string, campaignId: string) {
  const row = db
    .select()
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.gmId, gmId)))
    .get();
  if (!row) throw notFound("That campaign");
  return row;
}

export function campaignLoot(db: Db, campaignId: string): Loot[] {
  return db
    .select({ loot })
    .from(loot)
    .innerJoin(session, eq(session.id, loot.sessionId))
    .where(eq(session.campaignId, campaignId))
    .orderBy(desc(session.date), asc(loot.id))
    .all()
    .map((r) => r.loot);
}

/**
 * Pool totals plus each character's projected split right now. Petty cash
 * above its hold is divided along with the loot, a shortfall below it is
 * taken from the loot first (see `pettyCashFlow`), and each character's
 * debt comes off their payout.
 */
export function computePool(
  rows: Loot[],
  characters: { id: string; shares: number; debt?: number }[],
  c: Pick<Campaign, "pettyCash" | "pettyCashHold">,
) {
  let sellable = 0;
  let party = 0;
  let claimedTotal = 0;
  const claimedBy = new Map<string, number>();
  for (const r of rows) {
    // Unidentified items are worth nothing until the GM identifies them.
    if (r.unidentified) continue;
    const sub = subtotal(r.quantity, r.value, r.marketPct);
    if (r.status === "available") sellable += sub;
    else if (r.status === "party") party += sub;
    else if (r.status === "claimed") {
      sellable += sub;
      claimedTotal += sub;
      if (r.characterId !== null) {
        claimedBy.set(r.characterId, (claimedBy.get(r.characterId) ?? 0) + sub);
      }
    }
  }
  const flow = pettyCashFlow(sellable, c.pettyCash, c.pettyCashHold);
  const { rows: allocations, leftover } = allocate(
    flow.total,
    characters.map((c) => ({
      id: c.id,
      shares: c.shares,
      claimed: claimedBy.get(c.id) ?? 0,
      debt: c.debt ?? 0,
    })),
  );
  const pool: PoolView = {
    sellable,
    party,
    claimed: claimedTotal,
    totalShares: characters.reduce((n, ch) => n + ch.shares, 0),
    pettyCashIn: flow.pettyCashIn,
  };
  return { pool, allocations, leftover, total: flow.total };
}

export function listCampaigns(db: Db, gmId: string): CampaignSummary[] {
  const rows = db
    .select()
    .from(campaign)
    .where(eq(campaign.gmId, gmId))
    .orderBy(desc(campaign.startDate), asc(campaign.name))
    .all();
  return rows.map((c) => {
    const chars = db
      .select({ id: character.id, shares: character.shares })
      .from(character)
      .where(eq(character.campaignId, c.id))
      .all();
    const sessionCount =
      db
        .select({ n: sql<number>`count(*)` })
        .from(session)
        .where(eq(session.campaignId, c.id))
        .get()?.n ?? 0;
    const { pool } = computePool(campaignLoot(db, c.id), chars, c);
    return {
      ...campaignInfo(c),
      characterCount: chars.length,
      sessionCount,
      poolTotal: pool.sellable,
    };
  });
}

/**
 * Everything the campaign board shows. Join codes, player links and who is
 * online are included only for the GM.
 */
export function campaignView(
  db: Db,
  c: Campaign,
  opts: {
    forGm: boolean;
    isOnline?: (ch: { id: string; playerId: number | null }) => boolean;
  },
): CampaignView {
  const chars = db
    .select()
    .from(character)
    .where(eq(character.campaignId, c.id))
    .orderBy(asc(character.name))
    .all();
  const sessions = db
    .select()
    .from(session)
    .where(eq(session.campaignId, c.id))
    .orderBy(desc(session.date), desc(session.id))
    .all();
  const rows = campaignLoot(db, c.id);
  const { pool, allocations } = computePool(rows, chars, c);
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.sessionId, (counts.get(r.sessionId) ?? 0) + 1);

  return {
    campaign: campaignInfo(c),
    characters: chars.map((ch, i) => {
      const a = allocations[i]!;
      return {
        id: ch.id,
        name: ch.name,
        shares: ch.shares,
        gross: a.gross,
        claimed: a.claimed,
        debt: a.debt,
        net: a.net,
        ...(opts.forGm
          ? {
              joinCode: ch.joinCode,
              hasPlayer: ch.playerId !== null,
              online: opts.isOnline?.(ch) ?? false,
            }
          : {}),
      };
    }),
    sessions: sessions.map((s) => ({
      id: s.id,
      date: s.date,
      title: s.title,
      notes: s.notes,
      itemCount: counts.get(s.id) ?? 0,
    })),
    loot: rows.map((r) => lootView(r, opts.forGm)),
    pool,
    splits: splitHistory(db, c.id),
    pettyCash: pettyCashLedger(db, c.id),
  };
}

export function pettyCashLedger(db: Db, campaignId: string): PettyCashEntryView[] {
  return db
    .select({
      id: pettyCashEntry.id,
      date: pettyCashEntry.date,
      description: pettyCashEntry.description,
      amount: pettyCashEntry.amount,
      splitId: pettyCashEntry.splitId,
    })
    .from(pettyCashEntry)
    .where(eq(pettyCashEntry.campaignId, campaignId))
    .orderBy(desc(pettyCashEntry.date), desc(pettyCashEntry.id))
    .all();
}

export function splitHistory(db: Db, campaignId: string): SplitView[] {
  const splits = db
    .select()
    .from(split)
    .where(eq(split.campaignId, campaignId))
    .orderBy(desc(split.createdAt), desc(split.id))
    .all();
  if (splits.length === 0) return [];
  const shares = db
    .select()
    .from(splitShare)
    .where(inArray(splitShare.splitId, splits.map((s) => s.id)))
    .orderBy(asc(splitShare.characterName))
    .all();
  return splits.map((s) => ({
    id: s.id,
    createdAt: s.createdAt.getTime(),
    total: s.total,
    pettyCash: s.pettyCashIn,
    totalShares: s.totalShares,
    // Whatever the shares didn't take went to petty cash.
    leftover:
      s.total -
      shares.reduce((n, sh) => (sh.splitId === s.id ? n + sh.gross : n), 0),
    shares: shares
      .filter((sh) => sh.splitId === s.id)
      .map((sh) => ({
        characterId: sh.characterId,
        characterName: sh.characterName,
        shares: sh.shares,
        gross: sh.gross,
        claimed: sh.claimed,
        debtIn: sh.debtIn,
        net: sh.net,
      })),
  }));
}
