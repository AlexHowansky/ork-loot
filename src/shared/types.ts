import type { LootStatus } from "./status.ts";

/** Shapes returned by the JSON API. Money is in minor units. */

export interface Me {
  gm: { id: number; username: string } | null;
  characters: PlayerCharacter[];
}

export interface PlayerCharacter {
  id: number;
  name: string;
  campaignId: number;
  campaignName: string;
  campaignImage: string | null;
}

export interface CampaignInfo {
  id: number;
  name: string;
  startDate: string;
  backgroundImage: string | null;
  currencyLabel: string;
  currencyDecimals: number;
  /** Split leftovers that don't divide evenly. Not editable by hand. */
  pettyCash: number;
}

export interface CampaignSummary extends CampaignInfo {
  characterCount: number;
  sessionCount: number;
  poolTotal: number;
}

export interface CharacterView {
  id: number;
  name: string;
  shares: number;
  /** Projected share of the sellable pool if a split ran now. */
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
  characterId: number | null;
  splitId: number | null;
  subtotal: number;
}

export interface PoolView {
  /** Active + claimed: what a split would sell. */
  sellable: number;
  party: number;
  claimed: number;
  totalShares: number;
}

export interface SplitShareView {
  characterId: number | null;
  characterName: string;
  shares: number;
  gross: number;
  claimed: number;
  net: number;
}

export interface SplitView {
  id: number;
  createdAt: number;
  total: number;
  totalShares: number;
  /** What the shares couldn't divide evenly; it goes to petty cash. */
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
  me: { id: number; name: string };
}

export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
}
