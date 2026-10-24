import type { AppState, ChatMessage, PaymentCheckResult } from "./types";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `Request failed (${res.status})`);
  return body as T;
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const api = {
  state: () => fetch("/api/state").then((r) => json<AppState>(r)),
  send: (content: string, speakerId: number | null) => post("/api/messages", { content, speakerId }).then((r) => json<ChatMessage>(r)),
  receipt: (file: File, caption: string, speakerId: number | null) => {
    const fd = new FormData();
    fd.append("image", file);
    fd.append("caption", caption);
    if (speakerId) fd.append("speakerId", String(speakerId));
    return fetch("/api/receipts", { method: "POST", body: fd }).then((r) => json<ChatMessage>(r));
  },
  /** Instant, AI-free cards for the balances / who-owes chips. */
  quick: (kind: "balances" | "debts" | "settle", text: string, speakerId: number | null) =>
    post("/api/quick", { kind, text, speakerId }).then((r) => json<ChatMessage>(r)),
  /** Mark a settlement request as paid outside PayPal. */
  settleTransfer: (id: number, speakerId: number | null) =>
    post(`/api/transfers/${id}/settle`, { speakerId }).then((r) => json<AppState>(r)),
  /** Ask PayPal about one request's invoice right now (instead of waiting for the poll). */
  checkTransfer: (id: number) =>
    post(`/api/transfers/${id}/check`).then((r) => json<{ result: PaymentCheckResult | null; state: AppState }>(r)),
  /** Check every open PayPal request now. */
  checkPayments: () => post("/api/paypal/check").then((r) => json<{ checked: number; state: AppState }>(r)),
  /** New-group survey -> a ready case. Returns the new state plus your member id. */
  createGroup: (body: {
    purpose: string;
    me: string;
    others: string[];
    balances?: { name: string; amount: number }[];
    budgets?: { name: string; amount: number }[];
  }) =>
    post("/api/groups", body).then((r) => json<AppState & { meId: number }>(r)),
  demo: () => post("/api/demo").then((r) => json<AppState>(r)),
  reset: () => post("/api/reset").then((r) => json<AppState>(r)),
  openGroup: (id: number) => post(`/api/groups/${id}/open`).then((r) => json<AppState>(r)),
  fastForward: (days: number) => post("/api/dev/fast-forward", { days }).then((r) => json<AppState>(r)),
  resetClock: () => post("/api/dev/reset-clock").then((r) => json<AppState>(r)),
};
