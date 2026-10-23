import { beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb } from "./db.js";
import * as L from "./ledger.js";
import { splitEven } from "./money.js";
import { recordManualPayment, settleUpInChat } from "./settlement.js";

let gid: number;
let ids: Record<string, number>;

beforeEach(() => {
  // These tests exercise the no-PayPal path; make sure no real credentials are used.
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  setDb(openDb(":memory:"));
  gid = L.currentGroup().id;
  ids = {};
  for (const n of ["Filip", "Ana", "Marko"]) ids[n] = L.addMember(gid, n, `${n.toLowerCase()}@example.com`).id;
  L.addExpense({ groupId: gid, payerId: ids.Filip, description: "Villa", amountCents: 30000, splitType: "even",
    shares: splitEven(30000, Object.values(ids)) });
});

describe("settle up in chat", () => {
  it("posts an intro and one request per debtor, even without PayPal keys", async () => {
    const { transfers } = await settleUpInChat(gid);
    expect(transfers.map((t) => [t.from, t.to, t.amountCents])).toEqual([
      ["Ana", "Filip", 10000],
      ["Marko", "Filip", 10000],
    ]);
    expect(transfers.every((t) => t.invoiceUrl === null && /isn't set up/.test(t.error ?? ""))).toBe(true);

    const msgs = L.listMessages(gid);
    expect(msgs[0].content).toMatch(/^Settlement order issued: 2 transfers/);
    const requests = msgs.filter((m) => m.kind === "settle_request");
    expect(requests.map((m) => m.content)).toEqual(["Ana owes Filip €100.", "Marko owes Filip €100."]);
    expect(requests[0].data.transferId).toBe(transfers[0].id);
  });

  it("marking a request settled closes it and zeroes that debtor", async () => {
    const { transfers } = await settleUpInChat(gid);
    const t = transfers[0];
    await recordManualPayment(gid, ids.Ana, ids.Filip, t.amountCents, "Marked as settled in chat");
    expect(L.getTransfer(t.id).status).toBe("paid");
    expect(L.balances(gid).find((b) => b.name === "Ana")?.netCents).toBe(0);
    expect(L.getTransfer(transfers[1].id).status).toBe("open");
  });

  it("says everyone is square when nobody owes", async () => {
    setDb(openDb(":memory:"));
    const g = L.currentGroup().id;
    L.addMember(g, "Solo");
    const { transfers } = await settleUpInChat(g);
    expect(transfers).toEqual([]);
    expect(L.listMessages(g)[0].content).toBe("Everyone is square. Nothing to settle.");
  });
});
