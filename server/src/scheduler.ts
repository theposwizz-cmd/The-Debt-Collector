/**
 * Autonomous chasing. Every few seconds: refresh PayPal status for open
 * settle-up requests, book payments, and post the next escalation nudge for
 * anything still unpaid — all against the simulated clock.
 */
import { DAY_MS, now } from "./clock.js";
import { configStatus } from "./config.js";
import * as L from "./ledger.js";
import { formatMoney } from "./money.js";
import { refreshInvoices } from "./settlement.js";
import { describeAiError } from "./ai/client.js";
import { levelFor, nudgeDue, writeNudge } from "./ai/nudge.js";

const TICK_MS = 4000;
const PAYPAL_REFRESH_MS = 15000;

let current: Promise<void> | null = null;
let lastPaypalRefresh = 0;
let warnedNoKey = false;
const lastErrorPosted = new Map<string, number>();

/** Background failures go to the chat, throttled per group + kind so a stuck call doesn't flood it. */
function postErrorOnce(groupId: number, kind: "paypal" | "nudge", text: string) {
  const key = `${groupId}:${kind}`;
  const last = lastErrorPosted.get(key) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  lastErrorPosted.set(key, Date.now());
  L.addMessage({ groupId, role: "system", kind: "error", content: text });
}

function groupsWithOpenInvoices(): number[] {
  return [...new Set(L.openTransfersAll().filter((t) => t.paypal_invoice_id).map((t) => t.group_id))];
}

/** Run one pass. If a pass is already running, wait for it and then run a fresh one. */
export async function tick(opts: { forcePaypal?: boolean } = {}): Promise<void> {
  while (current) await current;
  current = runPass(opts).finally(() => {
    current = null;
  });
  return current;
}

async function runPass(opts: { forcePaypal?: boolean }): Promise<void> {
  // 1. PayPal: did anyone pay?
  if (configStatus().paypal && (opts.forcePaypal || Date.now() - lastPaypalRefresh > PAYPAL_REFRESH_MS)) {
    lastPaypalRefresh = Date.now();
    try {
      const { paid, errors } = await refreshInvoices();
      for (const e of errors) postErrorOnce(e.groupId, "paypal", `PayPal payment check failed, so payments won't be detected: ${e.message}`);
      for (const t of paid) {
        L.addMessage({
          groupId: L.getTransfer(t.id).group_id,
          role: "system",
          kind: "event",
          content: `${t.from} paid ${t.to} ${t.amount} via PayPal. Recorded.`,
          data: { cards: [{ type: "payment", from: t.from, to: t.to, amount: t.amount, method: "paypal" }] },
        });
      }
    } catch (err) {
      // e.g. auth failure: payment detection is down for every group that's waiting on PayPal.
      for (const gid of groupsWithOpenInvoices()) {
        postErrorOnce(gid, "paypal", `PayPal payment check failed, so payments won't be detected: ${(err as Error).message}`);
      }
    }
  }

  // 2. Nudges for whatever is still open. They're written by Claude, so without a key there's
  // nothing to send; the UI banner already says the key is missing, so don't spam the chat.
  if (!configStatus().anthropic) {
    if (!warnedNoKey) console.warn("[scheduler] ANTHROPIC_API_KEY missing: payment reminders are paused.");
    warnedNoKey = true;
    return;
  }
  const t0 = now();
  for (const t of L.openTransfersAll()) {
    const ageDays = (t0 - t.created_at) / DAY_MS;
    const sinceLast = t.last_nudge_at ? (t0 - t.last_nudge_at) / DAY_MS : null;
    if (!nudgeDue(t.nudge_count, ageDays, sinceLast)) continue;

    const debtor = L.getMember(t.from_id);
    const creditor = L.getMember(t.to_id);
    const group = L.getGroup(t.group_id);
    const amount = formatMoney(t.amount_cents, group.currency);
    const previous = L.listMessages(t.group_id, 200)
      .filter((m) => m.kind === "nudge" && m.data?.transferId === t.id)
      .map((m) => m.content);
    const nudgeNumber = t.nudge_count + 1;
    const level = levelFor(nudgeNumber);

    let text: string;
    try {
      text = await writeNudge({
        debtor: debtor.name.split(" ")[0],
        creditor: creditor.name.split(" ")[0],
        amount,
        daysOutstanding: Math.floor(ageDays),
        nudgeNumber,
        level,
        hasInvoice: Boolean(t.paypal_invoice_url),
        previous,
      });
    } catch (err) {
      postErrorOnce(t.group_id, "nudge", `Payment reminder (Claude) failed: ${describeAiError(err)}`);
      continue;
    }

    // The transfer may have been paid/cancelled while Claude was writing.
    if (L.getTransfer(t.id).status !== "open") continue;
    L.updateTransfer(t.id, { nudge_count: nudgeNumber, last_nudge_at: t0 });
    L.addMessage({
      groupId: t.group_id,
      role: "agent",
      kind: "nudge",
      content: text,
      data: {
        transferId: t.id,
        level,
        nudgeNumber,
        debtor: debtor.name,
        creditor: creditor.name,
        amount,
        daysOutstanding: Math.floor(ageDays),
        invoiceUrl: t.paypal_invoice_url,
      },
    });
  }
}

export function startScheduler(): void {
  setInterval(() => {
    if (current) return;
    tick().catch((err) => console.error("[scheduler]", err));
  }, TICK_MS);
}
