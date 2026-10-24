import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { campaign, session } from "../db/schema.ts";
import { requireGm } from "../lib/auth.ts";
import { notFound } from "../lib/errors.ts";
import { idParam, readJson, uuidParam, type Router } from "../lib/http.ts";
import { logger } from "../lib/logger.ts";
import { ownedCampaign } from "../domain/campaign.ts";
import { sessionSchema } from "../../shared/schemas.ts";

/** The session with this id if `gmId` runs its campaign; else a 404. */
export function ownedSession(db: Db, gmId: string, sessionId: number) {
  const row = db
    .select({ session, campaign })
    .from(session)
    .innerJoin(campaign, eq(campaign.id, session.campaignId))
    .where(and(eq(session.id, sessionId), eq(campaign.gmId, gmId)))
    .get();
  if (!row) throw notFound("That session");
  return row;
}

export function sessionRoutes(r: Router) {
  r.post("/api/campaigns/:id/sessions", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    const input = await readJson(ctx, sessionSchema);
    const row = ctx.db
      .insert(session)
      .values({ ...input, campaignId: c.id })
      .returning()
      .get();
    ctx.changed(c.id);
    logger.info("session created", { requestId: ctx.requestId, sessionId: row.id });
    return { id: row.id };
  });

  r.patch("/api/sessions/:id", async (ctx) => {
    const { session: s } = ownedSession(ctx.db, requireGm(ctx).id, idParam(ctx));
    const input = await readJson(ctx, sessionSchema);
    ctx.db.update(session).set(input).where(eq(session.id, s.id)).run();
    ctx.changed(s.campaignId);
    return { id: s.id };
  });

  r.delete("/api/sessions/:id", (ctx) => {
    const { session: s } = ownedSession(ctx.db, requireGm(ctx).id, idParam(ctx));
    ctx.db.delete(session).where(eq(session.id, s.id)).run();
    ctx.changed(s.campaignId);
    logger.info("session deleted", { requestId: ctx.requestId, sessionId: s.id });
    return { ok: true };
  });
}
