import { z } from "zod";
import type { Db } from "../db/client.ts";
import { AppError, badRequest } from "./errors.ts";

export interface AppConfig {
  db: Db;
  uploadDir: string;
  /** Mark cookies Secure (production behind HTTPS). */
  secureCookies: boolean;
  /** Used to reach reference sites; tests pass a stub. */
  fetch?: typeof fetch;
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
