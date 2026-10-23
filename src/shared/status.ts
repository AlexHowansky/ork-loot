export const LOOT_STATUSES = [
  "available",
  "party",
  "claimed",
  "bought",
  "sold",
  "left",
] as const;

export type LootStatus = (typeof LOOT_STATUSES)[number];

/** Statuses for items still sitting in the loot pool. */
export const POOL_STATUSES: readonly LootStatus[] = [
  "available",
  "party",
  "claimed",
];

/** Statuses that tie an item to a character. */
export const CHARACTER_STATUSES: readonly LootStatus[] = ["claimed", "bought"];

export const STATUS_LABEL: Record<LootStatus, string> = {
  available: "Available",
  party: "Party fund",
  claimed: "Claimed",
  bought: "Bought",
  sold: "Sold",
  left: "Left behind",
};
