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
   * What the last split couldn't divide evenly; the next split pays it out.
   * Not editable by hand.
   */
  pettyCash: number;
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
}

export interface SplitShareView {
  characterId: string | null;
  characterName: string;
  shares: number;
  gross: number;
  claimed: number;
  net: number;
}

export interface SplitView {
  id: number;
  createdAt: number;
  /** The loot sold plus the petty cash paid out with it. */
  total: number;
  /** Preview only: the petty cash included in `total`. */
  pettyCash?: number;
  totalShares: number;
  /** What the shares couldn't divide evenly; it becomes the petty cash. */
  leftover: number;
  shares: SplitShareView[];
}

export interface CampaignView {
  campaign: CampaignInfo;
  characters: CharacterView[];
  sessions: SessionView[];
  loot: LootView[];
  pool: PoolView;
  splits: SplitView[];
}

export interface PlayView extends CampaignView {
  me: { id: string; name: string };
}

export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
}
