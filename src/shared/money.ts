/**
 * Money is stored as an integer count of the campaign's minor unit, where
 * the minor unit is 10^-decimals of the currency (decimals 0–3).
 */

export const MAX_DECIMALS = 3;

/** Market-adjusted subtotal of a loot row, in minor units. */
export function subtotal(
  quantity: number,
  value: number | null,
  marketPct: number,
): number {
  if (value === null) return 0;
  return Math.round((quantity * value * marketPct) / 100);
}

/** Formats minor units for display, e.g. 1250 with 2 decimals → "12.50". */
export function formatAmount(minor: number, decimals: number): string {
  const scale = 10 ** decimals;
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / scale).toLocaleString("en-US");
  const frac = decimals > 0
    ? "." + String(abs % scale).padStart(decimals, "0")
    : "";
  return (negative ? "−" : "") + whole + frac;
}

export function formatMoney(
  minor: number,
  decimals: number,
  label: string,
): string {
  const amount = formatAmount(minor, decimals);
  return label ? `${amount} ${label}` : amount;
}

/** Converts minor units into an editable string, e.g. 1250 → "12.50". */
export function toInput(minor: number | null, decimals: number): string {
  if (minor === null) return "";
  return formatAmount(minor, decimals).replace(/,/g, "").replace("−", "-");
}

/**
 * Parses a user-entered amount into minor units. Returns null for a blank
 * string and undefined when the text is not a valid amount at this
 * precision.
 */
export function parseAmount(
  text: string,
  decimals: number,
): number | null | undefined {
  const trimmed = text.trim().replace(/,/g, "");
  if (trimmed === "") return null;
  const match = /^(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return undefined;
  const [, whole = "0", frac = ""] = match;
  if (frac.length > decimals) return undefined;
  const minor =
    Number(whole) * 10 ** decimals + Number(frac.padEnd(decimals, "0") || 0);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

/** Like `parseAmount`, but a leading minus sign makes it negative. */
export function parseSignedAmount(
  text: string,
  decimals: number,
): number | null | undefined {
  const match = /^\s*([−-])?(.*)$/s.exec(text)!;
  const minor = parseAmount(match[2] ?? "", decimals);
  if (!match[1]) return minor;
  return minor === null || minor === undefined ? undefined : -minor;
}
