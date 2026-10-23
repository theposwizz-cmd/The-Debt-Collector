import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "./db.js";
import * as L from "./ledger.js";
import { createGroupFromSetup, SetupError } from "./setup.js";

beforeEach(() => setDb(openDb(":memory:")));

const nets = (gid: number) => Object.fromEntries(L.balances(gid).map((b) => [b.name, b.netCents]));

describe("new group survey", () => {
  it("creates the group with you first and a welcome", () => {
    const { groupId, meId } = createGroupFromSetup({ purpose: "flat", me: " Filip ", others: ["Ana", "Luka"] });
    expect(L.getGroup(groupId).name).toBe("Shared flat");
    expect(L.listMembers(groupId).map((m) => m.name)).toEqual(["Filip", "Ana", "Luka"]);
    expect(L.getMember(meId).name).toBe("Filip");
    const msgs = L.listMessages(groupId);
    expect(msgs.at(-1)?.content).toMatch(/^Case opened: shared flat, with Filip, Ana and Luka\. Clean slate\./);
    expect(Object.values(nets(groupId)).every((v) => v === 0)).toBe(true);
  });

  it("records trip opening balances so the ledger starts from them", () => {
    const { groupId } = createGroupFromSetup({
      purpose: "trip",
      me: "Filip",
      others: ["Ana", "Marko"],
      balances: [
        { name: "Filip", amount: 120 },
        { name: "Ana", amount: -40 },
        { name: "Marko", amount: -80 },
      ],
    });
    expect(nets(groupId)).toEqual({ Filip: 12000, Ana: -4000, Marko: -8000 });
    expect(L.listExpenses(groupId).every((e) => e.description === "Opening balance")).toBe(true);
    expect(L.suggestedTransfers(groupId)).toHaveLength(2);
  });

  it("stores trip budgets and spends them down by each person's share (not by opening debts)", () => {
    const { groupId } = createGroupFromSetup({
      purpose: "trip",
      me: "Filip",
      others: ["Ana"],
      balances: [{ name: "Filip", amount: 30 }, { name: "Ana", amount: -30 }],
      budgets: [{ name: "Filip", amount: 500 }, { name: "Ana", amount: 300 }],
    });
    const ids = Object.fromEntries(L.listMembers(groupId).map((m) => [m.name, m.id]));
    L.addExpense({ groupId, payerId: ids.Filip, description: "Dinner", amountCents: 8000, splitType: "even", shares: new Map([[ids.Filip, 4000], [ids.Ana, 4000]]) });
    const b = Object.fromEntries(L.balances(groupId).map((x) => [x.name, x]));
    expect(b.Filip.budgetCents).toBe(50000);
    expect(b.Ana.spentCents).toBe(4000); // the €30 opening debt isn't spending
    expect(b.Ana.budgetCents! - b.Ana.spentCents).toBe(26000);
    expect(L.listMessages(groupId).at(-1)?.content).toMatch(/Budgets noted for Filip and Ana/);
  });

  it("rejects balances that don't cancel out, writing nothing", () => {
    expect(() =>
      createGroupFromSetup({ purpose: "trip", me: "Filip", others: ["Ana"], balances: [{ name: "Filip", amount: 50 }, { name: "Ana", amount: -40 }] }),
    ).toThrow(/off by €10/);
    expect(L.listMembers(L.currentGroup().id)).toHaveLength(0);
  });

  it("rejects balances for groups that aren't trips or events", () => {
    expect(() =>
      createGroupFromSetup({ purpose: "class", me: "Filip", others: ["Ana"], balances: [{ name: "Filip", amount: 5 }, { name: "Ana", amount: -5 }] }),
    ).toThrow(SetupError);
  });

  it("needs a name, someone else, and unique names", () => {
    expect(() => createGroupFromSetup({ purpose: "trip", me: "", others: ["Ana"] })).toThrow(/your name/);
    expect(() => createGroupFromSetup({ purpose: "trip", me: "Filip", others: [] })).toThrow(/at least one/);
    expect(() => createGroupFromSetup({ purpose: "trip", me: "Filip", others: ["filip"] })).toThrow(/twice/);
  });
});
