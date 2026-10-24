import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.ts";
import { openDb, type Db } from "../src/server/db/client.ts";
import { gm } from "../src/server/db/schema.ts";
import { hashPassword } from "../src/server/lib/auth.ts";
import type { Mail, Mailer } from "../src/server/lib/mail.ts";

export const ORIGIN = "http://loot.test";

/** Reference-site requests made by the app, answered by `referenceReply`. */
export const referenceCalls: { url: string; body: any }[] = [];
export let referenceReply: () => Response = () => Response.json({ hits: { hits: [] } });
export function setReferenceReply(reply: () => Response) {
  referenceReply = reply;
}

const stubFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  referenceCalls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) });
  return referenceReply();
}) as typeof fetch;

/** Mail the app has sent. */
export const sentMail: Mail[] = [];
const stubMailer: Mailer = {
  async send(mail) {
    sentMail.push(mail);
  },
};

export function makeApp() {
  const db = openDb(":memory:");
  const uploadDir = mkdtempSync(join(tmpdir(), "phat-loot-"));
  referenceCalls.length = 0;
  sentMail.length = 0;
  setReferenceReply(() => Response.json({ hits: { hits: [] } }));
  const app = createApp({
    db,
    uploadDir,
    secureCookies: false,
    fetch: stubFetch,
    mailer: stubMailer,
    appUrl: ORIGIN,
  });
  return { db, uploadDir, app };
}

export async function addGm(db: Db, email: string, password = "correct horse battery") {
  const passwordHash = await hashPassword(password);
  return db.insert(gm).values({ email, passwordHash }).returning().get();
}

/** A browser-like client with its own cookie jar. */
export class Client {
  private jar = new Map<string, string>();
  constructor(
    private app: ReturnType<typeof createApp>,
    private ip = "10.0.0.1",
  ) {}

  async raw(method: string, path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) headers.set("origin", ORIGIN);
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.set("cookie", cookie);
    const res = await this.app.handle(
      new Request(ORIGIN + path, { ...init, method, headers }),
      this.ip,
    );
    for (const set of res.headers.getSetCookie()) {
      const [pair = ""] = set.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/Max-Age=0/.test(set)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }

  async call<T = any>(method: string, path: string, body?: unknown) {
    const res = await this.raw(method, path, {
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  get = <T = any>(p: string) => this.call<T>("GET", p);
  post = <T = any>(p: string, b: unknown = {}) => this.call<T>("POST", p, b);
  patch = <T = any>(p: string, b: unknown) => this.call<T>("PATCH", p, b);
  del = <T = any>(p: string) => this.call<T>("DELETE", p);

  login(email: string, password = "correct horse battery") {
    return this.post("/api/auth/login", { email, password });
  }
}
