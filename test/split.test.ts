import { describe, expect, test } from "bun:test";
import { allocate, pettyCashFlow } from "../src/server/domain/split.ts";
import { formatAmount, parseAmount, parseSignedAmount, subtotal } from "../src/shared/money.ts";

describe("subtotal", () => {
  test("multiplies quantity, value and market percentage", () => {
    expect(subtotal(3, 1000, 50)).toBe(1500);
    expect(subtotal(1, 999, 50)).toBe(500); // 499.5 rounds half up
    expect(subtotal(2, null, 50)).toBe(0);
    expect(subtotal(1, 1234, 100)).toBe(1234);
    expect(subtotal(7, 3, 33)).toBe(7); // 6.93
  });
});

describe("money", () => {
  test("formats at each precision", () => {
    expect(formatAmount(123456, 2)).toBe("1,234.56");
    expect(formatAmount(5, 3)).toBe("0.005");
    expect(formatAmount(42, 0)).toBe("42");
    expect(formatAmount(-250, 2)).toBe("−2.50");
  });

  test("parses user input", () => {
    expect(parseAmount("12.5", 2)).toBe(1250);
    expect(parseAmount("1,000", 0)).toBe(1000);
    expect(parseAmount("", 2)).toBeNull();
    expect(parseAmount("1.234", 2)).toBeUndefined();
    expect(parseAmount("abc", 2)).toBeUndefined();
    expect(parseAmount("-3", 2)).toBeUndefined();
    expect(parseAmount("7.", 1)).toBe(70);
  });
});

describe("allocate", () => {
  const sum = (xs: { gross: number }[]) => xs.reduce((n, x) => n + x.gross, 0);

  test("takes debt off the payout", () => {
    const out = allocate(1000, [
      { id: "1", shares: 1, claimed: 100, debt: 300 },
      { id: "2", shares: 1, claimed: 0 },
    ]);
    expect(out.rows.map((a) => [a.gross, a.debt, a.net])).toEqual([
      [500, 300, 100],
      [500, 0, 500],
    ]);
  });

  test("divides by shares", () => {
    const out = allocate(1000, [
      { id: "1", shares: 1, claimed: 0 },
      { id: "2", shares: 1, claimed: 0 },
      { id: "3", shares: 2, claimed: 0 },
    ]);
    expect(out.perShare).toBe(250);
    expect(out.leftover).toBe(0);
    expect(out.rows.map((a) => a.gross)).toEqual([250, 250, 500]);
  });

  test("every share is equal and the rest is left over", () => {
    const rows = [
      { id: "1", shares: 1, claimed: 0 },
      { id: "2", shares: 2, claimed: 0 },
      { id: "3", shares: 3, claimed: 0 },
      { id: "4", shares: 1, claimed: 0 },
    ];
    for (let total = 0; total < 200; total++) {
      const out = allocate(total, rows);
      out.rows.forEach((a, i) => expect(a.gross).toBe(out.perShare * rows[i]!.shares));
      expect(sum(out.rows) + out.leftover).toBe(total);
      expect(out.leftover).toBeGreaterThanOrEqual(0);
      expect(out.leftover).toBeLessThan(7);
    }
  });

  test("keeps leftover units out of the shares", () => {
    const out = allocate(10, [
      { id: "1", shares: 1, claimed: 0 },
      { id: "2", shares: 1, claimed: 0 },
      { id: "3", shares: 1, claimed: 0 },
    ]);
    expect(out.rows.map((a) => a.gross)).toEqual([3, 3, 3]);
    expect(out.leftover).toBe(1);
  });

  test("subtracts claims, allowing negative nets", () => {
    const out = allocate(1000, [
      { id: "1", shares: 1, claimed: 800 },
      { id: "2", shares: 1, claimed: 0 },
    ]);
    expect(out.rows[0]!.net).toBe(-300);
    expect(out.rows[1]!.net).toBe(500);
  });

  test("handles no shares", () => {
    expect(allocate(100, [])).toEqual({ perShare: 0, leftover: 100, rows: [] });
  });
});

describe("petty cash flow", () => {
  test("with no hold, all petty cash joins the split", () => {
    expect(pettyCashFlow(1000, 3, 0)).toEqual({ pettyCashIn: 3, total: 1003 });
  });

  test("a shortfall below the hold comes out of the loot", () => {
    expect(pettyCashFlow(1000, 20, 50)).toEqual({ pettyCashIn: -30, total: 970 });
  });

  test("anything above the hold is paid out", () => {
    expect(pettyCashFlow(1000, 80, 50)).toEqual({ pettyCashIn: 30, total: 1030 });
  });

  test("the top-up stops when the loot runs out", () => {
    expect(pettyCashFlow(10, 5, 50)).toEqual({ pettyCashIn: -10, total: 0 });
  });
});

describe("signed amounts", () => {
  test("a leading minus makes the amount negative", () => {
    expect(parseSignedAmount("-12.5", 2)).toBe(-1250);
    expect(parseSignedAmount(" − 3", 0)).toBe(-3);
    expect(parseSignedAmount("4", 1)).toBe(40);
    expect(parseSignedAmount("", 2)).toBeNull();
    expect(parseSignedAmount("-", 2)).toBeUndefined();
    expect(parseSignedAmount("--1", 2)).toBeUndefined();
  });
});
