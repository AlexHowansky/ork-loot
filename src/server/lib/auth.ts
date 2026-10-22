import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { character, gm, login, player } from "../db/schema.ts";
import { AppError, notFound, unauthorized } from "./errors.ts";
import { serializeCookie, type Ctx } from "./http.ts";
import { logger } from "./logger.ts";

export const GM_COOKIE = "pl_gm";
export const PLAYER_COOKIE = "pl_player";

const DAY = 24 * 60 * 60 * 1000;
const LOGIN_TTL = 30 * DAY;
/** Player cookies are meant to last forever; ten years is close enough. */
const PLAYER_MAX_AGE = 10 * 365 * 24 * 60 * 60;

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

let dummyHash: Promise<string> | undefined;

/**
 * Checks a username and password. Unknown usernames still pay for a hash
 * verification so response timing doesn't reveal which usernames exist.
 */
export async function verifyCredentials(
  db: Db,
  username: string,
  password: string,
) {
  const row = db.select().from(gm).where(eq(gm.username, username)).get();
  if (!row) {
    dummyHash ??= hashPassword("not-a-real-password");
    await Bun.password.verify(password, await dummyHash);
    return null;
  }
  return (await Bun.password.verify(password, row.passwordHash)) ? row : null;
}

export function startLogin(ctx: Ctx, gmId: number) {
  const token = newToken();
  ctx.db
    .insert(login)
    .values({ id: hashToken(token), gmId, expiresAt: new Date(Date.now() + LOGIN_TTL) })
    .run();
  ctx.setCookies.push(
    serializeCookie(GM_COOKIE, token, {
      maxAge: LOGIN_TTL / 1000,
      secure: ctx.config.secureCookies,
    }),
  );
}

export function endLogin(ctx: Ctx) {
  const token = ctx.cookies.get(GM_COOKIE);
  if (token) ctx.db.delete(login).where(eq(login.id, hashToken(token))).run();
  ctx.setCookies.push(
    serializeCookie(GM_COOKIE, "", { maxAge: 0, secure: ctx.config.secureCookies }),
  );
}

/** The signed-in GM, or null. Extends the login when it's used. */
export function currentGm(ctx: Ctx) {
  const token = ctx.cookies.get(GM_COOKIE);
  if (!token) return null;
  const id = hashToken(token);
  const row = ctx.db
    .select({ gm, login })
    .from(login)
    .innerJoin(gm, eq(gm.id, login.gmId))
    .where(eq(login.id, id))
    .get();
  if (!row) return null;
  const now = Date.now();
  if (row.login.expiresAt.getTime() < now) {
    ctx.db.delete(login).where(eq(login.id, id)).run();
    return null;
  }
  // Slide the expiry forward at most once a day to limit writes.
  if (row.login.expiresAt.getTime() - now < LOGIN_TTL - DAY) {
    ctx.db
      .update(login)
      .set({ expiresAt: new Date(now + LOGIN_TTL) })
      .where(eq(login.id, id))
      .run();
    ctx.setCookies.push(
      serializeCookie(GM_COOKIE, token, {
        maxAge: LOGIN_TTL / 1000,
        secure: ctx.config.secureCookies,
      }),
    );
  }
  return { id: row.gm.id, username: row.gm.username };
}

export function requireGm(ctx: Ctx) {
  const current = currentGm(ctx);
  if (!current) throw unauthorized();
  return current;
}

export function currentPlayer(ctx: Ctx) {
  const token = ctx.cookies.get(PLAYER_COOKIE);
  if (!token) return null;
  return (
    ctx.db
      .select()
      .from(player)
      .where(eq(player.tokenHash, hashToken(token)))
      .get() ?? null
  );
}

/** Returns this browser's player, creating one (and its cookie) if needed. */
export function ensurePlayer(ctx: Ctx) {
  const existing = currentPlayer(ctx);
  if (existing) return existing;
  const token = newToken();
  const row = ctx.db
    .insert(player)
    .values({ tokenHash: hashToken(token) })
    .returning()
    .get();
  ctx.setCookies.push(
    serializeCookie(PLAYER_COOKIE, token, {
      maxAge: PLAYER_MAX_AGE,
      secure: ctx.config.secureCookies,
    }),
  );
  logger.info("player created", { requestId: ctx.requestId, playerId: row.id });
  return row;
}

/** The character with this id, if this browser's player owns it. */
export function requireOwnedCharacter(ctx: Ctx, characterId: number) {
  const current = currentPlayer(ctx);
  if (!current) {
    throw new AppError(401, "Enter a join code to play a character.");
  }
  const row = ctx.db
    .select()
    .from(character)
    .where(and(eq(character.id, characterId), eq(character.playerId, current.id)))
    .get();
  if (!row) throw notFound("That character");
  return row;
}

export const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 10;

/** A random join code from an alphabet without look-alike characters. */
export function newJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(JOIN_CODE_LENGTH));
  // 256 is a multiple of the 32-letter alphabet, so this has no bias.
  return Array.from(bytes, (b) => JOIN_ALPHABET[b % JOIN_ALPHABET.length]).join("");
}
