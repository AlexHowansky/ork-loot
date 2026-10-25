import { isIP } from "node:net";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { AppError, badRequest } from "./errors.ts";
import type { EventBus } from "./events.ts";
import type { Mailer } from "./mail.ts";
import type { LiveNotice } from "../../shared/types.ts";

export interface AppConfig {
  db: Db;
  uploadDir: string;
  /** Mark cookies Secure (production behind HTTPS). */
  secureCookies: boolean;
  /** Used to reach reference sites; tests pass a stub. */
  fetch?: typeof fetch;
  /** Sends password reset links; tests pass a stub. */
  mailer: Mailer;
  /** The public address of the app, e.g. https://loot.example.com, for links in mail. */
  appUrl: string;
  /**
   * How many reverse proxies sit in front of the app. When above 0 the
   * client IP is read from `X-Forwarded-For`; 0 (the default) uses the
   * socket address. Only set this when the app is reachable solely through
   * those proxies, or clients can choose their own IP.
   */
  trustProxy?: number;
}

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  config: AppConfig;
  db: Db;
  ip: string;
  requestId: string;
  cookies: Map<string, string>;
  /** Set-Cookie header values to attach to the response. */
  setCookies: string[];
  events: EventBus;
  /** The browser tab that sent this request, from `X-Client-Id`. */
  clientId: string | null;
  /**
   * Campaigns this request changed, with any notices for other tabs;
   * announced if it succeeds.
   */
  touched: Map<string, LiveNotice[]>;
  changed(campaignId: string, notice?: LiveNotice): void;
  /** Lifts the server's idle timeout, for long-lived streams. */
  keepOpen(): void;
}

const CLIENT_ID = /^[A-Za-z0-9_-]{1,36}$/;

/** The `X-Client-Id` header, if it looks like one of ours. */
export function clientIdOf(req: Request): string | null {
  const raw = req.headers.get("x-client-id");
  return raw !== null && CLIENT_ID.test(raw) ? raw : null;
}

/**
 * The client's IP. With `trustProxy` proxies in front, it's the entry that
 * many from the right of `X-Forwarded-For`: each proxy appends the address
 * it saw, so entries further left were written by the client and can't be
 * trusted. Falls back to the socket address when the header doesn't hold a
 * usable entry.
 */
export function clientIpOf(req: Request, socketIp: string, trustProxy: number): string {
  if (trustProxy <= 0) return socketIp;
  const hops = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = hops[hops.length - trustProxy];
  return ip !== undefined && isIP(ip) ? ip : socketIp;
}

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Route {
  method: Method;
  segments: string[];
  handler: Handler;
}

/** A small path router supporting `:param` segments. */
export class Router {
  private routes: Route[] = [];

  add(method: Method, pattern: string, handler: Handler): this {
    this.routes.push({ method, segments: split(pattern), handler });
    return this;
  }

  get = (p: string, h: Handler) => this.add("GET", p, h);
  post = (p: string, h: Handler) => this.add("POST", p, h);
  put = (p: string, h: Handler) => this.add("PUT", p, h);
  patch = (p: string, h: Handler) => this.add("PATCH", p, h);
  delete = (p: string, h: Handler) => this.add("DELETE", p, h);

  /** Returns the handler and params, "method" if only the method is wrong. */
  match(
    method: string,
    path: string,
  ): { handler: Handler; params: Record<string, string> } | "method" | null {
    const parts = split(path);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (!params) continue;
      if (route.method === method) return { handler: route.handler, params };
      pathMatched = true;
    }
    return pathMatched ? "method" : null;
  }
}

function split(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function matchSegments(
  pattern: string[],
  parts: string[],
): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    const v = parts[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(v);
    else if (p !== v) return null;
  }
  return params;
}

export function parseCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) map.set(key, decodeURIComponent(value));
  }
  return map;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${opts.maxAge}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Parses a numeric route parameter, failing with a 404 when malformed. */
export function idParam(ctx: Ctx, name = "id"): number {
  const raw = ctx.params[name] ?? "";
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id)) {
    throw new AppError(404, "That page couldn't be found.");
  }
  return id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID route parameter, lower-cased; anything else is a 404. */
export function uuidParam(ctx: Ctx, name = "id"): string {
  const raw = ctx.params[name] ?? "";
  if (!UUID.test(raw)) throw new AppError(404, "That page couldn't be found.");
  return raw.toLowerCase();
}

/** Converts zod issues into a field → message map for forms. */
export function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Reads and validates a JSON body. */
export async function readJson<T extends z.ZodType>(
  ctx: Ctx,
  schema: T,
): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await ctx.req.json();
  } catch {
    throw badRequest("We couldn't read that request. Please try again.");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields = zodFields(result.error);
    const first = Object.values(fields)[0] ?? "Please check the form.";
    throw badRequest(
      Object.keys(fields).length > 1 ? "Please fix the highlighted fields." : first,
      fields,
    );
  }
  return result.data;
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { ...SECURITY_HEADERS, "Cache-Control": "no-store" },
  });
}
