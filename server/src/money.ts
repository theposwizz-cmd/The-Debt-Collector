/** Pure money helpers. All amounts are integer cents. */

export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error(`Not a valid amount: ${amount}`);
  return Math.round(amount * 100);
}

export function formatMoney(cents: number, currency = "EUR"): string {
  const symbol: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
  const abs = Math.abs(cents);
  const body = (abs / 100).toFixed(2).replace(/\.00$/, "");
  const sign = cents < 0 ? "-" : "";
  return symbol[currency] ? `${sign}${symbol[currency]}${body}` : `${sign}${body} ${currency}`;
}

/** Split an amount as evenly as possible; leftover cents go to the first participants. */
export function splitEven(totalCents: number, memberIds: number[]): Map<number, number> {
  if (memberIds.length === 0) throw new Error("A split needs at least one participant.");
  const unique = [...new Set(memberIds)];
  const base = Math.floor(totalCents / unique.length);
  let remainder = totalCents - base * unique.length;
  const shares = new Map<number, number>();
  for (const id of unique) {
    shares.set(id, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
  return shares;
}

/** Split proportionally to weights (e.g. "Luka had 2 portions"). Largest-remainder rounding. */
export function splitWeighted(totalCents: number, weights: Map<number, number>): Map<number, number> {
  const entries = [...weights.entries()].filter(([, w]) => w > 0);
  if (entries.length === 0) throw new Error("Weighted split needs at least one positive weight.");
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  const raw = entries.map(([id, w]) => ({ id, exact: (totalCents * w) / sum }));
  const shares = new Map(raw.map((r) => [r.id, Math.floor(r.exact)]));
  let leftover = totalCents - [...shares.values()].reduce((a, b) => a + b, 0);
  const byFraction = [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1));
  for (let i = 0; leftover > 0; i = (i + 1) % byFraction.length, leftover--) {
    const id = byFraction[i].id;
    shares.set(id, shares.get(id)! + 1);
  }
  return shares;
}

/** Custom amounts must add up to the total exactly (to the cent). */
export function splitCustom(totalCents: number, amounts: Map<number, number>): Map<number, number> {
  const sum = [...amounts.values()].reduce((a, b) => a + b, 0);
  if (sum !== totalCents) {
    throw new Error(
      `Custom amounts add up to ${(sum / 100).toFixed(2)} but the expense total is ${(totalCents / 100).toFixed(2)}.`,
    );
  }
  if ([...amounts.values()].some((v) => v < 0)) throw new Error("Custom amounts cannot be negative.");
  return new Map([...amounts.entries()].filter(([, v]) => v > 0));
}
