/**
 * One-click demo seed: a realistic trip with a few expenses, one receipt and a
 * short chat history. This is seed DATA only — every live action after loading
 * (new messages, receipts, settle-up, nudges) makes real Claude / PayPal calls.
 */
import fs from "node:fs";
import path from "node:path";
import { DAY_MS, now, resetClock } from "./clock.js";
import { ROOT_DIR, UPLOAD_DIR } from "./config.js";
import { getDb } from "./db.js";
import * as L from "./ledger.js";
import { splitEven } from "./money.js";
import { balancesCard as balancesCardFor } from "./quickcards.js";

const PEOPLE = [
  { name: "Filip", email: "filip.collector@example.com" },
  { name: "Ana", email: "ana.collector@example.com" },
  { name: "Luka", email: "luka.collector@example.com" },
  { name: "Marko", email: "marko.collector@example.com" },
  { name: "Iva", email: "iva.collector@example.com" },
];

// What each person brought for the trip. By the end Luka is nearly out and Marko is over.
const BUDGETS: Record<string, number> = { Filip: 40000, Ana: 30000, Luka: 25000, Marko: 22000, Iva: 35000 };
const DEMO_KEY = "demo_group_id";

const RECEIPT = {
  is_receipt: true,
  merchant: "Konoba Mate",
  total: 186.4,
  currency: "EUR",
  date: "2026-10-15",
  items: [
    { name: "Brancin na žaru", quantity: 2, price: 48.0 },
    { name: "Crni rižot", quantity: 2, price: 33.0 },
    { name: "Janjetina ispod peke", quantity: 1, price: 38.0 },
    { name: "Blitva", quantity: 2, price: 12.0 },
    { name: "Kućno vino 1L", quantity: 2, price: 36.0 },
    { name: "Mineralna voda", quantity: 3, price: 11.4 },
    { name: "Rožata", quantity: 2, price: 8.0 },
  ],
  notes: null,
};

export function loadDemo(): L.Group {
  resetClock();
  // Reloading the demo replaces the previous copy; the user's own cases are never touched.
  const db = getDb();
  const prev = db.prepare("SELECT value FROM app_state WHERE key = ?").get(DEMO_KEY) as { value: string } | undefined;
  if (prev && db.prepare("SELECT 1 FROM groups WHERE id = ?").get(Number(prev.value))) L.deleteGroup(Number(prev.value));
  const g = L.newGroup();
  db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(DEMO_KEY, String(g.id));
  const gid = g.id;
  L.updateGroup(gid, { name: "Hvar Trip", currency: "EUR" });
  const m: Record<string, L.Member> = {};
  for (const p of PEOPLE) m[p.name] = L.addMember(gid, p.name, p.email);
  const all = Object.values(m).map((x) => x.id);

  const t = now();
  let clock = t - 3 * DAY_MS;
  const at = (hours: number) => (clock += hours * 60 * 60 * 1000);

  const say = (who: string, content: string, data?: unknown) =>
    L.addMessage({ groupId: gid, role: "user", authorId: m[who].id, content, data, createdAt: at(0.05) });
  const reply = (content: string, cards: unknown[]) =>
    L.addMessage({ groupId: gid, role: "agent", content, data: { cards }, createdAt: at(0.01) });
  const expenseCard = (label: string, e: L.Expense, receipt?: unknown) => ({
    type: "expense",
    label,
    expense: {
      id: e.id,
      description: e.description,
      amount: `€${(e.amount_cents / 100).toFixed(2).replace(/\.00$/, "")}`,
      paidBy: L.getMember(e.payer_id).name,
      split: e.split_type,
      shares: e.shares.map((s) => ({ member: L.getMember(s.member_id).name, share: `€${(s.share_cents / 100).toFixed(2).replace(/\.00$/, "")}` })),
      source: e.source,
      ...(receipt ? { receipt } : {}),
    },
  });

  L.addMessage({ groupId: gid, role: "system", kind: "event", content: "Demo group loaded: Hvar Trip.", createdAt: clock });

  // 1. Setup
  say("Filip", "New group, Hvar Trip. Me, Ana, Luka, Marko and Iva. Euros. Emails are our first names dot collector at example.com.");
  reply("Hvar Trip, in euros. Five members, five emails on file. I'll be keeping the books.", [
    { type: "members", group: "Hvar Trip", members: PEOPLE },
  ]);
  say("Filip", "Budgets: I brought 400, Ana 300, Luka 250, Marko 220, Iva 350.");
  for (const [name, cents] of Object.entries(BUDGETS)) L.updateMember(m[name].id, { budgetCents: cents });
  reply("Budgets on file: Filip €400, Ana €300, Luka €250, Marko €220, Iva €350. I'll say when someone's running dry.", []);

  // 2. Villa
  at(1);
  say("Filip", "I paid 600 for the villa, split evenly");
  const villa = L.addExpense({
    groupId: gid, payerId: m.Filip.id, description: "Villa", amountCents: 60000, splitType: "even",
    shares: splitEven(60000, all), spentAt: clock,
  });
  reply("Villa, €600, paid by Filip. €120 each. Noted.", [expenseCard("Expense added", villa)]);

  // 3. Boat trip, subset
  at(20);
  say("Ana", "The boat trip was 280, only between Luka, Marko, Filip and me. I paid.");
  const boat = L.addExpense({
    groupId: gid, payerId: m.Ana.id, description: "Boat trip", amountCents: 28000, splitType: "even",
    shares: splitEven(28000, [m.Ana.id, m.Luka.id, m.Marko.id, m.Filip.id]), spentAt: clock,
  });
  reply("Boat trip, €280, paid by Ana. €70 each for Ana, Luka, Marko and Filip. Iva stayed on land and is €70 better off for it.", [
    expenseCard("Expense added", boat),
  ]);

  // 4. Receipt
  at(10);
  const file = `demo-konoba-${gid}.jpg`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.copyFileSync(path.join(ROOT_DIR, "samples", "receipt-konoba-mate.jpg"), path.join(UPLOAD_DIR, file));
  const receiptId = L.addReceipt(gid, file, RECEIPT);
  say("Luka", "Dinner last night, I got it. Everyone.", {
    image: `/uploads/${file}`,
    receipt: { id: receiptId, extracted: RECEIPT },
  });
  const dinner = L.addExpense({
    groupId: gid, payerId: m.Luka.id, description: "Dinner at Konoba Mate", amountCents: 18640, splitType: "even",
    shares: splitEven(18640, all), source: "receipt", receiptId, spentAt: clock,
  });
  reply("Konoba Mate, €186.40, 15 October. Seven dishes, two litres of house wine. Split five ways: €37.28 each.", [
    expenseCard("Expense added", dinner, { merchant: "Konoba Mate", imageUrl: `/uploads/${file}` }),
  ]);

  // 5. Groceries
  at(14);
  say("Iva", "groceries 54.20, everyone");
  const groceries = L.addExpense({
    groupId: gid, payerId: m.Iva.id, description: "Groceries", amountCents: 5420, splitType: "even",
    shares: splitEven(5420, all), spentAt: clock,
  });
  reply("Groceries, €54.20, paid by Iva. €10.84 each.", [expenseCard("Expense added", groceries)]);

  // 6. A repayment outside PayPal
  at(3);
  say("Iva", "Also I sent Filip 50 by bank transfer this morning");
  L.recordPayment({ groupId: gid, fromId: m.Iva.id, toId: m.Filip.id, amountCents: 5000, note: "Bank transfer" });
  reply("Recorded: Iva paid Filip €50 by bank transfer. Filip, you're welcome.", [
    { type: "payment", from: "Iva", to: "Filip", amount: "€50", method: "manual", note: "Bank transfer" },
  ]);

  // 7. A budget question
  at(2);
  say("Marko", "How much of my budget is left?");
  reply("Marko's share so far is €238.12: €18.12 over Marko's €220 budget. Luka has €11.88 left. Everyone else is comfortable.", [
    balancesCardFor(gid),
  ]);

  return L.getGroup(gid);
}
