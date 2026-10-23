/**
 * Reference sites whose items the loot form can search, keyed by the host of
 * a campaign's base reference URL. Only these hosts are ever contacted, so a
 * GM can't point the server at an arbitrary address. Add a site here.
 */
export interface ReferenceSite {
  host: string;
  /** The site's Elasticsearch index. */
  index: string;
  /** The currency the site's prices are in. */
  currencyLabel: string;
  /** How many of the site's price units make one of that currency. */
  pricePerUnit: number;
}

export const REFERENCE_SITES: readonly ReferenceSite[] = [
  // Archives of Nethys, Pathfinder 2E. Prices are in copper.
  { host: "2e.aonprd.com", index: "aon", currencyLabel: "gp", pricePerUnit: 100 },
  // Archives of Nethys, Starfinder 2E. Prices are in credits.
  { host: "2e.aonsrd.com", index: "aonsf", currencyLabel: "cr", pricePerUnit: 1 },
];

/** The searchable site a base reference URL points at, if any. */
export function referenceSiteFor(baseUrl: string | null): ReferenceSite | undefined {
  if (!baseUrl) return undefined;
  try {
    const { protocol, host } = new URL(baseUrl);
    if (protocol !== "https:") return undefined;
    return REFERENCE_SITES.find((s) => s.host === host);
  } catch {
    return undefined;
  }
}
