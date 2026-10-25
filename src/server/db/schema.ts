import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { LOOT_STATUSES } from "../../shared/status.ts";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

/** A random primary key, so ids that appear in URLs can't be guessed. */
const uuid = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

export const gm = sqliteTable("gm", {
  id: uuid(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

/** A GM's login session. `id` is the SHA-256 of the cookie token. */
export const login = sqliteTable("login", {
  id: text("id").primaryKey(),
  gmId: text("gm_id")
    .notNull()
    .references(() => gm.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
});

/** A password reset link. `id` is the SHA-256 of the token in the link. */
export const passwordReset = sqliteTable(
  "password_reset",
  {
    id: text("id").primaryKey(),
    gmId: text("gm_id")
      .notNull()
      .references(() => gm.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("password_reset_gm_idx").on(t.gmId)],
);

/** A player's browser. Its cookie never expires. */
export const player = sqliteTable("player", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: createdAt(),
});

export const campaign = sqliteTable(
  "campaign",
  {
    id: uuid(),
    gmId: text("gm_id")
      .notNull()
      .references(() => gm.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: text("start_date").notNull(),
    backgroundImage: text("background_image"),
    currencyLabel: text("currency_label").notNull().default("gp"),
    currencyDecimals: integer("currency_decimals").notNull().default(2),
    /** Where item links will point, e.g. a rules reference site. */
    baseReferenceUrl: text("base_reference_url"),
    /**
     * The balance of the petty cash ledger, in minor units: split leftovers
     * plus whatever the GM paid in or out by hand.
     */
    pettyCash: integer("petty_cash").notNull().default(0),
    /** What each split tops petty cash up (or pays it down) to. */
    pettyCashHold: integer("petty_cash_hold").notNull().default(0),
    /** Whether a split may leave a character owing, carried as debt. */
    allowDebt: integer("allow_debt", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaign_gm_idx").on(t.gmId)],
);

export const character = sqliteTable(
  "character",
  {
    id: uuid(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shares: integer("shares").notNull().default(1),
    /** What this character still owes from earlier splits, in minor units. */
    debt: integer("debt").notNull().default(0),
    playerId: integer("player_id").references(() => player.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("character_campaign_name_idx").on(t.campaignId, t.name),
    index("character_player_idx").on(t.playerId),
  ],
);

/**
 * Someone who follows a campaign without playing in it. Like a character,
 * it is taken by redeeming a join code, but it has no shares and can't
 * claim loot.
 */
export const observer = sqliteTable(
  "observer",
  {
    id: uuid(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    playerId: integer("player_id").references(() => player.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("observer_campaign_name_idx").on(t.campaignId, t.name),
    index("observer_player_idx").on(t.playerId),
  ],
);

/**
 * An unused join code, for exactly one character or observer (a seat).
 * Keeping every code in one table lets its primary key keep codes unique
 * across both. Redeeming a code deletes it; a seat has at most one.
 */
export const joinCode = sqliteTable(
  "join_code",
  {
    code: text("code").primaryKey(),
    characterId: text("character_id")
      .unique()
      .references(() => character.id, { onDelete: "cascade" }),
    observerId: text("observer_id")
      .unique()
      .references(() => observer.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  () => [
    check(
      "join_code_one_seat",
      sql`(character_id IS NULL) <> (observer_id IS NULL)`,
    ),
  ],
);

export const session = sqliteTable(
  "session",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    title: text("title"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("session_campaign_idx").on(t.campaignId)],
);

export const split = sqliteTable(
  "split",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    /** The loot sold plus `pettyCashIn`: what the shares divided. */
    total: integer("total").notNull(),
    /**
     * Petty cash above the hold that this split paid out, or, when
     * negative, what it took from the loot to top petty cash up to the hold.
     */
    pettyCashIn: integer("petty_cash_in").notNull().default(0),
    totalShares: integer("total_shares").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("split_campaign_idx").on(t.campaignId)],
);

export const splitShare = sqliteTable(
  "split_share",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    splitId: integer("split_id")
      .notNull()
      .references(() => split.id, { onDelete: "cascade" }),
    characterId: text("character_id").references(() => character.id, {
      onDelete: "set null",
    }),
    characterName: text("character_name").notNull(),
    shares: integer("shares").notNull(),
    gross: integer("gross").notNull(),
    claimed: integer("claimed").notNull(),
    /** Debt brought into this split, restored if it's undone. */
    debtIn: integer("debt_in").notNull().default(0),
    net: integer("net").notNull(),
  },
  (t) => [index("split_share_split_idx").on(t.splitId)],
);

/**
 * One change to a campaign's petty cash: paid in when positive, paid out
 * when negative. A split's own change carries its `splitId` and goes when
 * the split is undone; the GM writes the rest by hand.
 */
export const pettyCashEntry = sqliteTable(
  "petty_cash_entry",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    description: text("description").notNull(),
    amount: integer("amount").notNull(),
    splitId: integer("split_id").references(() => split.id, {
      onDelete: "cascade",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("petty_cash_entry_campaign_idx").on(t.campaignId)],
);

export const loot = sqliteTable(
  "loot",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Where the item is kept, e.g. "Bag of holding". */
    location: text("location"),
    description: text("description"),
    link: text("link"),
    quantity: integer("quantity").notNull().default(1),
    value: integer("value"),
    marketPct: integer("market_pct").notNull().default(50),
    /** Hidden from players and worth nothing to the pool until identified. */
    unidentified: integer("unidentified", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status", { enum: LOOT_STATUSES })
      .notNull()
      .default("available"),
    characterId: text("character_id").references(() => character.id, {
      onDelete: "set null",
    }),
    splitId: integer("split_id").references(() => split.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("loot_session_idx").on(t.sessionId),
    index("loot_character_idx").on(t.characterId),
  ],
);

export type Campaign = typeof campaign.$inferSelect;
export type Character = typeof character.$inferSelect;
export type Observer = typeof observer.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Loot = typeof loot.$inferSelect;
export type Split = typeof split.$inferSelect;
export type SplitShare = typeof splitShare.$inferSelect;
export type PettyCashEntry = typeof pettyCashEntry.$inferSelect;
