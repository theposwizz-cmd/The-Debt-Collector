/** Settle-up orchestration: ledger -> minimal transfers -> PayPal sandbox invoices. */
import { now } from "./clock.js";
import { configStatus, paypalCredentials } from "./config.js";
import * as L from "./ledger.js";
import { formatMoney } from "./money.js";
import { PAID_STATUSES, cancelInvoice, createAndSendInvoice, getInvoice, recordInvoicePayment } from "./paypal.js";

export interface TransferView {
  id: number;
  from: string;
  to: string;
  amountCents: number;
  amount: string;
  status: L.TransferRow["status"];
  paypalStatus: string | null;
  invoiceUrl: string | null;
  invoiceId: string | null;
  error: string | null;
}

export function viewTransfer(t: L.TransferRow): TransferView {
  const g = L.getGroup(t.group_id);
  return {
    id: t.id,
    from: L.getMember(t.from_id).name,
    to: L.getMember(t.to_id).name,
    amountCents: t.amount_cents,
    amount: formatMoney(t.amount_cents, g.currency),
    status: t.status,
    paypalStatus: t.paypal_status,
    invoiceUrl: t.paypal_invoice_url,
    invoiceId: t.paypal_invoice_id,
    error: t.paypal_error,
  };
}

export async function settleUp(groupId: number): Promise<{ transfers: TransferView[]; cancelled: number; problems: string[] }> {
  // Without PayPal keys the ledger still settles; each request just says no invoice was sent.
  const paypalOn = configStatus().paypal;
  const group = L.getGroup(groupId);

  // Any still-open requests are superseded: the ledger may have changed since.
  let cancelled = 0;
  const problems: string[] = [];
  for (const t of L.listTransfers(groupId, "open")) {
    if (t.paypal_invoice_id && paypalOn) {
      try {
        const inv = await getInvoice(t.paypal_invoice_id);
        if (PAID_STATUSES.has(inv.status)) {
          L.updateTransfer(t.id, { paypal_status: inv.status });
          L.markTransferPaid(t.id, "paypal", "Paid via PayPal invoice");
          continue;
        }
        await cancelInvoice(t.paypal_invoice_id);
      } catch (err) {
        // The old invoice may still be payable on PayPal: say so, don't just log it.
        problems.push(
          `Couldn't cancel the earlier PayPal invoice ${t.paypal_invoice_id} (${L.getMember(t.from_id).name} → ${L.getMember(t.to_id).name}); it may still be payable. ${(err as Error).message}`,
        );
      }
    }
    L.updateTransfer(t.id, { status: "cancelled", paypal_status: t.paypal_invoice_id ? "CANCELLED" : t.paypal_status, closed_at: now() });
    cancelled++;
  }

  const plan = L.suggestedTransfers(groupId);
  const results: TransferView[] = [];
  for (const p of plan) {
    const row = L.createTransfer(groupId, p);
    const debtor = L.getMember(p.from);
    const creditor = L.getMember(p.to);
    if (!paypalOn) {
      L.updateTransfer(row.id, { paypal_error: "PayPal isn't set up yet, so no PayPal request was sent. Mark it settled once paid." });
    } else if (!debtor.email) {
      L.updateTransfer(row.id, { paypal_error: `No email on file for ${debtor.name}, so no PayPal invoice was sent.` });
    } else {
      try {
        const inv = await createAndSendInvoice({
          reference: `TDC-${groupId}-${row.id}-${Date.now().toString(36).toUpperCase()}`,
          groupName: group.name ?? "Group",
          currency: group.currency,
          amountCents: p.amountCents,
          debtor: { name: debtor.name, email: debtor.email },
          creditor: { name: creditor.name },
        });
        L.updateTransfer(row.id, {
          paypal_invoice_id: inv.id,
          paypal_invoice_url: inv.url,
          paypal_status: inv.status,
          paypal_error: inv.warning ?? (inv.url ? null : `PayPal didn't return a payer link for invoice ${inv.id} (status ${inv.status}).`),
        });
      } catch (err) {
        L.updateTransfer(row.id, { paypal_error: (err as Error).message });
      }
    }
    results.push(viewTransfer(L.getTransfer(row.id)));
  }
  return { transfers: results, cancelled, problems };
}

/**
 * Post one chat message per transfer, addressed to the person who owes. The UI shows
 * UNSETTLED next to their name until the transfer is paid, then SETTLED.
 */
export function postSettlementRequests(groupId: number, transfers: TransferView[]): void {
  for (const t of transfers) {
    L.addMessage({
      groupId,
      role: "agent",
      kind: "settle_request",
      content: `${t.from} owes ${t.to} ${t.amount}.${t.invoiceUrl ? ` ${t.from}'s PayPal request is ready below.` : ""}`,
      data: { transferId: t.id, debtor: t.from, creditor: t.to, amount: t.amount, invoiceUrl: t.invoiceUrl, error: t.error },
    });
  }
}

/** Settle-up for the chip / agent: compute + invoice, then an intro line and one request per debtor. */
export async function settleUpInChat(groupId: number): Promise<{ transfers: TransferView[]; cancelled: number; problems: string[] }> {
  const res = await settleUp(groupId);
  reportSettleProblems(groupId, res);
  const n = res.transfers.length;
  const replaced = res.cancelled ? ` ${res.cancelled} earlier request${res.cancelled > 1 ? "s" : ""} replaced.` : "";
  L.addMessage({
    groupId,
    role: "agent",
    content: n
      ? `Settlement order issued: ${n} transfer${n > 1 ? "s" : ""} clear${n > 1 ? "" : "s"} every debt.${replaced} Requests below.`
      : `Everyone is square. Nothing to settle.${replaced}`,
  });
  postSettlementRequests(groupId, res.transfers);
  return res;
}

/** Post settle-up failures into the chat: invoices that failed, and old invoices that couldn't be cancelled. */
export function reportSettleProblems(groupId: number, res: { transfers: TransferView[]; problems: string[] }): void {
  const failed = configStatus().paypal ? res.transfers.filter((t) => t.error) : [];
  const lines = [...res.problems, ...failed.map((t) => `${t.from} → ${t.to} ${t.amount}: ${t.error}`)];
  if (lines.length) {
    const list = lines.map((l) => `- ${l}`).join("\n");
    L.addMessage({ groupId, role: "system", kind: "error", content: `PayPal problems during settle-up:\n${list}` });
  }
}

/**
 * Pull invoice statuses from PayPal; book payments for anything paid. One bad invoice doesn't
 * stop the others; every failure is returned with which invoice it was.
 */
export async function refreshInvoices(groupId?: number): Promise<{ paid: TransferView[]; errors: { groupId: number; message: string }[] }> {
  paypalCredentials();
  const open = groupId ? L.listTransfers(groupId, "open") : L.openTransfersAll();
  const paid: TransferView[] = [];
  const errors: { groupId: number; message: string }[] = [];
  for (const t of open) {
    if (!t.paypal_invoice_id) continue;
    try {
      const inv = await getInvoice(t.paypal_invoice_id);
      const url = inv.url ?? t.paypal_invoice_url;
      if (inv.status !== t.paypal_status || url !== t.paypal_invoice_url) {
        L.updateTransfer(t.id, { paypal_status: inv.status, paypal_invoice_url: url });
      }
      if (PAID_STATUSES.has(inv.status)) {
        paid.push(viewTransfer(L.markTransferPaid(t.id, "paypal", "Paid via PayPal invoice")));
      }
    } catch (err) {
      errors.push({ groupId: t.group_id, message: `Checking invoice ${t.paypal_invoice_id} failed: ${(err as Error).message}` });
    }
  }
  return { paid, errors };
}

/**
 * Someone paid outside PayPal. Book it; if it exactly matches an open settle-up
 * request, close that request and mark the PayPal invoice paid too.
 */
export async function recordManualPayment(
  groupId: number,
  fromId: number,
  toId: number,
  amountCents: number,
  note?: string,
): Promise<{ payment: L.Payment | null; closedTransfer: TransferView | null; paypalNote?: string }> {
  const match = L.listTransfers(groupId, "open").find(
    (t) => t.from_id === fromId && t.to_id === toId && t.amount_cents === amountCents,
  );
  if (!match) {
    return { payment: L.recordPayment({ groupId, fromId, toId, amountCents, note }), closedTransfer: null };
  }
  let paypalNote: string | undefined;
  if (match.paypal_invoice_id) {
    try {
      await recordInvoicePayment(match.paypal_invoice_id, amountCents, L.getGroup(groupId).currency, note ?? "Paid outside PayPal");
      const inv = await getInvoice(match.paypal_invoice_id);
      L.updateTransfer(match.id, { paypal_status: inv.status });
      paypalNote = `PayPal invoice marked as paid (${inv.status}).`;
    } catch (err) {
      paypalNote = `Booked in the ledger, but PayPal could not mark the invoice paid: ${(err as Error).message}`;
    }
  }
  const closed = L.markTransferPaid(match.id, "manual", note ?? "Paid outside PayPal");
  return { payment: null, closedTransfer: viewTransfer(closed), paypalNote };
}
