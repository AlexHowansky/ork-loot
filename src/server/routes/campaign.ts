import { eq, sql } from "drizzle-orm";
import { campaign, loot, session } from "../db/schema.ts";
import { requireGm } from "../lib/auth.ts";
import { badRequest } from "../lib/errors.ts";
import { idParam, readJson, type Router } from "../lib/http.ts";
import { logger } from "../lib/logger.ts";
import { removeImage, saveImage } from "../lib/upload.ts";
import {
  campaignInfo,
  campaignView,
  listCampaigns,
  ownedCampaign,
} from "../domain/campaign.ts";
import { previewSplit, runSplit } from "../domain/loot.ts";
import { campaignSchema } from "../../shared/schemas.ts";

export function campaignRoutes(r: Router) {
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
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, idParam(ctx));
    return campaignView(ctx.db, c, { forGm: true });
  });

  r.patch("/api/campaigns/:id", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, idParam(ctx));
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
      if (c.pettyCash !== 0) {
        throw badRequest(
          "Decimal places can't change while there's petty cash.",
          { currencyDecimals: "Locked because petty cash is held." },
        );
      }
    }
    const row = ctx.db
      .update(campaign)
      .set(input)
      .where(eq(campaign.id, c.id))
      .returning()
      .get();
    return campaignInfo(row!);
  });

  r.delete("/api/campaigns/:id", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, idParam(ctx));
    ctx.db.delete(campaign).where(eq(campaign.id, c.id)).run();
    await removeImage(ctx.config.uploadDir, c.backgroundImage);
    logger.info("campaign deleted", { requestId: ctx.requestId, campaignId: c.id });
    return { ok: true };
  });

  r.put("/api/campaigns/:id/image", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, idParam(ctx));
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
    await removeImage(ctx.config.uploadDir, c.backgroundImage);
    return { backgroundImage: name };
  });

  r.delete("/api/campaigns/:id/image", async (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, idParam(ctx));
    ctx.db.update(campaign).set({ backgroundImage: null }).where(eq(campaign.id, c.id)).run();
    await removeImage(ctx.config.uploadDir, c.backgroundImage);
    return { ok: true };
  });

  r.get("/api/campaigns/:id/split/preview", (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, idParam(ctx));
    return previewSplit(ctx.db, c);
  });

  r.post("/api/campaigns/:id/split", (ctx) => {
    const c = ownedCampaign(ctx.db, requireGm(ctx).id, idParam(ctx));
    const result = runSplit(ctx.db, c);
    logger.info("loot split", {
      requestId: ctx.requestId,
      campaignId: c.id,
      splitId: result.id,
      total: result.total,
    });
    return result;
  });
}
