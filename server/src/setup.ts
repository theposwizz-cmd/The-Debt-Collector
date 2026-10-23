/**
 * New-group survey -> a ready case: named after its purpose, members added (you first),
 * and (for trips/events) the balances people already have, recorded as "Opening balance"
 * entries so the ledger, charts and settle-up all start from the right place.
 */
import { now } from "./clock.js";
import * as L from "./ledger.js";
import { formatMoney, toCents } from "./money.js";
import { balancesCard } from "./quickcards.js";
import { settle } from "./settle.js";

export const PURPOSES = {
  trip: "Trip",
  flat: "Shared flat",
  class: "Class",
  event: "Event",
  couple: "Couple",
  team: "Team",
  other: "Group",
} as const;
export type Purpose = keyof typeof PURPOSES;
/** Purposes where "where does everyone stand right now?" makes sense. */
export const BALANCE_PURPOSES: Purpose[] = ["trip", "event"];

export class SetupError extends Error {}

export interface SetupInput {
  purpose: Purpose;
  me: string;
  others: string[];
  /** Signed amounts in the group currency: + is owed money, - owes money. Must cancel out. */
  balances?: { name: string; amount: number }[];
  /** Personal budgets: how much money each person is bringing (trips/events). */
  budgets?: { name: string; amount: number }[];
}

const clean = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export function createGroupFromSetup(input: SetupInput): { groupId: number; meId: number } {
  if (!(input.purpose in PURPOSES)) throw new SetupError("Pick what the group is for.");
  const me = clean(input.me);
  if (!me) throw new SetupError("Tell me your name.");
  const others = (input.others ?? []).map(clean).filter(Boolean);
  if (!others.length) throw new SetupError("Add at least one other person.");
  const all = [me, ...others];
  const seen = new Set<string>();
  for (const n of all) {
    const k = n.toLowerCase();
    if (seen.has(k)) throw new SetupError(`"${n}" is in the list twice. Names need to be different.`);
    seen.add(k);
  }

  // Opening balances (trips/events only), validated before anything is written.
  let opening: { name: string; cents: number }[] = [];
  if (input.balances?.length) {
    if (!BALANCE_PURPOSES.includes(input.purpose)) throw new SetupError("Opening balances only apply to trips and events.");
    opening = input.balances
      .map((b) => ({ name: clean(b.name), cents: toCents(Number(b.amount)) }))
      .filter((b) => b.cents !== 0);
    for (const b of opening) {
      if (!seen.has(b.name.toLowerCase())) throw new SetupError(`"${b.name}" isn't one of the people in this group.`);
    }
    const total = opening.reduce((s, b) => s + b.cents, 0);
    if (total !== 0) throw new SetupError(`The balances need to cancel out. They're off by ${formatMoney(Math.abs(total))}.`);
  }

  let budgets: { name: string; cents: number }[] = [];
  if (input.budgets?.length) {
    if (!BALANCE_PURPOSES.includes(input.purpose)) throw new SetupError("Budgets only apply to trips and events.");
    budgets = input.budgets.map((b) => ({ name: clean(b.name), cents: toCents(Number(b.amount)) })).filter((b) => b.cents !== 0);
    for (const b of budgets) {
      if (!seen.has(b.name.toLowerCase())) throw new SetupError(`"${b.name}" isn't one of the people in this group.`);
      if (b.cents < 0) throw new SetupError(`${b.name}'s budget can't be negative.`);
    }
  }

  const g = L.newGroup();
  L.updateGroup(g.id, { name: PURPOSES[input.purpose] });
  const members = all.map((n) => L.addMember(g.id, n));
  const meId = members[0].id;
  const idOf = (name: string) => members.find((m) => m.name.toLowerCase() === name.toLowerCase())!.id;

  for (const b of budgets) L.updateMember(idOf(b.name), { budgetCents: b.cents });

  if (opening.length) {
    // Each opening debt becomes an "Opening balance" expense paid by the creditor, charged to the debtor.
    const transfers = settle(new Map(opening.map((b) => [idOf(b.name), b.cents])));
    for (const t of transfers) {
      L.addExpense({
        groupId: g.id,
        payerId: t.to,
        description: "Opening balance",
        amountCents: t.amountCents,
        splitType: "opening", // a debt carried in, not spending: doesn't eat into budgets
        shares: new Map([[t.from, t.amountCents]]),
        spentAt: now(),
      });
    }
  }

  const label = PURPOSES[input.purpose];
  L.addMessage({ groupId: g.id, role: "system", kind: "event", content: `Case opened: ${label}.` });
  const cards: unknown[] = [{ type: "members", group: label, members: members.map((m) => ({ name: m.name, email: m.email })) }];
  if (opening.length) cards.push(balancesCard(g.id));
  L.addMessage({
    groupId: g.id,
    role: "agent",
    content:
      `Case opened: ${label.toLowerCase()}, with ${list(all)}. ` +
      (opening.length ? "Opening balances are on file. " : "Clean slate. ") +
      (budgets.length ? `Budgets noted for ${list(budgets.map((b) => b.name))}; I'll tell you what's left. ` : "") +
      "Tell me what gets paid and I'll keep the books. Emails help: PayPal needs them to send requests.",
    data: { cards },
  });

  return { groupId: g.id, meId };
}
