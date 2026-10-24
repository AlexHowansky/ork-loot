import type { LootStatus } from "./status.ts";

/** Shapes returned by the JSON API. Money is in minor units. */

export interface Me {
  gm: { id: string; username: string } | null;
  characters: PlayerCharacter[];
}

export interface PlayerCharacter {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  campaignImage: string | null;
}

export interface CampaignInfo {
  id: string;
  name: string;
  startDate: string;
  backgroundImage: string | null;
  currencyLabel: string;
  currencyDecimals: number;
  /** Where item links will point, e.g. a rules reference site. */
  baseReferenceUrl: string | null;
  /**
   * The petty cash ledger's balance. Changed only through ledger entries,
   * by the GM or by splits.
   */
  pettyCash: number;
  /** What each split tops petty cash up (or pays it down) to. */
  pettyCashHold: number;
  /** Whether a split may leave a character owing, carried as debt. */
  allowDebt: boolean;
}

/** An item found on the campaign's reference site. */
export interface ReferenceMatch {
  name: string;
  url: string;
  level: number | null;
  /** The price as the site writes it, e.g. "4 gp". */
  priceLabel: string | null;
  /** The price in the campaign's minor units, when it converts exactly. */
  value: number | null;
}

export interface CampaignSummary extends CampaignInfo {
  characterCount: number;
  sessionCount: number;
  poolTotal: number;
}

export interface CharacterView {
  id: string;
  name: string;
  shares: number;
  /** Projected share of the pool and petty cash if a split ran now. */
  gross: number;
  /** Market value of items this character has claimed. */
  claimed: number;
  /** Owed from earlier splits; the next split takes it off their payout. */
  debt: number;
  /** Projected payout: gross minus claims and debt. */
  net: number;
  /** GM only: the unused join code, if any. */
  joinCode?: string | null;
  /** GM only: whether a player has taken this character. */
  hasPlayer?: boolean;
}

export interface SessionView {
  id: number;
  date: string;
  title: string | null;
  notes: string | null;
  itemCount: number;
}

export interface LootView {
  id: number;
  sessionId: number;
  name: string;
  description: string | null;
  link: string | null;
  quantity: number;
  value: number | null;
  marketPct: number;
  /**
   * Players see such an item's name but no description, link or value; it
   * counts as zero in every total.
   */
  unidentified: boolean;
  status: LootStatus;
  characterId: string | null;
  splitId: number | null;
  subtotal: number;
}

export interface PoolView {
  /** Available + claimed: what a split would sell. */
  sellable: number;
  party: number;
  claimed: number;
  totalShares: number;
  /**
   * Petty cash a split would pay out above the hold, or, when negative,
   * what it would take from the loot to top petty cash up to the hold.
   */
  pettyCashIn: number;
}

export interface SplitShareView {
  characterId: string | null;
  characterName: string;
  shares: number;
  gross: number;
  claimed: number;
  /** Debt brought into this split and taken off the payout. */
  debtIn: number;
  /** Negative when the character ends the split owing. */
  net: number;
}

export interface SplitView {
  id: number;
  createdAt: number;
  /** The loot sold plus `pettyCash`: what the shares divided. */
  total: number;
  /**
   * Petty cash above the hold paid out with the loot, or, when negative,
   * what was taken from the loot to top petty cash up to the hold.
   */
  pettyCash: number;
  totalShares: number;
  /** What the shares couldn't divide evenly; it becomes the petty cash. */
  leftover: number;
  shares: SplitShareView[];
}

export interface PettyCashEntryView {
  id: number;
  date: string;
  description: string;
  /** Paid in when positive, paid out when negative. */
  amount: number;
  /** Set when a split made this entry; only undoing the split removes it. */
  splitId: number | null;
}

export interface CampaignView {
  campaign: CampaignInfo;
  characters: CharacterView[];
  sessions: SessionView[];
  loot: LootView[];
  pool: PoolView;
  splits: SplitView[];
  /** The petty cash ledger, newest first. */
  pettyCash: PettyCashEntryView[];
}

export interface PlayView extends CampaignView {
  me: { id: string; name: string };
}

export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
}
