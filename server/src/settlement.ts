/** Settle-up orchestration: ledger -> minimal transfers -> PayPal sandbox invoices. */
import { DAY_MS, now } from "./clock.js";
import { configStatus, paypalCredentials } from "./config.js";
import * as L from "./ledger.js";
import { formatMoney } from "./money.js";
import {
  AWAITING_STATUSES,
  CANCELLED_STATUSES,
  PAID_STATUSES,
  PARTIAL_STATUSES,
  REFUND_STATUSES,
  PayPalError,
  cancelInvoice,
  createAndSendInvoice,
  getInvoice,
  recordInvoicePayment,
  type InvoiceResult,
} from "./paypal.js";

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
  /** Real time of the last successful PayPal status check (null = never checked). */
  checkedAt: number | null;
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
    checkedAt: t.paypal_checked_at,
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
          // Paid while we were about to replace it: book and announce it like the poller would.
          applyInvoiceStatus(t, inv);
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

export type CheckKind = "paid" | "partial" | "awaiting" | "cancelled" | "refunded" | "unknown" | "error";
export interface CheckOutcome {
  kind: CheckKind;
  transfer: TransferView;
  /** PayPal's invoice status (null when the check itself failed before reading it). */
  status: string | null;
  /** One line, as logged: what was seen and what the app did about it. */
  message: string;
  /** True when this check changed something (status moved, payment booked or reversed). */
  changed: boolean;
}

/** Paid requests stay watched this long after closing, so a refund reopens the debt. */
const REFUND_WATCH_MS = 7 * DAY_MS;

function describeCheckError(invoiceId: string, err: unknown): string {
  const msg = (err as Error).message;
  if (err instanceof PayPalError && err.status === 404) {
    return `PayPal has no invoice ${invoiceId} on this account (were the sandbox keys changed?). Settle up again to reissue it. ${msg}`;
  }
  if (err instanceof PayPalError && (err.status === 401 || err.status === 403)) {
    return `PayPal refused the status check (${err.status}), so this payment can't be detected. ${msg}`;
  }
  return `Checking invoice ${invoiceId} failed, so its payment status is unknown: ${msg}`;
}

/**
 * Act on one invoice's PayPal status and post the matching chat event. Everything from here to the
 * ledger write is synchronous, so two checks racing on one invoice can't book a payment twice.
 */
function applyInvoiceStatus(t: L.TransferRow, inv: InvoiceResult): CheckOutcome {
  const currency = L.getGroup(t.group_id).currency;
  const from = L.getMember(t.from_id).name;
  const to = L.getMember(t.to_id).name;
  const amount = formatMoney(t.amount_cents, currency);
  const label = `${from} → ${to} ${amount}`;
  const changed = inv.status !== t.paypal_status;
  L.updateTransfer(t.id, {
    paypal_status: inv.status,
    paypal_invoice_url: inv.url ?? t.paypal_invoice_url,
    paypal_error: null,
    paypal_checked_at: Date.now(),
    paypal_paid_cents: inv.paidCents,
  });
  const view = () => viewTransfer(L.getTransfer(t.id));
  const event = (content: string, data?: unknown) => L.addMessage({ groupId: t.group_id, role: "system", kind: "event", content, data });
  const out = (kind: CheckKind, message: string, didChange = changed): CheckOutcome => ({
    kind,
    transfer: view(),
    status: inv.status,
    message: `${label}: ${message}`,
    changed: didChange,
  });

  if (PAID_STATUSES.has(inv.status)) {
    if (L.getTransfer(t.id).status !== "open") return out("paid", `${inv.status}, already settled`, false);
    const viaPaypal = inv.status === "PAID";
    L.markTransferPaid(t.id, "paypal", viaPaypal ? "Paid via PayPal invoice" : "Marked as paid on PayPal");
    event(`${from} paid ${to} ${amount} ${viaPaypal ? "via PayPal" : "(marked as paid on PayPal)"}. Recorded.`, {
      cards: [{ type: "payment", from, to, amount, method: "paypal" }],
    });
    return out("paid", `${inv.status}. Settled, payment booked, chasing stopped.`, true);
  }

  if (REFUND_STATUSES.has(inv.status)) {
    if (inv.status === "PARTIALLY_REFUNDED") {
      if (changed) event(`PayPal shows part of ${from}'s ${amount} payment to ${to} was refunded. The ledger still counts it as paid; sort out the difference in chat.`);
      return out("refunded", "PARTIALLY_REFUNDED, left as paid");
    }
    if (L.getTransfer(t.id).status === "paid") {
      L.reopenTransfer(t.id);
      event(`PayPal shows ${from}'s ${amount} payment to ${to} was refunded. That debt is open again.`);
      return out("refunded", `${inv.status}. Payment removed, request reopened.`, true);
    }
    return out("refunded", inv.status);
  }

  if (PARTIAL_STATUSES.has(inv.status)) {
    // Not booked: the request stays open for the full amount until PayPal says PAID.
    const paid = inv.paidCents != null ? formatMoney(inv.paidCents, currency) : "part";
    const moved = changed || inv.paidCents !== t.paypal_paid_cents;
    if (moved) event(`${from} has paid ${paid} of ${amount} to ${to} on PayPal. The request stays open until it's paid in full.`);
    return out("partial", `PARTIALLY_PAID (${paid} paid), still open`, moved);
  }

  if (CANCELLED_STATUSES.has(inv.status)) {
    // Cancelled on PayPal's side while still owed here: say so loudly, never treat it as paid.
    const msg = `PayPal invoice ${inv.id} (${label}) was cancelled on PayPal, so it can't be paid any more. The debt is still open: settle up again to reissue it.`;
    if (changed && L.getTransfer(t.id).status === "open") L.addMessage({ groupId: t.group_id, role: "system", kind: "error", content: msg });
    L.updateTransfer(t.id, { paypal_error: msg });
    return out("cancelled", "CANCELLED on PayPal, debt still open");
  }

  if (AWAITING_STATUSES.has(inv.status)) return out("awaiting", `${inv.status}, not paid yet`);
  return out("unknown", `unrecognised PayPal status ${inv.status}, treated as unpaid`);
}

/**
 * Pull invoice statuses from PayPal and act on them. Checks open requests plus requests paid through
 * PayPal in the last week (to catch refunds). One bad invoice doesn't stop the others; every failure
 * is logged, stored on the request (shown on its card), and returned. Never assumes paid or unpaid.
 */
export async function checkInvoices(opts: { groupId?: number; transferId?: number } = {}): Promise<CheckOutcome[]> {
  paypalCredentials();
  let rows: L.TransferRow[];
  if (opts.transferId) {
    rows = [L.getTransfer(opts.transferId)];
  } else {
    const open = opts.groupId ? L.listTransfers(opts.groupId, "open") : L.openTransfersAll();
    const watched = L.recentlyPaidPaypalTransfers(now() - REFUND_WATCH_MS).filter((t) => !opts.groupId || t.group_id === opts.groupId);
    // An invoice cancelled on PayPal can't change again; stop polling it (a manual check still can).
    rows = [...open, ...watched].filter((t) => !(t.paypal_status && CANCELLED_STATUSES.has(t.paypal_status)));
  }

  const outcomes: CheckOutcome[] = [];
  for (const t of rows) {
    if (!t.paypal_invoice_id) continue;
    try {
      const inv = await getInvoice(t.paypal_invoice_id);
      const o = applyInvoiceStatus(L.getTransfer(t.id), inv);
      outcomes.push(o);
      // Settled requests are only watched for refunds: log them when something changes.
      if (t.status === "open" || o.changed) console.log(`[paypal] #${t.id} ${t.paypal_invoice_id} ${o.message}${o.changed ? "  <- changed" : ""}`);
    } catch (err) {
      const message = describeCheckError(t.paypal_invoice_id, err);
      const transfer = viewTransfer(L.updateTransfer(t.id, { paypal_error: message }));
      console.error(`[paypal] #${t.id} ${t.paypal_invoice_id} CHECK FAILED: ${message}`);
      outcomes.push({ kind: "error", transfer, status: t.paypal_status, message, changed: false });
    }
  }
  if (rows.length) {
    const summary = outcomes.reduce<Record<string, number>>((acc, o) => ((acc[o.kind] = (acc[o.kind] ?? 0) + 1), acc), {});
    console.log(`[paypal] poll checked ${rows.length} invoice(s): ${Object.entries(summary).map(([k, n]) => `${n} ${k}`).join(", ")}`);
  }
  return outcomes;
}

/** Summary for the agent tool: newly paid requests, and failures (with their group). */
export async function refreshInvoices(groupId?: number): Promise<{ paid: TransferView[]; errors: { groupId: number; message: string }[] }> {
  const outcomes = await checkInvoices({ groupId });
  return {
    paid: outcomes.filter((o) => o.kind === "paid" && o.changed).map((o) => o.transfer),
    errors: outcomes.filter((o) => o.kind === "error").map((o) => ({ groupId: L.getTransfer(o.transfer.id).group_id, message: o.message })),
  };
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
