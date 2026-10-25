import { and, eq, gt, sql } from "drizzle-orm";
import { campaign, character, loot, pettyCashEntry, session } from "../db/schema.ts";
import { requireGm } from "../lib/auth.ts";
import { badRequest } from "../lib/errors.ts";
import { idParam, readJson, uuidParam, type Router } from "../lib/http.ts";
import { sseResponse } from "../lib/events.ts";
import { logger } from "../lib/logger.ts";
import { RateLimiter } from "../lib/rate-limit.ts";
import { searchReference } from "../lib/reference-search.ts";
import { removeImage, saveImage } from "../lib/upload.ts";
import {
  campaignInfo,
  campaignView,
  listCampaigns,
  ownedCampaign,
} from "../domain/campaign.ts";
import { previewSplit, runSplit, undoSplit } from "../domain/loot.ts";
import { campaignSchema } from "../../shared/schemas.ts";

export function campaignRoutes(r: Router) {
  const referenceLimiter = new RateLimiter(60, 60_000);

  r.get("/api/campaigns", (ctx) => listCampaigns(ctx.db, requireGm(ctx).id));

  r.post("/api/campaigns", async (ctx) => {
    const gm = requireGm(ctx);
    const input = await readJson(ctx, campaignSchema);
    const row = ctx.db
      .insert(campaign)
      .values({ ...input, gmId: gm.id })
      .returning()
      .get();
    logger.info("campaign created", { requestId: ctx.requestId, campaignId: row.id });
    return campaignInfo(row);
  });

  r.get("/api/campaigns/:id", (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    return {
      ...campaignView(ctx.db, c, {
        forGm: true,
        isOnline: (ch) => ctx.events.isOnline(ch.id, ch.playerId),
      }),
      joinUrl: `${ctx.config.appUrl}/join`,
    };
  });

  r.get("/api/campaigns/:id/events", (ctx) => {
    const gm = requireGm(ctx);
    const c = ownedCampaign(ctx.db, gm.id, uuidParam(ctx));
    return sseResponse(ctx, c.id, { gm: true, gmId: gm.id });
  });

  r.patch("/api/campaigns/:id", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    const input = await readJson(ctx, campaignSchema);
    if (input.currencyDecimals !== c.currencyDecimals) {
      const hasLoot = ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(loot)
        .innerJoin(session, eq(session.id, loot.sessionId))
        .where(eq(session.campaignId, c.id))
        .get();
      if ((hasLoot?.n ?? 0) > 0) {
        throw badRequest(
          "Decimal places can't change once the campaign has loot.",
          { currencyDecimals: "Locked because loot has been recorded." },
        );
      }
      // Petty cash is held in minor units, so its meaning would change too.
      const ledger = ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(pettyCashEntry)
        .where(eq(pettyCashEntry.campaignId, c.id))
        .get();
      if (c.pettyCash !== 0 || (ledger?.n ?? 0) > 0) {
        throw badRequest(
          "Decimal places can't change once petty cash has been recorded.",
          { currencyDecimals: "Locked because petty cash has been recorded." },
        );
      }
    }
    if (c.allowDebt && !input.allowDebt) {
      const owing = ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(character)
        .where(and(eq(character.campaignId, c.id), gt(character.debt, 0)))
        .get();
      if ((owing?.n ?? 0) > 0) {
        throw badRequest(
          "Debt can't be turned off while characters still owe.",
          { allowDebt: "Locked while characters carry debt." },
        );
      }
    }
    const row = ctx.db
      .update(campaign)
      .set(input)
      .where(eq(campaign.id, c.id))
      .returning()
      .get();
    ctx.changed(c.id);
    return campaignInfo(row!);
  });

  r.get("/api/campaigns/:id/reference", async (ctx) => {
    const gm = requireGm(ctx);
    const c = ownedCampaign(ctx.db, gm.id, uuidParam(ctx));
    const q = (ctx.url.searchParams.get("q") ?? "").trim();
    if (q.length < 2 || q.length > 100) return [];
    referenceLimiter.hit(gm.id);
    return searchReference(ctx.config.fetch ?? fetch, c, q, ctx.requestId);
  });

  r.delete("/api/campaigns/:id", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    ctx.db.delete(campaign).where(eq(campaign.id, c.id)).run();
    ctx.changed(c.id);
    await removeImage(ctx.config.uploadDir, c.backgroundImage);
    logger.info("campaign deleted", { requestId: ctx.requestId, campaignId: c.id });
    return { ok: true };
  });

  r.put("/api/campaigns/:id/image", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      throw badRequest("We couldn't read that upload. Please try again.");
    }
    const file = form.get("image");
    if (!(file instanceof File)) throw badRequest("Choose an image to upload.");
    const name = await saveImage(ctx.config.uploadDir, file);
    ctx.db.update(campaign).set({ backgroundImage: name }).where(eq(campaign.id, c.id)).run();
    ctx.changed(c.id);
    await removeImage(ctx.config.uploadDir, c.backgroundImage);
    return { backgroundImage: name };
  });

  r.delete("/api/campaigns/:id/image", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    ctx.db.update(campaign).set({ backgroundImage: null }).where(eq(campaign.id, c.id)).run();
    ctx.changed(c.id);
    await removeImage(ctx.config.uploadDir, c.backgroundImage);
    return { ok: true };
  });

  r.get("/api/campaigns/:id/split/preview", (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    return previewSplit(ctx.db, c);
  });

  r.delete("/api/campaigns/:id/splits/:splitId", (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    const splitId = idParam(ctx, "splitId");
    undoSplit(ctx.db, c, splitId);
    ctx.changed(c.id);
    logger.info("loot split undone", { requestId: ctx.requestId, campaignId: c.id, splitId });
    return { ok: true };
  });

  r.post("/api/campaigns/:id/split", (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, uuidParam(ctx));
    const result = runSplit(ctx.db, c);
    ctx.changed(c.id);
    logger.info("loot split", {
      requestId: ctx.requestId,
      campaignId: c.id,
      splitId: result.id,
      total: result.total,
      leftover: result.leftover,
      debt: result.shares.reduce((n, sh) => n + Math.max(0, -sh.net), 0),
    });
    return result;
  });
}
