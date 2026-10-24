/**
 * Autonomous chasing. Every few seconds: refresh PayPal status for open
 * settle-up requests, book payments, and post the next escalation nudge for
 * anything still unpaid — all against the simulated clock.
 */
import { DAY_MS, now } from "./clock.js";
import { configStatus } from "./config.js";
import * as L from "./ledger.js";
import { formatMoney } from "./money.js";
import { checkInvoices, type CheckOutcome } from "./settlement.js";
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

/**
 * Run one pass. If a pass is already running, wait for it and then run a fresh one, so a manual
 * "check payment now" never races the poller. Returns what the PayPal check found (if it ran).
 */
export async function tick(opts: { forcePaypal?: boolean; transferId?: number } = {}): Promise<CheckOutcome[]> {
  while (current) await current.catch(() => undefined);
  const pass = runPass(opts);
  current = pass.then(() => undefined).finally(() => {
    current = null;
  });
  return pass;
}

async function runPass(opts: { forcePaypal?: boolean; transferId?: number }): Promise<CheckOutcome[]> {
  let outcomes: CheckOutcome[] = [];
  // 1. PayPal: did anyone pay? (Paid / refunded / cancelled events are posted by checkInvoices.)
  if (configStatus().paypal && (opts.forcePaypal || Date.now() - lastPaypalRefresh > PAYPAL_REFRESH_MS)) {
    if (!opts.transferId) lastPaypalRefresh = Date.now();
    try {
      outcomes = await checkInvoices({ transferId: opts.transferId });
      for (const o of outcomes) {
        if (o.kind === "error") {
          postErrorOnce(L.getTransfer(o.transfer.id).group_id, "paypal", `PayPal payment check failed, so this payment can't be detected yet: ${o.message}`);
        }
      }
    } catch (err) {
      // e.g. auth failure: payment detection is down for every group that's waiting on PayPal.
      console.error(`[paypal] poll failed: ${(err as Error).message}`);
      for (const gid of groupsWithOpenInvoices()) {
        postErrorOnce(gid, "paypal", `PayPal payment check failed, so payments won't be detected: ${(err as Error).message}`);
      }
      if (opts.transferId) throw err;
    }
  }
  if (opts.transferId) return outcomes; // a manual single check doesn't also run nudges

  // 2. Nudges for whatever is still open. They're written by Claude, so without a key there's
  // nothing to send; the UI banner already says the key is missing, so don't spam the chat.
  if (!configStatus().anthropic) {
    if (!warnedNoKey) console.warn("[scheduler] ANTHROPIC_API_KEY missing: payment reminders are paused.");
    warnedNoKey = true;
    return outcomes;
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
  return outcomes;
}

export function startScheduler(): void {
  setInterval(() => {
    if (current) return;
    tick().catch((err) => console.error("[scheduler]", err));
  }, TICK_MS);
}
