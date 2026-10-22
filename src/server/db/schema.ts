import {
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

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

export const gm = sqliteTable("gm", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

/** A GM's login session. `id` is the SHA-256 of the cookie token. */
export const login = sqliteTable("login", {
  id: text("id").primaryKey(),
  gmId: integer("gm_id")
    .notNull()
    .references(() => gm.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
});

/** A player's browser. Its cookie never expires. */
export const player = sqliteTable("player", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: createdAt(),
});

export const campaign = sqliteTable(
  "campaign",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    gmId: integer("gm_id")
      .notNull()
      .references(() => gm.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: text("start_date").notNull(),
    backgroundImage: text("background_image"),
    currencyLabel: text("currency_label").notNull().default("gp"),
    currencyDecimals: integer("currency_decimals").notNull().default(2),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaign_gm_idx").on(t.gmId)],
);

export const character = sqliteTable(
  "character",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shares: integer("shares").notNull().default(1),
    joinCode: text("join_code").unique(),
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

export const session = sqliteTable(
  "session",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: integer("campaign_id")
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
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    total: integer("total").notNull(),
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
    characterId: integer("character_id").references(() => character.id, {
      onDelete: "set null",
    }),
    characterName: text("character_name").notNull(),
    shares: integer("shares").notNull(),
    gross: integer("gross").notNull(),
    claimed: integer("claimed").notNull(),
    net: integer("net").notNull(),
  },
  (t) => [index("split_share_split_idx").on(t.splitId)],
);

export const loot = sqliteTable(
  "loot",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    quantity: integer("quantity").notNull().default(1),
    value: integer("value"),
    marketPct: integer("market_pct").notNull().default(50),
    status: text("status", { enum: LOOT_STATUSES })
      .notNull()
      .default("active"),
    characterId: integer("character_id").references(() => character.id, {
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
export type Session = typeof session.$inferSelect;
export type Loot = typeof loot.$inferSelect;
export type Split = typeof split.$inferSelect;
export type SplitShare = typeof splitShare.$inferSelect;
