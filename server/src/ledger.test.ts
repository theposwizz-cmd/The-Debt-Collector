import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "./db.js";
import * as L from "./ledger.js";
import { splitEven } from "./money.js";
import { quickReply } from "./quickcards.js";

let gid: number;
let ids: Record<string, number>;

beforeEach(() => {
  setDb(openDb(":memory:"));
  gid = L.currentGroup().id;
  ids = {};
  for (const n of ["Filip", "Ana", "Luka", "Marko"]) ids[n] = L.addMember(gid, n, `${n.toLowerCase()}@example.com`).id;
});

const net = () => Object.fromEntries(L.balances(gid).map((b) => [b.name, b.netCents]));

describe("ledger", () => {
  it("computes balances from expenses", () => {
    L.addExpense({ groupId: gid, payerId: ids.Filip, description: "Villa", amountCents: 60000, splitType: "even",
      shares: splitEven(60000, Object.values(ids)) });
    expect(net()).toEqual({ Filip: 45000, Ana: -15000, Luka: -15000, Marko: -15000 });
  });

  it("repayments move balances toward zero", () => {
    L.addExpense({ groupId: gid, payerId: ids.Filip, description: "Taxi", amountCents: 8000, splitType: "even",
      shares: splitEven(8000, [ids.Filip, ids.Marko]) });
    L.recordPayment({ groupId: gid, fromId: ids.Marko, toId: ids.Filip, amountCents: 4000 });
    expect(net().Marko).toBe(0);
    expect(net().Filip).toBe(0);
  });

  it("voided expenses drop out of balances", () => {
    const e = L.addExpense({ groupId: gid, payerId: ids.Ana, description: "Boat", amountCents: 1000, splitType: "even",
      shares: splitEven(1000, [ids.Ana, ids.Luka]) });
    L.voidExpense(e.id, "duplicate");
    expect(Object.values(net()).every((v) => v === 0)).toBe(true);
  });

  it("settling a transfer zeroes the debtor", () => {
    L.addExpense({ groupId: gid, payerId: ids.Filip, description: "Villa", amountCents: 60000, splitType: "even",
      shares: splitEven(60000, Object.values(ids)) });
    for (const t of L.suggestedTransfers(gid)) {
      const row = L.createTransfer(gid, t);
      L.markTransferPaid(row.id, "paypal");
    }
    expect(Object.values(net()).every((v) => v === 0)).toBe(true);
    expect(L.listTransfers(gid, "paid")).toHaveLength(3);
  });

  it("builds a balance history that ends at the current balances", () => {
    L.addExpense({ groupId: gid, payerId: ids.Filip, description: "Villa", amountCents: 60000, splitType: "even",
      shares: splitEven(60000, Object.values(ids)), spentAt: 1000 });
    L.addExpense({ groupId: gid, payerId: ids.Ana, description: "Boat", amountCents: 2000, splitType: "even",
      shares: splitEven(2000, [ids.Ana, ids.Marko]), spentAt: 2000 });
    L.recordPayment({ groupId: gid, fromId: ids.Marko, toId: ids.Filip, amountCents: 5000 });
    const h = L.balanceHistory(gid);
    expect(h.members).toEqual(["Filip", "Ana", "Luka", "Marko"]);
    expect(h.points.map((p) => p.label)).toEqual(["Start", "Villa", "Boat", "Marko paid Filip"]);
    expect(h.points[0].values).toEqual([0, 0, 0, 0]);
    expect(h.points[1].values).toEqual([45000, -15000, -15000, -15000]);
    const last = h.points[h.points.length - 1].values;
    expect(last).toEqual(L.balances(gid).map((b) => b.netCents));
    for (const p of h.points) expect(p.values.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("ranks debtors and says who they owe", () => {
    L.addExpense({ groupId: gid, payerId: ids.Filip, description: "Villa", amountCents: 60000, splitType: "even",
      shares: splitEven(60000, Object.values(ids)) });
    L.addExpense({ groupId: gid, payerId: ids.Ana, description: "Boat", amountCents: 4000, splitType: "even",
      shares: splitEven(4000, [ids.Ana, ids.Marko]) });
    L.recordPayment({ groupId: gid, fromId: ids.Luka, toId: ids.Filip, amountCents: 5000 });
    // Filip +400 · Ana −130 · Luka −100 · Marko −170
    const d = L.debtSummary(gid);
    expect(d.debtors.map((x) => [x.member, x.owesCents])).toEqual([["Marko", 17000], ["Ana", 13000], ["Luka", 10000]]);
    expect(d.debtors[0].to).toEqual([{ member: "Filip", amountCents: 17000 }]);
    expect(d.creditors).toEqual([{ member: "Filip", owedCents: 40000 }]);
  });

  it("builds instant quick replies from the ledger", () => {
    expect(quickReply("debts", gid).content).toBe("Nobody owes anything. Everyone is square.");
    L.addExpense({ groupId: gid, payerId: ids.Filip, description: "Villa", amountCents: 60000, splitType: "even",
      shares: splitEven(60000, Object.values(ids)) });
    L.addExpense({ groupId: gid, payerId: ids.Ana, description: "Boat", amountCents: 4000, splitType: "even",
      shares: splitEven(4000, [ids.Ana, ids.Marko]) });
    const debts = quickReply("debts", gid);
    expect(debts.content).toBe("Marko owes the most: €170, to Filip.");
    expect(debts.card.type).toBe("debts");
    const bal = quickReply("balances", gid);
    expect(bal.content).toBe("Balances as of today. Filip is owed the most (€450). Marko owes the most (€170).");
    expect(bal.card.type === "balances" && bal.card.history?.points.length).toBe(3);
  });

  it("finds members by first name, case-insensitively", () => {
    L.addMember(gid, "Iva Horvat");
    expect(L.findMember(gid, "marko")?.id).toBe(ids.Marko);
    expect(L.findMember(gid, "iva")?.name).toBe("Iva Horvat");
    expect(L.findMember(gid, "nobody")).toBeUndefined();
  });
});
