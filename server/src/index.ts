import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { advance, DAY_MS, getOffsetMs, now, resetClock } from "./clock.js";
import { ConfigError, configStatus, PORT, UPLOAD_DIR, WEB_DIST } from "./config.js";
import { bus, emit, type BusEvent } from "./events.js";
import * as L from "./ledger.js";
import { loadDemo } from "./demo.js";
import { quickReply, type QuickKind } from "./quickcards.js";
import { createGroupFromSetup, SetupError } from "./setup.js";
import { startScheduler, tick } from "./scheduler.js";
import { recordManualPayment, settleUpInChat, viewTransfer } from "./settlement.js";
import { runAgentTurn } from "./ai/agent.js";
import { describeAiError } from "./ai/client.js";
import { extractReceipt } from "./ai/receipt.js";
import { ImageError, prepareReceiptImage, type PreparedImage } from "./images.js";
import { aiRateLimit } from "./ratelimit.js";

const app = express();
// Behind Render's (or any) proxy, use the visitor's IP from X-Forwarded-For for rate limiting.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
const aiLimit = aiRateLimit();
// Manual PayPal checks don't spend Claude credits, but each is a real PayPal call.
const paypalLimit = aiRateLimit(30);

// Liveness probe for the host and uptime pings: no database, no AI, always fast.
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true, uptime: Math.round(process.uptime()) }));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1h" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- helpers ----------

function speakerFor(groupId: number, raw: unknown): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id)) return null;
  return L.listMembers(groupId).some((m) => m.id === id) ? id : null;
}

/** Every live-call failure lands in the chat, named by what failed. Never swallowed. */
function postError(groupId: number, err: unknown, context?: string) {
  const detail = err instanceof ConfigError || err instanceof ImageError ? err.message : describeAiError(err);
  const text = context ? `${context}: ${detail}` : detail;
  console.error("[error]", text, err);
  L.addMessage({ groupId, role: "system", kind: "error", content: text });
}

/** Kick off the agent in the background; the reply arrives over SSE. */
function respondInBackground(groupId: number, messageId: number, speakerId: number | null) {
  runAgentTurn(groupId, messageId, speakerId).catch((err) => postError(groupId, err, "The Collector (Claude) couldn't reply"));
}

function state() {
  const g = L.currentGroup();
  return {
    group: { id: g.id, name: g.name, currency: g.currency },
    members: L.listMembers(g.id).map((m) => ({ id: m.id, name: m.name, email: m.email })),
    messages: L.listMessages(g.id),
    transfers: L.listTransfers(g.id).filter((t) => t.status !== "cancelled").map(viewTransfer),
    balances: L.balances(g.id).map((b) => ({
      memberId: b.memberId,
      name: b.name,
      netCents: b.netCents,
      budgetCents: b.budgetCents,
      spentCents: b.spentCents,
    })),
    clock: { now: now(), offsetDays: Math.round((getOffsetMs() / DAY_MS) * 10) / 10 },
    config: configStatus(),
    cases: L.listGroups(),
  };
}

// ---------- routes ----------

app.get("/api/health", (_req, res) => res.json({ ok: true, ...configStatus() }));

app.get("/api/state", (_req, res) => res.json(state()));

app.get("/api/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const groupId = L.currentGroup().id;
  const send = (e: BusEvent) => {
    if (e.groupId !== groupId) return;
    if (e.type === "state") res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
    else res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  };
  // Coalesce bursts of state events (a settle-up fires several).
  let pending: NodeJS.Timeout | null = null;
  const listener = (e: BusEvent) => {
    if (e.type !== "state") return send(e);
    if (e.groupId !== groupId || pending) return;
    pending = setTimeout(() => {
      pending = null;
      send(e);
    }, 150);
  };
  bus.on("event", listener);
  // Real (named) heartbeat so the browser can tell a live stream from a silently dead one.
  res.write("event: ping\ndata: {}\n\n");
  const ping = setInterval(() => res.write("event: ping\ndata: {}\n\n"), 10000);
  req.on("close", () => {
    bus.off("event", listener);
    clearInterval(ping);
    if (pending) clearTimeout(pending);
  });
});

app.post("/api/messages", aiLimit, (req, res) => {
  const content = String(req.body?.content ?? "").trim();
  if (!content) return res.status(400).json({ error: "Empty message" });
  const g = L.currentGroup();
  const speakerId = speakerFor(g.id, req.body?.speakerId);
  const msg = L.addMessage({ groupId: g.id, role: "user", authorId: speakerId, content });
  respondInBackground(g.id, msg.id, speakerId);
  res.status(202).json(msg);
});

// Instant cards for the "Show balances" / "Who owes the most?" chips: computed from the
// ledger, no AI call, so they work even without ANTHROPIC_API_KEY.
app.post("/api/quick", (req, res) => {
  const kind = req.body?.kind as QuickKind | "settle";
  if (kind !== "balances" && kind !== "debts" && kind !== "settle") return res.status(400).json({ error: "Unknown quick action" });
  const g = L.currentGroup();
  const speakerId = speakerFor(g.id, req.body?.speakerId);
  const fallback = { balances: "Show balances", debts: "Who owes the most?", settle: "Settle up" }[kind];
  const text = String(req.body?.text ?? "").trim() || fallback;
  const msg = L.addMessage({ groupId: g.id, role: "user", authorId: speakerId, content: text });
  res.status(202).json(msg);

  if (kind === "settle") {
    // Settle-up needs no AI: compute transfers, send PayPal requests, post one request per debtor.
    emit({ type: "typing", groupId: g.id, typing: true });
    settleUpInChat(g.id)
      .catch((err) => postError(g.id, err, "Settle-up failed"))
      .finally(() => emit({ type: "typing", groupId: g.id, typing: false }));
    return;
  }
  const { content, card } = quickReply(kind, g.id);
  L.addMessage({ groupId: g.id, role: "agent", content, data: { cards: [card] } });
});

// "Mark as settled" on a request: paid outside PayPal (cash, bank). Books the payment and,
// if there's a PayPal invoice, marks it paid there too.
// "Check payment now": ask PayPal about one request right away instead of waiting for the poll.
// Goes through the scheduler's queue, so it can't double-book a payment the poller just saw.
app.post("/api/transfers/:id/check", paypalLimit, async (req, res, next) => {
  try {
    const t = L.getTransfer(Number(req.params.id));
    if (!t || t.group_id !== L.currentGroup().id) return res.status(404).json({ error: "No such request" });
    if (!t.paypal_invoice_id) return res.status(409).json({ error: "This request has no PayPal invoice to check." });
    if (!configStatus().paypal) return res.status(503).json({ error: "PayPal sandbox keys are missing, so payments can't be checked." });
    const [outcome] = await tick({ forcePaypal: true, transferId: t.id });
    res.json({ result: outcome ?? null, state: state() });
  } catch (err) {
    next(err);
  }
});

// Check every open PayPal request now (all cases), then run the usual pass.
app.post("/api/paypal/check", paypalLimit, async (_req, res, next) => {
  try {
    if (!configStatus().paypal) return res.status(503).json({ error: "PayPal sandbox keys are missing, so payments can't be checked." });
    const outcomes = await tick({ forcePaypal: true });
    const counts = outcomes.reduce<Record<string, number>>((acc, o) => ((acc[o.kind] = (acc[o.kind] ?? 0) + 1), acc), {});
    res.json({ checked: outcomes.length, counts, results: outcomes.map((o) => ({ id: o.transfer.id, kind: o.kind, status: o.status, message: o.message })), state: state() });
  } catch (err) {
    next(err);
  }
});

app.post("/api/transfers/:id/settle", async (req, res, next) => {
  try {
    const g = L.currentGroup();
    const t = L.getTransfer(Number(req.params.id));
    if (!t || t.group_id !== g.id) return res.status(404).json({ error: "No such request" });
    if (t.status !== "open") return res.status(409).json({ error: "That request is already closed." });
    // Only the person who's owed can confirm they were paid outside PayPal.
    if (speakerFor(g.id, req.body?.speakerId) !== t.to_id) {
      return res.status(403).json({ error: `Only ${L.getMember(t.to_id).name} can confirm this was paid.` });
    }
    const result = await recordManualPayment(g.id, t.from_id, t.to_id, t.amount_cents, "Marked as settled in chat");
    const tv = result.closedTransfer ?? viewTransfer(L.getTransfer(t.id));
    L.addMessage({
      groupId: g.id,
      role: "system",
      kind: "event",
      content: `${tv.from} settled ${tv.amount} with ${tv.to}.${result.paypalNote ? ` ${result.paypalNote}` : ""}`,
    });
    res.json(state());
  } catch (err) {
    next(err);
  }
});

app.post("/api/receipts", aiLimit, upload.single("image"), async (req, res) => {
  const g = L.currentGroup();
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No image uploaded" });
  const speakerId = speakerFor(g.id, req.body?.speakerId);
  const caption = String(req.body?.caption ?? "").trim();

  // HEIC -> JPEG, big photos downscaled, format checked from the bytes. Failures go to the chat.
  let image: PreparedImage;
  try {
    image = await prepareReceiptImage(file.buffer, file.mimetype, file.originalname);
  } catch (err) {
    const msg = L.addMessage({ groupId: g.id, role: "user", authorId: speakerId, content: caption || `(sent a receipt photo: ${file.originalname})` });
    postError(g.id, err instanceof ImageError ? err : new Error(`Couldn't read the uploaded photo: ${(err as Error).message}`));
    return res.status(202).json(msg);
  }
  const name = `${crypto.randomUUID()}.${image.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), image.buffer);

  const msg = L.addMessage({
    groupId: g.id,
    role: "user",
    authorId: speakerId,
    content: caption || "(sent a receipt)",
    data: { image: `/uploads/${name}`, scanning: true, convertedFrom: image.convertedFromHeic ? "HEIC" : undefined },
  });
  res.status(202).json(msg);

  (async () => {
    try {
      const extracted = await extractReceipt(image.buffer, image.mediaType);
      const receiptId = L.addReceipt(g.id, name, extracted);
      L.updateMessageData(msg.id, { scanning: false, receipt: { id: receiptId, extracted } });
      await runAgentTurn(g.id, msg.id, speakerId);
    } catch (err) {
      L.updateMessageData(msg.id, { scanning: false });
      postError(g.id, err, "Receipt reading (Claude vision) failed");
    }
  })();
});

app.post("/api/demo", (_req, res) => {
  loadDemo();
  res.json(state());
});

// New-group survey: purpose, your name, who else, and (trips/events) where everyone stands.
app.post("/api/groups", (req, res, next) => {
  try {
    const { meId } = createGroupFromSetup({
      purpose: req.body?.purpose,
      me: req.body?.me,
      others: Array.isArray(req.body?.others) ? req.body.others : [],
      balances: Array.isArray(req.body?.balances) ? req.body.balances : undefined,
      budgets: Array.isArray(req.body?.budgets) ? req.body.budgets : undefined,
    });
    res.json({ ...state(), meId });
  } catch (err) {
    if (err instanceof SetupError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Reopen a saved case. Every case stays on file; this only changes which one is open.
app.post("/api/groups/:id/open", (req, res) => {
  try {
    L.openGroup(Number(req.params.id));
    res.json(state());
  } catch {
    res.status(404).json({ error: "That case isn't on file any more." });
  }
});

app.post("/api/reset", (_req, res) => {
  resetClock();
  L.newGroup();
  res.json(state());
});

app.post("/api/dev/fast-forward", aiLimit, async (req, res, next) => {
  try {
    const days = Math.min(Math.max(Number(req.body?.days ?? 1), 0.1), 30);
    advance(days);
    const g = L.currentGroup();
    L.addMessage({
      groupId: g.id,
      role: "system",
      kind: "clock",
      content: `Demo clock moved forward ${days} day${days === 1 ? "" : "s"}.`,
      data: { offsetDays: getOffsetMs() / DAY_MS },
    });
    await tick({ forcePaypal: true });
    res.json(state());
  } catch (err) {
    next(err);
  }
});

app.post("/api/dev/reset-clock", (_req, res) => {
  resetClock();
  res.json(state());
});

// ---------- production: serve the built web app ----------

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  const status = err instanceof ConfigError ? 503 : 500;
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
});

// Free hosting disks are wiped on redeploy/restart. On an empty database, seed the demo so the
// first visitor always finds a working case (set SEED_DEMO=false to start truly empty).
if (process.env.SEED_DEMO !== "false" && L.listGroups().length === 0) {
  loadDemo();
  console.log("  Empty database: seeded the Hvar Trip demo.");
}

app.listen(PORT, () => {
  const cfg = configStatus();
  console.log(`The Debt Collector server on http://localhost:${PORT}`);
  console.log(`  Claude model: ${cfg.model}  |  Anthropic key: ${cfg.anthropic ? "set" : "MISSING"}  |  PayPal sandbox: ${cfg.paypal ? "set" : "MISSING"}`);
  if (!cfg.anthropic || !cfg.paypal) console.log("  Copy .env.example to .env and fill in the keys. Features needing a missing key will show a clear error.");
  startScheduler();
});
