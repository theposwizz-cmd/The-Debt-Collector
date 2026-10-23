import path from "node:path";
import { fileURLToPath } from "node:url";
import tls from "node:tls";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "../..");
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

// Also trust the OS certificate store (Windows/macOS), not just Node's bundled CAs. Antivirus
// HTTPS scanning and company proxies re-sign traffic with a root that only the OS trusts;
// without this, Claude/PayPal calls fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE.
try {
  tls.setDefaultCACertificates([...new Set([...tls.getCACertificates("default"), ...tls.getCACertificates("system")])]);
} catch (err) {
  console.warn("[tls] couldn't add system certificates:", (err as Error).message);
}

const fromRoot = (p: string) => path.resolve(ROOT_DIR, p);
export const DATA_DIR = path.join(ROOT_DIR, "data");
/** SQLite file. Configurable so a host can point it at a persistent disk; created if missing. */
export const DATABASE_PATH = fromRoot(process.env.DATABASE_PATH || path.join(DATA_DIR, "debt-collector.db"));
export const UPLOAD_DIR = fromRoot(process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads"));
export const WEB_DIST = path.join(ROOT_DIR, "web", "dist");

// Production listens on PORT (Render, Railway, etc. set it). `npm run dev` ignores PORT on purpose:
// the dev preview sets PORT for Vite, so the API uses API_PORT (default 3001) and Vite proxies to it.
const isDev = process.env.npm_lifecycle_event === "dev";
export const PORT = Number(process.env.API_PORT || (!isDev && process.env.PORT) || 3001);
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com"; // sandbox only, by design

/** Thrown when a required secret is missing. Surfaced to the user verbatim. */
export class ConfigError extends Error {}

export function requireAnthropicKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ConfigError(
      "ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example) and restart the server.",
    );
  }
}

export function paypalCredentials(): { clientId: string; secret: string } {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) {
    throw new ConfigError(
      "PayPal sandbox is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env and restart the server.",
    );
  }
  return { clientId, secret };
}

export function configStatus() {
  return {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    paypal: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    model: ANTHROPIC_MODEL,
  };
}
