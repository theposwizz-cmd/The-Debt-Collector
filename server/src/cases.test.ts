import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "./db.js";
import { loadDemo } from "./demo.js";
import * as L from "./ledger.js";
import { createGroupFromSetup } from "./setup.js";

beforeEach(() => setDb(openDb(":memory:")));

describe("saved cases", () => {
  it("keeps every case on file and remembers which one is open", () => {
    const a = createGroupFromSetup({ purpose: "trip", me: "Filip", others: ["Ana"] });
    const b = createGroupFromSetup({ purpose: "flat", me: "Filip", others: ["Luka"] });
    expect(L.currentGroup().id).toBe(b.groupId);
    expect(L.listGroups().map((c) => c.id).sort()).toEqual([a.groupId, b.groupId].sort());

    L.openGroup(a.groupId);
    expect(L.currentGroup().id).toBe(a.groupId); // not just "the newest"
    expect(L.listGroups().find((c) => c.id === a.groupId)?.members).toEqual(["Filip", "Ana"]);
  });

  it("leaves empty groups out of the list", () => {
    L.newGroup();
    expect(L.listGroups()).toHaveLength(0);
  });

  it("reloading the demo replaces the old demo but never the user's cases", () => {
    const mine = createGroupFromSetup({ purpose: "trip", me: "Filip", others: ["Ana"] });
    const first = loadDemo();
    const second = loadDemo();
    const ids = L.listGroups().map((c) => c.id);
    expect(ids).toContain(mine.groupId);
    expect(ids).toContain(second.id);
    expect(ids).not.toContain(first.id);
    expect(L.currentGroup().id).toBe(second.id);
  });

  it("seeds the demo with budgets", () => {
    const g = loadDemo();
    const b = Object.fromEntries(L.balances(g.id).map((x) => [x.name, x.budgetCents! - x.spentCents]));
    expect(b.Luka).toBe(1188);
    expect(b.Marko).toBe(-1812);
  });
});
