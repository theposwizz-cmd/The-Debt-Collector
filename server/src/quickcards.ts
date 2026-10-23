/**
 * Cards computed straight from the ledger. Shared by the agent's show_* tools and the
 * instant chip endpoint, so both render exactly the same thing. No AI involved.
 */
import * as L from "./ledger.js";
import { formatMoney } from "./money.js";

export interface BalancesCardData {
  type: "balances";
  currency: string;
  balances: { member: string; netCents: number; net: string }[];
  history?: L.BalanceHistory;
}

export interface DebtsCardData {
  type: "debts";
  currency: string;
  debtors: { member: string; owesCents: number; owes: string; to: { member: string; amountCents: number; amount: string }[] }[];
  creditors: { member: string; owedCents: number; owed: string }[];
}

export function balancesCard(groupId: number): BalancesCardData {
  const g = L.getGroup(groupId);
  return {
    type: "balances",
    currency: g.currency,
    balances: L.balances(groupId).map((b) => ({ member: b.name, netCents: b.netCents, net: formatMoney(b.netCents, g.currency) })),
    history: L.balanceHistory(groupId),
  };
}

export function debtsCard(groupId: number): DebtsCardData {
  const g = L.getGroup(groupId);
  const fmt = (c: number) => formatMoney(c, g.currency);
  const d = L.debtSummary(groupId);
  return {
    type: "debts",
    currency: g.currency,
    debtors: d.debtors.map((x) => ({ ...x, owes: fmt(x.owesCents), to: x.to.map((t) => ({ ...t, amount: fmt(t.amountCents) })) })),
    creditors: d.creditors.map((c) => ({ ...c, owed: fmt(c.owedCents) })),
  };
}

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export type QuickKind = "balances" | "debts";

/** A factual one-line summary plus the card. Written from the numbers, not by a model. */
export function quickReply(kind: QuickKind, groupId: number): { content: string; card: BalancesCardData | DebtsCardData } {
  if (kind === "balances") {
    const card = balancesCard(groupId);
    const sorted = [...card.balances].sort((a, b) => b.netCents - a.netCents);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    let content: string;
    if (!top || (top.netCents === 0 && bottom.netCents === 0)) content = "Balances: everyone is even. Nothing on the books to chase.";
    else content = `Balances as of today. ${top.member} is owed the most (${top.net}). ${bottom.member} owes the most (${bottom.net.replace(/^-/, "")}).`;
    return { content, card };
  }
  const card = debtsCard(groupId);
  const top = card.debtors[0];
  const content = top
    ? `${top.member} owes the most: ${top.owes}, to ${list(top.to.map((t) => t.member))}.`
    : "Nobody owes anything. Everyone is square.";
  return { content, card };
}
