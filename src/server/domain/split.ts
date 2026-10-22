export interface AllocationInput {
  id: number;
  shares: number;
  claimed: number;
}

export interface Allocation extends AllocationInput {
  gross: number;
  net: number;
}

/**
 * Divides `total` across characters by shares. Gross amounts are whole
 * minor units that always sum exactly to `total`: each character gets the
 * floor of their exact share, and the leftover units go to those with the
 * largest remainders (ties broken by input order). Net is gross minus the
 * value of what they claimed, and may be negative.
 */
export function allocate(total: number, rows: AllocationInput[]): Allocation[] {
  const totalShares = rows.reduce((n, r) => n + r.shares, 0);
  if (totalShares === 0) {
    return rows.map((r) => ({ ...r, gross: 0, net: -r.claimed }));
  }
  const parts = rows.map((r, i) => {
    const exact = total * r.shares;
    return {
      i,
      gross: Math.floor(exact / totalShares),
      rem: exact % totalShares,
    };
  });
  let leftover = total - parts.reduce((n, p) => n + p.gross, 0);
  const order = [...parts].sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const p of order) {
    if (leftover <= 0) break;
    p.gross++;
    leftover--;
  }
  return rows.map((r, i) => {
    const gross = parts[i]!.gross;
    return { ...r, gross, net: gross - r.claimed };
  });
}
