import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceResult } from "./paypal.js";

// PayPal is faked here: each test says what status the sandbox reports for the invoice.
const reported = new Map<string, InvoiceResult | Error>();
vi.mock("./paypal.js", async (orig) => {
  const real = await orig<typeof import("./paypal.js")>();
  return {
    ...real,
    getInvoice: vi.fn(async (id: string) => {
      const r = reported.get(id);
      if (!r) throw new real.PayPalError(`PayPal GET /v2/invoicing/invoices/${id} failed (404): RESOURCE_NOT_FOUND`, 404);
      if (r instanceof Error) throw r;
      return r;
    }),
  };
});

const { openDb, setDb } = await import("./db.js");
const L = await import("./ledger.js");
const { splitEven } = await import("./money.js");
const { checkInvoices } = await import("./settlement.js");
const { PayPalError } = await import("./paypal.js");

let gid: number;
let ids: Record<string, number>;
let transferId: number;
const INV = "INV2-TEST-0001";

const invoice = (status: string, paidCents: number | null = null): InvoiceResult => ({
  id: INV,
  status,
  url: "https://www.sandbox.paypal.com/invoice/p/#TEST0001",
  amountCents: 10000,
  paidCents,
  dueCents: null,
});
const net = (name: string) => L.balances(gid).find((b) => b.name === name)!.netCents;
const lastMessage = () => L.listMessages(gid).at(-1)!;

beforeEach(() => {
  process.env.PAYPAL_CLIENT_ID = "test-id";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  reported.clear();
  setDb(openDb(":memory:"));
  gid = L.currentGroup().id;
  ids = {};
  for (const n of ["Filip", "Marko"]) ids[n] = L.addMember(gid, n).id;
  L.addExpense({ groupId: gid, payerId: ids.Filip, description: "Boat", amountCents: 20000, splitType: "even", shares: splitEven(20000, Object.values(ids)) });
  transferId = L.createTransfer(gid, { from: ids.Marko, to: ids.Filip, amountCents: 10000 }).id;
  L.updateTransfer(transferId, { paypal_invoice_id: INV, paypal_status: "SENT", paypal_invoice_url: "https://www.sandbox.paypal.com/invoice/p/#TEST0001" });
});

describe("PayPal payment detection", () => {
  it("leaves a SENT invoice open and records when it was checked", async () => {
    reported.set(INV, invoice("SENT"));
    const [o] = await checkInvoices();
    expect(o.kind).toBe("awaiting");
    expect(L.getTransfer(transferId).status).toBe("open");
    expect(L.getTransfer(transferId).paypal_checked_at).toBeTypeOf("number");
    expect(net("Marko")).toBe(-10000);
  });

  it("on PAID: books the payment, settles the request, posts the confirmation, once", async () => {
    reported.set(INV, invoice("PAID", 10000));
    const [o] = await checkInvoices();
    expect(o).toMatchObject({ kind: "paid", changed: true });
    expect(L.getTransfer(transferId).status).toBe("paid");
    expect(net("Marko")).toBe(0);
    expect(lastMessage().content).toBe("Marko paid Filip €100 via PayPal. Recorded.");

    // A second poll (or a racing manual check) must not book it again.
    const before = L.listMessages(gid).length;
    await checkInvoices({ transferId });
    expect(net("Marko")).toBe(0);
    expect(L.listMessages(gid).length).toBe(before);
  });

  it("treats MARKED_AS_PAID as paid", async () => {
    reported.set(INV, invoice("MARKED_AS_PAID", 10000));
    await checkInvoices();
    expect(L.getTransfer(transferId).status).toBe("paid");
    expect(lastMessage().content).toMatch(/marked as paid on PayPal/);
  });

  it("PARTIALLY_PAID keeps the request open and says how much arrived", async () => {
    reported.set(INV, invoice("PARTIALLY_PAID", 4000));
    const [o] = await checkInvoices();
    expect(o.kind).toBe("partial");
    expect(L.getTransfer(transferId).status).toBe("open");
    expect(net("Marko")).toBe(-10000);
    expect(lastMessage().content).toBe("Marko has paid €40 of €100 to Filip on PayPal. The request stays open until it's paid in full.");
  });

  it("CANCELLED on PayPal: debt stays open, loud error, never paid", async () => {
    reported.set(INV, invoice("CANCELLED"));
    const [o] = await checkInvoices();
    expect(o.kind).toBe("cancelled");
    expect(L.getTransfer(transferId).status).toBe("open");
    expect(L.getTransfer(transferId).paypal_error).toMatch(/cancelled on PayPal/);
    expect(lastMessage().kind).toBe("error");
    // Cancelled is final: the poller stops asking, but a manual check still can.
    expect(await checkInvoices()).toHaveLength(0);
    expect(await checkInvoices({ transferId })).toHaveLength(1);
  });

  it("REFUNDED after payment reopens the debt", async () => {
    reported.set(INV, invoice("PAID", 10000));
    await checkInvoices();
    reported.set(INV, invoice("REFUNDED", 0));
    const [o] = await checkInvoices();
    expect(o).toMatchObject({ kind: "refunded", changed: true });
    expect(L.getTransfer(transferId).status).toBe("open");
    expect(net("Marko")).toBe(-10000);
    expect(lastMessage().content).toMatch(/was refunded\. That debt is open again\./);
  });

  it("a failed check is loud and changes nothing", async () => {
    reported.set(INV, new PayPalError("PayPal auth failed (401): invalid_client", 401));
    const [o] = await checkInvoices();
    expect(o.kind).toBe("error");
    expect(o.message).toMatch(/refused the status check \(401\)/);
    expect(L.getTransfer(transferId).status).toBe("open");
    expect(L.getTransfer(transferId).paypal_status).toBe("SENT");
    expect(L.getTransfer(transferId).paypal_error).toMatch(/401/);
  });

  it("an unknown invoice id says so", async () => {
    const [o] = await checkInvoices();
    expect(o.kind).toBe("error");
    expect(o.message).toMatch(/has no invoice INV2-TEST-0001 on this account/);
  });
});
