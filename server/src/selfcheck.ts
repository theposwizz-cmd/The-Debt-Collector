/**
 * Integration self-check: REAL calls, not "is the key set".
 * - Claude: one tiny live request; reports the model that answered and latency.
 * - PayPal: a fresh sandbox OAuth token plus one read-only Invoicing call.
 * Errors are reported verbatim (plus a plain-English hint where we have one).
 */
import Anthropic from "@anthropic-ai/sdk";
import { configStatus } from "./config.js";
import { emit } from "./events.js";
import * as L from "./ledger.js";
import { checkPaypal } from "./paypal.js";
import { assertNotRefused, baseRequest, claude, describeAiError } from "./ai/client.js";

export interface CheckResult {
  ok: boolean;
  detail: string;
  ms: number | null;
}

export interface SelfCheck {
  status: "idle" | "running" | "done";
  at: number | null; // when the last run finished
  claude: CheckResult | null;
  paypal: CheckResult | null;
}

let result: SelfCheck = { status: "idle", at: null, claude: null, paypal: null };
let running: Promise<SelfCheck> | null = null;

export function selfCheckState(): SelfCheck {
  return result;
}

function errorText(err: unknown, friendly?: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  return friendly && friendly !== raw ? `${friendly} (${raw})` : raw;
}

async function checkClaude(): Promise<CheckResult> {
  if (!configStatus().anthropic) return { ok: false, detail: "ANTHROPIC_API_KEY is not set in .env.", ms: null };
  const t0 = Date.now();
  try {
    const res = await claude().beta.messages.create({
      ...baseRequest,
      max_tokens: 2000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Integration self-check. Reply with exactly: OK" }],
    });
    assertNotRefused(res);
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    const ms = Date.now() - t0;
    if (!text) return { ok: false, detail: `Claude answered with no text (stop_reason: ${res.stop_reason}).`, ms };
    return { ok: true, detail: `Live call OK · model ${res.model} · replied "${text.slice(0, 24)}"`, ms };
  } catch (err) {
    return { ok: false, detail: errorText(err, describeAiError(err)), ms: Date.now() - t0 };
  }
}

async function checkPaypalLive(): Promise<CheckResult> {
  if (!configStatus().paypal) return { ok: false, detail: "PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set in .env.", ms: null };
  const t0 = Date.now();
  try {
    return { ok: true, detail: await checkPaypal(), ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, detail: errorText(err), ms: Date.now() - t0 };
  }
}

export function runSelfCheck(): Promise<SelfCheck> {
  if (running) return running;
  result = { ...result, status: "running" };
  emitState();
  running = (async () => {
    const [c, p] = await Promise.all([checkClaude(), checkPaypalLive()]);
    result = { status: "done", at: Date.now(), claude: c, paypal: p };
    running = null;
    emitState();
    return result;
  })();
  return running;
}

function emitState() {
  try {
    emit({ type: "state", groupId: L.currentGroup().id });
  } catch {
    /* no group yet: the next /api/state call carries it */
  }
}
