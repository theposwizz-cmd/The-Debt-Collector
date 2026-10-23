import Anthropic from "@anthropic-ai/sdk";
import { assertNotRefused, baseRequest, claude } from "./client.js";
import { NUDGE_SYSTEM } from "./prompts.js";

export interface NudgeInput {
  debtor: string;
  creditor: string;
  amount: string;
  daysOutstanding: number;
  nudgeNumber: number; // 1-based
  level: 1 | 2 | 3;
  hasInvoice: boolean;
  previous: string[];
}

/** Claude writes the next reminder on the escalation ladder. */
export async function writeNudge(n: NudgeInput): Promise<string> {
  const prompt = [
    `Write reminder #${n.nudgeNumber} at level ${n.level}.`,
    `Debtor: ${n.debtor}. Owes ${n.amount} to ${n.creditor}.`,
    `Outstanding for ${n.daysOutstanding} day${n.daysOutstanding === 1 ? "" : "s"}.`,
    n.hasInvoice ? "A PayPal payment request has been sent to them." : "No PayPal request could be sent (no email on file).",
    n.previous.length ? `Earlier reminders (don't reuse their wording):\n${n.previous.map((p) => `- ${p}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await claude().beta.messages.create({
    ...baseRequest,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: NUDGE_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  assertNotRefused(response);
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim()
    .replace(/^"|"$/g, "");
  if (!text) throw new Error("Claude returned an empty reminder.");
  return text;
}

/** Ladder: #1 at day 0 (level 1), #2 from day 2 (level 2), #3+ from day 4, every 2 days (level 3). Max 6. */
export const MAX_NUDGES = 6;

export function nudgeDue(nudgesSent: number, ageDays: number, daysSinceLast: number | null): boolean {
  if (nudgesSent >= MAX_NUDGES) return false;
  if (nudgesSent === 0) return true;
  if (daysSinceLast !== null && daysSinceLast < 1) return false; // one per simulated day, at most
  const threshold = nudgesSent === 1 ? 2 : 4 + (nudgesSent - 2) * 2;
  return ageDays >= threshold;
}

export function levelFor(nudgeNumber: number): 1 | 2 | 3 {
  return nudgeNumber <= 1 ? 1 : nudgeNumber === 2 ? 2 : 3;
}
