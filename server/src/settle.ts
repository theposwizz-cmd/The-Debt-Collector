/**
 * Settle-up: compute the minimum set of transfers that zeroes everyone's balance.
 *
 * `net` maps member -> balance in cents. Positive = is owed money (creditor),
 * negative = owes money (debtor). Balances must sum to zero.
 *
 * Greedy: repeatedly match the biggest creditor with the biggest debtor and
 * transfer min(credit, debt). Each step zeroes at least one person, so there
 * are at most n-1 transfers.
 */
export interface Transfer {
  from: number;
  to: number;
  amountCents: number;
}

export function settle(net: Map<number, number>): Transfer[] {
  const total = [...net.values()].reduce((a, b) => a + b, 0);
  if (total !== 0) throw new Error(`Balances must sum to zero (off by ${total} cents).`);

  const creditors = [...net.entries()].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const debtors = [...net.entries()].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const transfers: Transfer[] = [];

  // Deterministic order: amount desc, then id asc.
  const byBiggest = (a: { id: number; v: number }, b: { id: number; v: number }) => b.v - a.v || a.id - b.id;

  while (creditors.length && debtors.length) {
    creditors.sort(byBiggest);
    debtors.sort(byBiggest);
    const c = creditors[0];
    const d = debtors[0];
    const amount = Math.min(c.v, d.v);
    transfers.push({ from: d.id, to: c.id, amountCents: amount });
    c.v -= amount;
    d.v -= amount;
    if (c.v === 0) creditors.shift();
    if (d.v === 0) debtors.shift();
  }
  return transfers;
}
