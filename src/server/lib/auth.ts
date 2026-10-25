import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { character, gm, login, passwordReset, player } from "../db/schema.ts";
import { AppError, notFound, unauthorized } from "./errors.ts";
import { serializeCookie, type Ctx } from "./http.ts";
import { logger } from "./logger.ts";

export const GM_COOKIE = "pl_gm";
export const PLAYER_COOKIE = "pl_player";

const DAY = 24 * 60 * 60 * 1000;
const LOGIN_TTL = 30 * DAY;
const RESET_TTL = 60 * 60 * 1000;
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
 * Checks an email address and password. Unknown addresses still pay for a
 * hash verification so response timing doesn't reveal which ones exist.
 */
export async function verifyCredentials(
  db: Db,
  email: string,
  password: string,
) {
  const row = db.select().from(gm).where(eq(gm.email, email)).get();
  if (!row) {
    dummyHash ??= hashPassword("not-a-real-password");
    await Bun.password.verify(password, await dummyHash);
    return null;
  }
  return (await Bun.password.verify(password, row.passwordHash)) ? row : null;
}

/**
 * Creates a password reset link for a GM, replacing any earlier one, and
 * returns the token to put in it.
 */
export function startPasswordReset(db: Db, gmId: string): string {
  const token = newToken();
  db.transaction((tx) => {
    tx.delete(passwordReset).where(eq(passwordReset.gmId, gmId)).run();
    tx.insert(passwordReset)
      .values({
        id: hashToken(token),
        gmId,
        expiresAt: new Date(Date.now() + RESET_TTL),
      })
      .run();
  });
  return token;
}

/**
 * Sets a new password using a reset token. The token is used up, and the
 * GM is signed out everywhere. Returns the GM's id, or null if the token is
 * unknown, used or expired.
 */
export function finishPasswordReset(
  db: Db,
  token: string,
  passwordHash: string,
): string | null {
  return db.transaction((tx) => {
    const reset = tx
      .delete(passwordReset)
      .where(eq(passwordReset.id, hashToken(token)))
      .returning()
      .get();
    if (!reset || reset.expiresAt.getTime() < Date.now()) return null;
    tx.update(gm).set({ passwordHash }).where(eq(gm.id, reset.gmId)).run();
    tx.delete(login).where(eq(login.gmId, reset.gmId)).run();
    tx.delete(passwordReset).where(eq(passwordReset.gmId, reset.gmId)).run();
    return reset.gmId;
  });
}

export function startLogin(ctx: Ctx, gmId: string) {
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
  return { id: row.gm.id, email: row.gm.email };
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
export function requireOwnedCharacter(ctx: Ctx, characterId: string) {
  const current = currentPlayer(ctx);
  if (!current) {
    throw new AppError(401, "Enter a join code to play a character.");
  }
  const row = ctx.db
    .select()
    .from(character)
    .where(eq(character.id, characterId))
    .get();
  if (!row) throw notFound("That character");
  // Most likely the GM gave it a new join code, which signs its player out.
  if (row.playerId !== current.id) {
    throw new AppError(
      403,
      "This browser isn't playing that character. If your GM gave it a new " +
        "join code, ask them for it.",
    );
  }
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
