/**
 * Presets for the campaign form. Picking one fills in the currency, decimal
 * places and base reference URL; nothing about the choice itself is stored.
 * Add a system by adding an entry here.
 */
export interface GameSystem {
  id: string;
  name: string;
  currencyLabel: string;
  currencyDecimals: number;
  baseReferenceUrl: string;
}

export const GAME_SYSTEMS: readonly GameSystem[] = [
  {
    id: "pf2e",
    name: "Pathfinder 2E Remaster",
    currencyLabel: "gp",
    currencyDecimals: 2,
    baseReferenceUrl: "https://2e.aonprd.com/",
  },
  {
    id: "sf2e",
    name: "Starfinder 2E",
    currencyLabel: "cr",
    currencyDecimals: 1,
    baseReferenceUrl: "https://2e.aonsrd.com/",
  },
];

/** The preset these field values match exactly, if any. */
export function matchGameSystem(fields: {
  currencyLabel: string;
  currencyDecimals: number;
  baseReferenceUrl: string;
}): GameSystem | undefined {
  return GAME_SYSTEMS.find(
    (g) =>
      g.currencyLabel === fields.currencyLabel.trim() &&
      g.currencyDecimals === fields.currencyDecimals &&
      g.baseReferenceUrl === fields.baseReferenceUrl.trim(),
  );
}
