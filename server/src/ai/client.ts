import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_MODEL, requireAnthropicKey } from "../config.js";

let client: Anthropic | null = null;

/** Throws ConfigError (shown to the user) when ANTHROPIC_API_KEY is missing. Never fakes a response. */
export function claude(): Anthropic {
  requireAnthropicKey();
  return (client ??= new Anthropic());
}

/**
 * Common request options: the configured model plus server-side refusal fallback
 * (re-runs a declined request on Anthropic's recommended fallback model).
 */
export const baseRequest = {
  model: ANTHROPIC_MODEL,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

export class RefusalError extends Error {}

export function assertNotRefused(msg: { stop_reason: string | null }): void {
  if (msg.stop_reason === "refusal") {
    throw new RefusalError("The model declined this request. Try rephrasing it.");
  }
}

/** Turn an SDK error into something a person can act on. */
export function describeAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY in .env.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Anthropic denied access for this key/model (403).";
  if (err instanceof Anthropic.NotFoundError) return `Model not found: ${ANTHROPIC_MODEL}. Set ANTHROPIC_MODEL in .env.`;
  if (err instanceof Anthropic.RateLimitError) return "Anthropic rate limit hit. Give it a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) {
    // Surface the real network cause (DNS, TLS, refused...) rather than a generic line.
    let c: any = (err as any).cause;
    const parts: string[] = [];
    for (let i = 0; c && i < 4; i++, c = c.cause) parts.push([c.code, c.message].filter(Boolean).join(" "));
    return `Could not reach the Anthropic API (network error)${parts.length ? `: ${parts.join(" <- ")}` : "."}`;
  }
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
