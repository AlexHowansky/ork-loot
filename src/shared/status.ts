export const LOOT_STATUSES = [
  "available",
  "party",
  "claimed",
  "bought",
  "sold",
  "abandoned",
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
  party: "Party",
  claimed: "Claimed",
  bought: "Bought",
  sold: "Sold",
  abandoned: "Abandoned",
};

/** What each status means, as described in SPEC.md. */
export const STATUS_DESCRIPTION: Record<LootStatus, string> = {
  available:
    "In the current loot pool, free to be claimed, and will be sold during the next split.",
  party:
    "Set aside into a party fund. Can't be claimed and won't be sold during the next split.",
  claimed:
    "In the current loot pool and claimed by a character. Its market value comes out of their next split.",
  bought:
    "Was claimed and had its value accounted for during a prior split. Kept for history only.",
  sold: "Went unclaimed and was sold during a prior split. Kept for history only.",
  abandoned: "Discarded or never picked up. Kept for information only.",
};
