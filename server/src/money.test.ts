import { describe, expect, it } from "vitest";
import { formatMoney, splitCustom, splitEven, splitWeighted, toCents } from "./money.js";

const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("money", () => {
  it("converts to cents without float drift", () => {
    expect(toCents(186.4)).toBe(18640);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it("splits evenly and hands leftover cents to the first participants", () => {
    const s = splitEven(1000, [1, 2, 3]);
    expect([...s.values()]).toEqual([334, 333, 333]);
    expect(sum(s)).toBe(1000);
  });

  it("dedupes participants in an even split", () => {
    expect(splitEven(600, [1, 1, 2]).size).toBe(2);
  });

  it("splits by weights with exact totals", () => {
    const s = splitWeighted(10000, new Map([[1, 2], [2, 1], [3, 1]]));
    expect(s.get(1)).toBe(5000);
    expect(sum(s)).toBe(10000);
    expect(sum(splitWeighted(1001, new Map([[1, 1], [2, 1], [3, 1]])))).toBe(1001);
  });

  it("rejects custom amounts that do not add up", () => {
    expect(() => splitCustom(1000, new Map([[1, 500], [2, 400]]))).toThrow(/add up/);
    expect(sum(splitCustom(1000, new Map([[1, 600], [2, 400]])))).toBe(1000);
  });

  it("formats money", () => {
    expect(formatMoney(4000)).toBe("€40");
    expect(formatMoney(18640)).toBe("€186.40");
    expect(formatMoney(-550, "USD")).toBe("-$5.50");
  });
});
