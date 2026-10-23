import { describe, expect, it } from "vitest";
import { settle, type Transfer } from "./settle.js";

/** Apply transfers to balances; every balance must end at zero. */
function applyTransfers(net: Map<number, number>, transfers: Transfer[]): Map<number, number> {
  const out = new Map(net);
  for (const t of transfers) {
    out.set(t.from, out.get(t.from)! + t.amountCents);
    out.set(t.to, out.get(t.to)! - t.amountCents);
  }
  return out;
}

describe("settle", () => {
  it("returns nothing when everyone is even", () => {
    expect(settle(new Map([[1, 0], [2, 0]]))).toEqual([]);
  });

  it("handles a single debt", () => {
    expect(settle(new Map([[1, 4000], [2, -4000]]))).toEqual([{ from: 2, to: 1, amountCents: 4000 }]);
  });

  it("matches the biggest creditor with the biggest debtor first", () => {
    const net = new Map([
      [1, 9000],
      [2, 1000],
      [3, -6000],
      [4, -4000],
    ]);
    const t = settle(net);
    expect(t[0]).toEqual({ from: 3, to: 1, amountCents: 6000 });
    expect(t).toHaveLength(3);
    expect([...applyTransfers(net, t).values()].every((v) => v === 0)).toBe(true);
  });

  it("uses at most n-1 transfers", () => {
    const net = new Map([
      [1, 12345],
      [2, -2345],
      [3, -5000],
      [4, 3000],
      [5, -8000],
      [6, 0],
    ]);
    const t = settle(net);
    expect(t.length).toBeLessThanOrEqual(net.size - 1);
    expect([...applyTransfers(net, t).values()].every((v) => v === 0)).toBe(true);
  });

  it("collapses a chain A->B->C into a single transfer", () => {
    // A owes B 10, B owes C 10 => net: A -10, B 0, C +10
    const t = settle(new Map([[1, -1000], [2, 0], [3, 1000]]));
    expect(t).toEqual([{ from: 1, to: 3, amountCents: 1000 }]);
  });

  it("never transfers zero or negative amounts", () => {
    const net = new Map([
      [1, 1],
      [2, 1],
      [3, -2],
    ]);
    for (const tr of settle(net)) expect(tr.amountCents).toBeGreaterThan(0);
  });

  it("is deterministic for ties", () => {
    const net = new Map([
      [3, 500],
      [1, 500],
      [2, -1000],
    ]);
    expect(settle(net)).toEqual([
      { from: 2, to: 1, amountCents: 500 },
      { from: 2, to: 3, amountCents: 500 },
    ]);
  });

  it("rejects balances that do not sum to zero", () => {
    expect(() => settle(new Map([[1, 100], [2, -99]]))).toThrow(/sum to zero/);
  });

  it("settles randomized groups exactly", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(rand() * 8);
      const net = new Map<number, number>();
      let sum = 0;
      for (let i = 1; i < n; i++) {
        const v = Math.floor(rand() * 20000) - 10000;
        net.set(i, v);
        sum += v;
      }
      net.set(n, -sum);
      const t = settle(net);
      expect(t.length).toBeLessThanOrEqual(n - 1);
      expect([...applyTransfers(net, t).values()].every((v) => v === 0)).toBe(true);
    }
  });
});
