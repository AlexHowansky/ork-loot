export interface AllocationInput {
  id: number;
  shares: number;
  claimed: number;
}

export interface Allocation extends AllocationInput {
  gross: number;
  net: number;
}

export interface AllocationResult {
  /** What one share is worth, in whole minor units. */
  perShare: number;
  /** Units left after paying every share; goes to petty cash. */
  leftover: number;
  rows: Allocation[];
}

/**
 * Divides `total` across characters by shares. Every share is worth the
 * same whole number of minor units, the floor of `total / totalShares`,
 * and whatever that leaves undivided is returned as `leftover`. Net is
 * gross minus the value of what they claimed, and may be negative.
 */
export function allocate(
  total: number,
  rows: AllocationInput[],
): AllocationResult {
  const totalShares = rows.reduce((n, r) => n + r.shares, 0);
  if (totalShares === 0) {
    return {
      perShare: 0,
      leftover: total,
      rows: rows.map((r) => ({ ...r, gross: 0, net: -r.claimed })),
    };
  }
  const perShare = Math.floor(total / totalShares);
  return {
    perShare,
    leftover: total - perShare * totalShares,
    rows: rows.map((r) => {
      const gross = perShare * r.shares;
      return { ...r, gross, net: gross - r.claimed };
    }),
  };
}
