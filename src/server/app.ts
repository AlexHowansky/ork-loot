import { join } from "node:path";
import { AppError } from "./lib/errors.ts";
import { createEventBus } from "./lib/events.ts";
import {
  clientIdOf,
  json,
  parseCookies,
  Router,
  SECURITY_HEADERS,
  type AppConfig,
  type Ctx,
} from "./lib/http.ts";
import { logger } from "./lib/logger.ts";
import { contentTypeFor, UPLOAD_NAME } from "./lib/upload.ts";
import { authRoutes } from "./routes/auth.ts";
import { campaignRoutes } from "./routes/campaign.ts";
import { characterRoutes } from "./routes/character.ts";
import { sessionRoutes } from "./routes/session.ts";
import { lootRoutes } from "./routes/loot.ts";
import { playerRoutes } from "./routes/player.ts";
import { pettyCashRoutes } from "./routes/petty-cash.ts";
import type { LiveNotice } from "../shared/types.ts";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Rejects cross-site writes: they must come from this origin and carry a
 * JSON or multipart body (or none), which plain HTML forms elsewhere can't
 * forge alongside our cookies.
 */
function checkCsrf(req: Request, url: URL) {
  if (!UNSAFE.has(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if (originHost !== host) {
    throw new AppError(403, "That request was blocked for your safety. Please reload the page.");
  }
  const type = req.headers.get("content-type") ?? "";
  const hasBody = req.headers.get("content-length") !== "0" && req.body !== null;
  if (
    hasBody &&
    !type.startsWith("application/json") &&
    !type.startsWith("multipart/form-data")
  ) {
    throw new AppError(415, "That request was sent in a format we don't accept.");
  }
}

export function createApp(config: AppConfig) {
  const router = new Router();
  const events = createEventBus();
  authRoutes(router);
  campaignRoutes(router);
  characterRoutes(router);
  sessionRoutes(router);
  lootRoutes(router);
  playerRoutes(router);
  pettyCashRoutes(router);

  async function serveUpload(name: string): Promise<Response> {
    const file = Bun.file(join(config.uploadDir, name));
    if (!UPLOAD_NAME.test(name) || !(await file.exists())) {
      return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    }
    return new Response(file, {
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": contentTypeFor(name),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  /** `keepOpen` lifts the idle timeout for this request (a live stream). */
  async function handle(
    req: Request,
    ip = "unknown",
    keepOpen: () => void = () => {},
  ): Promise<Response> {
    const started = performance.now();
    const url = new URL(req.url);
    const requestId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const touched = new Map<string, LiveNotice[]>();
    const ctx: Ctx = {
      req,
      url,
      params: {},
      config,
      db: config.db,
      ip,
      requestId,
      cookies: parseCookies(req.headers.get("cookie")),
      setCookies: [],
      events,
      clientId: clientIdOf(req),
      touched,
      changed: (campaignId, notice) => {
        const notices = touched.get(campaignId) ?? [];
        if (notice) notices.push(notice);
        touched.set(campaignId, notices);
      },
      keepOpen,
    };
    let res: Response;
    try {
      if (url.pathname.startsWith("/uploads/")) {
        res = await serveUpload(url.pathname.slice("/uploads/".length));
      } else {
        checkCsrf(req, url);
        const match = router.match(req.method, url.pathname);
        if (match === null) {
          throw new AppError(404, "That page couldn't be found.");
        }
        if (match === "method") {
          throw new AppError(405, "That action isn't available here.");
        }
        ctx.params = match.params;
        const result = await match.handler(ctx);
        res = result instanceof Response ? result : json(result ?? { ok: true });
      }
    } catch (err) {
      res = errorResponse(err, requestId);
    }
    if (res.status < 400) {
      for (const [campaignId, notices] of touched) {
        logger.debug("campaign changed", { requestId, campaignId });
        events.publish(campaignId, ctx.clientId, notices);
      }
    }
    for (const cookie of ctx.setCookies) res.headers.append("Set-Cookie", cookie);
    res.headers.set("X-Request-Id", requestId);
    logger.info("request", {
      requestId,
      method: req.method,
      path: url.pathname,
      status: res.status,
      ms: Math.round(performance.now() - started),
    });
    return res;
  }

  return { handle, events };
}

function errorResponse(err: unknown, requestId: string): Response {
  if (err instanceof AppError) {
    return json({ error: err.message, fields: err.fields }, err.status);
  }
  logger.error("unhandled error", { requestId, err });
  return json(
    { error: `Something went wrong on our side. (Reference ${requestId})` },
    500,
  );
}
