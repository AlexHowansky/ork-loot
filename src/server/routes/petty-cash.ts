import { and, eq } from "drizzle-orm";
import type { DbOrTx as Db } from "../db/client.ts";
import { campaign, pettyCashEntry } from "../db/schema.ts";
import { requireGm } from "../lib/auth.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { idParam, readJson, uuidParam, type Router } from "../lib/http.ts";
import { logger } from "../lib/logger.ts";
import { assertMoneyInRange, ownedCampaign } from "../domain/campaign.ts";
import { formatMoney } from "../../shared/money.ts";
import { pettyCashEntrySchema } from "../../shared/schemas.ts";

/** A hand-written ledger entry in a campaign `gmId` runs; else a 404. */
function ownedEntry(db: Db, gmId: string, entryId: number) {
  const row = db
    .select({ entry: pettyCashEntry, campaign })
    .from(pettyCashEntry)
    .innerJoin(campaign, eq(campaign.id, pettyCashEntry.campaignId))
    .where(and(eq(pettyCashEntry.id, entryId), eq(campaign.gmId, gmId)))
    .get();
  if (!row) throw notFound("That petty cash entry");
  if (row.entry.splitId !== null) {
    throw badRequest(
      "That entry was made by a loot split. Undo the split to remove it.",
    );
  }
  return row;
}

/**
 * Moves petty cash by `change`, refusing to take it below zero or the
 * campaign past what it can record. Reads the balance inside the caller's
 * transaction, so it can't race another write.
 */
function adjustPettyCash(tx: Db, campaignId: string, change: number) {
  const c = tx.select().from(campaign).where(eq(campaign.id, campaignId)).get();
  if (!c) throw notFound("That campaign");
  if (c.pettyCash + change < 0) {
    const money = (n: number) => formatMoney(n, c.currencyDecimals, c.currencyLabel);
    throw badRequest(
      `Petty cash only holds ${money(c.pettyCash)}, so it can't pay out ` +
        `${money(-change)}.`,
      { amount: "That's more than petty cash holds." },
    );
  }
  tx.update(campaign)
    .set({ pettyCash: c.pettyCash + change })
    .where(eq(campaign.id, campaignId))
    .run();
  if (change > 0) assertMoneyInRange(tx, campaignId, "amount");
}

export function pettyCashRoutes(r: Router) {
  r.post("/api/campaigns/:id/petty-cash", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    const input = await readJson(ctx, pettyCashEntrySchema);
    const row = ctx.db.transaction((tx) => {
      adjustPettyCash(tx, c.id, input.amount);
      return tx
        .insert(pettyCashEntry)
        .values({ ...input, campaignId: c.id })
        .returning()
        .get();
    });
    ctx.changed(c.id);
    logger.info("petty cash entry added", {
      requestId: ctx.requestId,
      campaignId: c.id,
      entryId: row.id,
      amount: row.amount,
    });
    return { id: row.id };
  });

  r.patch("/api/petty-cash/:id", async (ctx) => {
    const { entry } = ownedEntry(ctx.db, requireGm(ctx).id, idParam(ctx));
    const input = await readJson(ctx, pettyCashEntrySchema);
    ctx.db.transaction((tx) => {
      adjustPettyCash(tx, entry.campaignId, input.amount - entry.amount);
      tx.update(pettyCashEntry).set(input).where(eq(pettyCashEntry.id, entry.id)).run();
    });
    ctx.changed(entry.campaignId);
    logger.info("petty cash entry changed", {
      requestId: ctx.requestId,
      entryId: entry.id,
      amount: input.amount,
    });
    return { id: entry.id };
  });

  r.delete("/api/petty-cash/:id", (ctx) => {
    const { entry } = ownedEntry(ctx.db, requireGm(ctx).id, idParam(ctx));
    ctx.db.transaction((tx) => {
      adjustPettyCash(tx, entry.campaignId, -entry.amount);
      tx.delete(pettyCashEntry).where(eq(pettyCashEntry.id, entry.id)).run();
    });
    ctx.changed(entry.campaignId);
    logger.info("petty cash entry deleted", { requestId: ctx.requestId, entryId: entry.id });
    return { ok: true };
  });
}
