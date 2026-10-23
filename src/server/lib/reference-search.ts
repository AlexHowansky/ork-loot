import { z } from "zod";
import type { Campaign } from "../db/schema.ts";
import { AppError } from "./errors.ts";
import { logger } from "./logger.ts";
import { referenceSiteFor, type ReferenceSite } from "../../shared/reference-sites.ts";
import type { ReferenceMatch } from "../../shared/types.ts";

const SEARCH_ORIGIN = "https://elasticsearch.aonprd.com";
const MAX_RESULTS = 10;
const TIMEOUT_MS = 5000;

const hitSchema = z.object({
  _source: z.object({
    name: z.string(),
    url: z.string(),
    level: z.number().nullish(),
    price: z.number().nullish(),
    price_raw: z.string().nullish(),
  }),
});
const responseSchema = z.object({ hits: z.object({ hits: z.array(z.unknown()) }) });

/** Items on the campaign's reference site whose names match `query`. */
export async function searchReference(
  fetcher: typeof fetch,
  c: Campaign,
  query: string,
  requestId: string,
): Promise<ReferenceMatch[]> {
  const site = referenceSiteFor(c.baseReferenceUrl);
  if (!site) return [];
  const body = {
    size: MAX_RESULTS,
    _source: ["name", "url", "level", "price", "price_raw"],
    sort: ["_score", { level: "asc" }],
    query: {
      bool: {
        should: [
          { match_phrase_prefix: { name: { query, boost: 3 } } },
          { match: { name: { query, operator: "and", fuzziness: "AUTO" } } },
        ],
        minimum_should_match: 1,
        filter: [{ term: { type: "Item" } }],
        // Legacy items that have a remastered version are left out.
        must_not: [
          { exists: { field: "remaster_id" } },
          { term: { exclude_from_search: true } },
        ],
      },
    },
  };
  let data: unknown;
  try {
    const res = await fetcher(`${SEARCH_ORIGIN}/${site.index}/_search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    data = await res.json();
  } catch (err) {
    logger.warn("reference search failed", { requestId, host: site.host, err });
    throw new AppError(502, "The reference site couldn't be searched just now.");
  }
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn("reference search gave an unexpected reply", { requestId, host: site.host });
    throw new AppError(502, "The reference site couldn't be searched just now.");
  }
  const matches: ReferenceMatch[] = [];
  for (const raw of parsed.data.hits.hits) {
    const hit = hitSchema.safeParse(raw);
    if (!hit.success) continue;
    const s = hit.data._source;
    const url = siteUrl(site, s.url);
    if (!url) continue;
    matches.push({
      name: s.name,
      url,
      level: s.level ?? null,
      priceLabel: s.price_raw ?? null,
      value: s.price == null ? null : toMinor(site, c, s.price),
    });
  }
  return matches;
}

/** An absolute link on the site itself; anything pointing elsewhere is dropped. */
function siteUrl(site: ReferenceSite, path: string): string | null {
  try {
    const url = new URL(path, `https://${site.host}/`);
    return url.host === site.host && url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The site's price in the campaign's minor units, or null when the campaign
 * uses another currency or can't hold the amount exactly.
 */
function toMinor(site: ReferenceSite, c: Campaign, price: number): number | null {
  if (c.currencyLabel.trim().toLowerCase() !== site.currencyLabel) return null;
  const minor = (price * 10 ** c.currencyDecimals) / site.pricePerUnit;
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}
