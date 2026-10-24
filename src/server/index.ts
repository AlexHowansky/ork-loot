import { join } from "node:path";
import { createApp } from "./app.ts";
import { openDb } from "./db/client.ts";
import { logger } from "./lib/logger.ts";
import { MAX_IMAGE_BYTES } from "./lib/upload.ts";
import homepage from "../client/index.html";

const root = join(import.meta.dir, "../..");
const production = process.env.NODE_ENV === "production";
const dbPath = process.env.DB_PATH ?? join(root, "data/app.db");
const uploadDir = process.env.UPLOAD_DIR ?? join(root, "data/uploads");

const app = createApp({
  db: openDb(dbPath),
  uploadDir,
  secureCookies: production || process.env.SECURE_COOKIES === "1",
});

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  // No browser HMR: Bun's HMR path serves daisyUI's CSS still nested, which
  // breaks its pseudo-element rules (select arrows, date pickers, ::backdrop).
  // `bun --hot` still reloads the server, so a refresh picks up changes.
  development: !production && { hmr: false, console: true },
  // Room for a 5 MB image plus multipart overhead.
  maxRequestBodySize: MAX_IMAGE_BYTES + 512 * 1024,
  routes: {
    "/api/*": (req, srv) =>
      app.handle(req, srv.requestIP(req)?.address, () => srv.timeout(req, 0)),
    "/uploads/*": (req, srv) => app.handle(req, srv.requestIP(req)?.address),
    "/*": homepage,
  },
  error(err) {
    logger.error("server error", { err });
    return new Response("Something went wrong on our side.", { status: 500 });
  },
});

logger.info("Phat Loot listening", { url: server.url.href });
