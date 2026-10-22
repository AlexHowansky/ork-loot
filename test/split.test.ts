import { describe, expect, test } from "bun:test";
import { allocate } from "../src/server/domain/split.ts";
import { formatAmount, parseAmount, subtotal } from "../src/shared/money.ts";

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

  test("divides by shares", () => {
    const out = allocate(1000, [
      { id: 1, shares: 1, claimed: 0 },
      { id: 2, shares: 1, claimed: 0 },
      { id: 3, shares: 2, claimed: 0 },
    ]);
    expect(out.map((a) => a.gross)).toEqual([250, 250, 500]);
  });

  test("always sums exactly to the total", () => {
    for (let total = 0; total < 200; total++) {
      const out = allocate(total, [
        { id: 1, shares: 1, claimed: 0 },
        { id: 2, shares: 2, claimed: 0 },
        { id: 3, shares: 3, claimed: 0 },
        { id: 4, shares: 1, claimed: 0 },
      ]);
      expect(sum(out)).toBe(total);
    }
  });

  test("gives leftover units to the largest remainders", () => {
    const out = allocate(10, [
      { id: 1, shares: 1, claimed: 0 },
      { id: 2, shares: 1, claimed: 0 },
      { id: 3, shares: 1, claimed: 0 },
    ]);
    expect(out.map((a) => a.gross)).toEqual([4, 3, 3]);
  });

  test("subtracts claims, allowing negative nets", () => {
    const out = allocate(1000, [
      { id: 1, shares: 1, claimed: 800 },
      { id: 2, shares: 1, claimed: 0 },
    ]);
    expect(out[0]!.net).toBe(-300);
    expect(out[1]!.net).toBe(500);
  });

  test("handles no shares", () => {
    expect(allocate(100, [])).toEqual([]);
  });
});
