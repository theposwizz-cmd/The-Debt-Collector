/**
 * PayPal REST — SANDBOX ONLY. Invoicing API v2.
 * https://developer.paypal.com/docs/api/invoicing/v2/
 *
 * Sandbox note: invoices are issued by the sandbox business account that owns the
 * REST app, "on behalf of" the creditor (named on the invoice). Per-user invoicing
 * from each person's own PayPal account would need PayPal's partner platform.
 */
import { PAYPAL_API_BASE, paypalCredentials } from "./config.js";

let token: { value: string; expiresAt: number } | null = null;

export class PayPalError extends Error {
  constructor(message: string, readonly status?: number, readonly details?: unknown) {
    super(message);
  }
}

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const { clientId, secret } = paypalCredentials();
  const res = await reach(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new PayPalError(
      `PayPal auth failed (${res.status}): ${body.error_description ?? body.error ?? "unknown error"}. Check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are SANDBOX credentials.`,
      res.status,
    );
  }
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

/** fetch, but a network failure says it was PayPal we couldn't reach. */
async function reach(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const cause = (err as any)?.cause?.code ?? (err as Error).message;
    throw new PayPalError(`Couldn't reach the PayPal sandbox (${new URL(url).host}): ${cause}`);
  }
}

async function pp<T = any>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const res = await reach(`${PAYPAL_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON body (gateway/HTML error page): keep the status and a snippet instead of a parse error.
    if (!res.ok) throw new PayPalError(`PayPal ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`, res.status);
    throw new PayPalError(`PayPal ${method} ${path} returned a non-JSON response.`, res.status);
  }
  if (!res.ok) {
    const detail = Array.isArray(json.details)
      ? json.details.map((d: any) => [d.field, d.issue, d.description].filter(Boolean).join(": ")).join("; ")
      : "";
    throw new PayPalError(`PayPal ${method} ${path} failed (${res.status}): ${json.message ?? json.name ?? text}${detail ? ` — ${detail}` : ""}`, res.status, json);
  }
  return json as T;
}

const money = (cents: number, currency: string) => ({ currency_code: currency, value: (cents / 100).toFixed(2) });

function splitName(full: string) {
  const [given, ...rest] = full.trim().split(/\s+/);
  return rest.length ? { given_name: given, surname: rest.join(" ") } : { given_name: given };
}

export interface InvoiceResult {
  id: string;
  status: string;
  url: string | null; // PayPal's payer link; null if PayPal didn't return one (we never guess it)
  /** Invoice total, what PayPal has recorded as paid, and what's still due (cents; null if absent). */
  amountCents: number | null;
  paidCents: number | null;
  dueCents: number | null;
  warning?: string;
}

const cents = (m: { value?: string } | undefined) => (m?.value != null && m.value !== "" ? Math.round(Number(m.value) * 100) : null);

/** Create a draft invoice (debtor -> creditor), send it, and return the payer link. */
export async function createAndSendInvoice(input: {
  reference: string; // unique per transfer
  groupName: string;
  currency: string;
  amountCents: number;
  debtor: { name: string; email: string };
  creditor: { name: string };
}): Promise<InvoiceResult> {
  let draft: any;
  try {
    draft = await pp(
    "POST",
    "/v2/invoicing/invoices",
    {
      detail: {
        invoice_number: input.reference.slice(0, 127),
        currency_code: input.currency,
        note: `Settle-up for "${input.groupName}". This pays back ${input.creditor.name}.`,
        memo: `The Debt Collector transfer ${input.reference}`,
        payment_term: { term_type: "DUE_ON_RECEIPT" },
      },
      invoicer: { business_name: `${input.creditor.name} via The Debt Collector` },
      primary_recipients: [
        { billing_info: { name: splitName(input.debtor.name), email_address: input.debtor.email } },
      ],
      items: [
        {
          name: `${input.groupName} settle-up`,
          description: `${input.debtor.name} → ${input.creditor.name}`,
          quantity: "1",
          unit_amount: money(input.amountCents, input.currency),
          unit_of_measure: "AMOUNT",
        },
      ],
      configuration: { allow_tip: false, partial_payment: { allow_partial_payment: false } },
    },
    { Prefer: "return=representation" },
  );
  } catch (err) {
    throw new PayPalError(`Creating the PayPal invoice failed: ${(err as Error).message}`);
  }
  const id: string = draft.id ?? String(draft.href ?? "").split("/").pop();
  if (!id) throw new PayPalError("PayPal did not return an invoice id.");

  try {
    await pp("POST", `/v2/invoicing/invoices/${id}/send`, {
      send_to_invoicer: false,
      send_to_recipient: true,
      subject: `${input.creditor.name} — ${input.groupName} settle-up`,
    });
  } catch (err) {
    // Don't leave an orphaned draft behind.
    await pp("DELETE", `/v2/invoicing/invoices/${id}`).catch(() => undefined);
    throw new PayPalError(`Sending PayPal invoice ${id} failed (draft deleted): ${(err as Error).message}`);
  }

  try {
    return await getInvoice(id);
  } catch (err) {
    // It *was* sent, so keep the id; just say we couldn't confirm it.
    return {
      id,
      status: "SENT",
      url: null,
      amountCents: input.amountCents,
      paidCents: null,
      dueCents: null,
      warning: `Invoice ${id} was sent, but reading it back failed: ${(err as Error).message}`,
    };
  }
}

export async function getInvoice(id: string): Promise<InvoiceResult> {
  const inv = await pp("GET", `/v2/invoicing/invoices/${id}`);
  return {
    id,
    status: inv.status,
    url: inv.detail?.metadata?.recipient_view_url ?? null,
    amountCents: cents(inv.amount),
    paidCents: cents(inv.payments?.paid_amount),
    dueCents: cents(inv.due_amount),
  };
}

// Invoice statuses (Invoicing v2), grouped by what they mean for a settle-up request.
/** Fully paid: through PayPal (PAID) or recorded by the invoicer (MARKED_AS_PAID). */
export const PAID_STATUSES = new Set(["PAID", "MARKED_AS_PAID"]);
/** Still waiting on the payer. */
export const AWAITING_STATUSES = new Set(["DRAFT", "SENT", "SCHEDULED", "UNPAID", "PAYMENT_PENDING"]);
/** Some money arrived, not all. Our invoices disallow partial payment, but PayPal can still report it. */
export const PARTIAL_STATUSES = new Set(["PARTIALLY_PAID"]);
/** Money went back to the payer after being paid. */
export const REFUND_STATUSES = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "MARKED_AS_REFUNDED"]);
/** Closed without payment: nothing more will arrive on this invoice. */
export const CANCELLED_STATUSES = new Set(["CANCELLED"]);

/** Cancel a sent invoice (or delete a draft). Used when a settle-up is reissued. */
export async function cancelInvoice(id: string): Promise<void> {
  const { status } = await getInvoice(id);
  if (status === "DRAFT") {
    await pp("DELETE", `/v2/invoicing/invoices/${id}`);
  } else if (!PAID_STATUSES.has(status) && status !== "CANCELLED") {
    await pp("POST", `/v2/invoicing/invoices/${id}/cancel`, {
      subject: "Settle-up reissued",
      note: "The group's ledger changed, so this request was replaced with an updated one.",
      send_to_invoicer: false,
      send_to_recipient: false,
    });
  }
}

/** Record an off-PayPal payment against the invoice (marks it paid on PayPal's side). */
export async function recordInvoicePayment(id: string, amountCents: number, currency: string, note: string): Promise<void> {
  await pp("POST", `/v2/invoicing/invoices/${id}/payments`, {
    method: "OTHER",
    // PayPal rejects future dates; use the real date even when the demo clock is fast-forwarded.
    payment_date: new Date().toISOString().slice(0, 10),
    amount: money(amountCents, currency),
    note: note.slice(0, 2000),
  });
}
