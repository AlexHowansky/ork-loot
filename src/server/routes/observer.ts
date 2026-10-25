import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { campaign, observer } from "../db/schema.ts";
import { issueJoinCode, requireGm } from "../lib/auth.ts";
import { conflict, notFound } from "../lib/errors.ts";
import { readJson, uuidParam, type Router } from "../lib/http.ts";
import { logger } from "../lib/logger.ts";
import { ownedCampaign } from "../domain/campaign.ts";
import { observerSchema } from "../../shared/schemas.ts";

/** The observer with this id if `gmId` runs its campaign; else a 404. */
function ownedObserver(db: Db, gmId: string, observerId: string) {
  const row = db
    .select({ observer })
    .from(observer)
    .innerJoin(campaign, eq(campaign.id, observer.campaignId))
    .where(and(eq(observer.id, observerId), eq(campaign.gmId, gmId)))
    .get();
  if (!row) throw notFound("That observer");
  return row.observer;
}

function assertNameFree(db: Db, campaignId: string, name: string, exceptId = "") {
  const clash = db
    .select({ id: observer.id })
    .from(observer)
    .where(
      and(
        eq(observer.campaignId, campaignId),
        sql`lower(${observer.name}) = lower(${name})`,
        ne(observer.id, exceptId),
      ),
    )
    .get();
  if (clash) {
    throw conflict(`There's already an observer called “${name}” in this campaign.`);
  }
}

/**
 * The GM's management of observers. What an observer's browser asks for
 * is under `/api/watch`, in the player routes.
 */
export function observerRoutes(r: Router) {
  r.post("/api/campaigns/:id/observers", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    const input = await readJson(ctx, observerSchema);
    assertNameFree(ctx.db, c.id, input.name);
    const row = ctx.db.transaction((tx) => {
      const o = tx
        .insert(observer)
        .values({ ...input, campaignId: c.id })
        .returning()
        .get();
      issueJoinCode(tx, { observerId: o.id });
      return o;
    });
    ctx.changed(c.id);
    logger.info("observer created", { requestId: ctx.requestId, observerId: row.id });
    return { id: row.id };
  });

  r.patch("/api/observers/:id", async (ctx) => {
    const o = ownedObserver(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    const input = await readJson(ctx, observerSchema);
    assertNameFree(ctx.db, o.campaignId, input.name, o.id);
    ctx.db.update(observer).set(input).where(eq(observer.id, o.id)).run();
    ctx.changed(o.campaignId);
    return { id: o.id };
  });

  r.post("/api/observers/:id/code", (ctx) => {
    const o = ownedObserver(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    // A new code also signs out whoever holds the observer now.
    const joinCode = ctx.db.transaction((tx) => {
      tx.update(observer).set({ playerId: null }).where(eq(observer.id, o.id)).run();
      return issueJoinCode(tx, { observerId: o.id });
    });
    const streams = ctx.events.revoke(o.id);
    ctx.changed(o.campaignId);
    logger.info("observer join code regenerated", {
      requestId: ctx.requestId,
      observerId: o.id,
      signedOut: o.playerId !== null,
      streams,
    });
    return { joinCode };
  });

  r.delete("/api/observers/:id", (ctx) => {
    const o = ownedObserver(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    ctx.db.delete(observer).where(eq(observer.id, o.id)).run();
    // Their open pages go back to the start, as with a new code.
    const streams = ctx.events.revoke(o.id);
    ctx.changed(o.campaignId);
    logger.info("observer deleted", { requestId: ctx.requestId, observerId: o.id, streams });
    return { ok: true };
  });
}
