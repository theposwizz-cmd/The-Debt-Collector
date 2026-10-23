/**
 * The The Debt Collector agent: one Claude tool-use loop per chat turn. Claude decides intent
 * (setup / expense / question / dispute / settle-up) by choosing tools; all ledger
 * math happens in deterministic code.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { now } from "../clock.js";
import { emit } from "../events.js";
import * as L from "../ledger.js";
import { formatMoney, splitCustom, splitEven, splitWeighted, toCents } from "../money.js";
import { balancesCard, debtsCard, type BalancesCardData, type DebtsCardData } from "../quickcards.js";
import { postSettlementRequests, recordManualPayment, refreshInvoices, reportSettleProblems, settleUp } from "../settlement.js";
import { assertNotRefused, baseRequest, claude } from "./client.js";
import { AGENT_SYSTEM } from "./prompts.js";

type Tool = Anthropic.Beta.BetaTool;
type MessageParam = Anthropic.Beta.BetaMessageParam;

class ToolError extends Error {}

export type Card =
  | { type: "members"; group: string | null; members: { name: string; email: string | null }[] }
  | { type: "expense"; label: string; expense: ExpenseView }
  | { type: "transfers"; transfers: unknown[]; note?: string }
  | BalancesCardData
  | { type: "payment"; from: string; to: string; amount: string; method: string; note?: string | null }
  | DebtsCardData;

interface ExpenseView {
  id: number;
  description: string;
  amount: string;
  paidBy: string;
  split: string;
  shares: { member: string; share: string }[];
  source: string;
  voided?: boolean;
  receipt?: { merchant: string | null; imageUrl: string | null };
}

// ---------- tool definitions ----------

const memberRef = { type: "string", description: 'A member name from the roster, or "me" for the current speaker.' };

const TOOLS: Tool[] = [
  {
    name: "setup_group",
    description: "Set or change the group's name and/or currency (ISO 4217, e.g. EUR).",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, currency: { type: "string" } },
    },
  },
  {
    name: "add_members",
    description: "Add people to the group (or update the email of someone already in it). Emails are needed for PayPal requests.",
    input_schema: {
      type: "object",
      properties: {
        members: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, email: { type: "string" } },
            required: ["name"],
          },
        },
      },
      required: ["members"],
    },
  },
  {
    name: "update_member",
    description:
      "Rename a member, change their email, or set their personal trip budget (money they brought; 0 clears it). Budgets don't affect who owes whom.",
    input_schema: {
      type: "object",
      properties: { member: memberRef, new_name: { type: "string" }, email: { type: "string" }, budget: { type: "number" } },
      required: ["member"],
    },
  },
  {
    name: "add_expense",
    description:
      "Record an expense. Split types: 'even' (equally among participants; omit participants for everyone), 'custom' (exact amounts per person, must add up to the total), 'weights' (proportional, e.g. portions or nights).",
    input_schema: {
      type: "object",
      properties: {
        payer: memberRef,
        description: { type: "string", description: "Short label, e.g. 'Villa', 'Boat trip'" },
        amount: { type: "number", description: "Total in the group currency, e.g. 600 or 186.40" },
        currency: { type: "string", description: "Currency of the amount if stated (ISO code)" },
        date: { type: "string", description: "YYYY-MM-DD if known" },
        split: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["even", "custom", "weights"] },
            participants: { type: "array", items: memberRef, description: "For 'even'. Omit for everyone." },
            amounts: {
              type: "array",
              items: { type: "object", properties: { member: memberRef, amount: { type: "number" } }, required: ["member", "amount"] },
            },
            weights: {
              type: "array",
              items: { type: "object", properties: { member: memberRef, weight: { type: "number" } }, required: ["member", "weight"] },
            },
          },
          required: ["type"],
        },
        receipt_id: { type: "integer", description: "Set when this expense comes from an uploaded receipt." },
      },
      required: ["payer", "description", "amount", "split"],
    },
  },
  {
    name: "get_ledger",
    description:
      "Full ledger: members, every expense with shares (including voided ones), repayments, each person's net balance, and settle-up requests with PayPal status. Use before answering questions or handling disputes.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "show_balances",
    description: "Render a balances card in the chat: each person's net balance plus a line chart of how balances moved over time. Only when someone explicitly asks to see balances, a summary, a chart or a table.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_expense",
    description: "Correct an existing expense (amount, description, payer and/or split). Used for disputes and corrections.",
    input_schema: {
      type: "object",
      properties: {
        expense_id: { type: "integer" },
        amount: { type: "number" },
        description: { type: "string" },
        payer: memberRef,
        split: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["even", "custom", "weights"] },
            participants: { type: "array", items: memberRef },
            amounts: {
              type: "array",
              items: { type: "object", properties: { member: memberRef, amount: { type: "number" } }, required: ["member", "amount"] },
            },
            weights: {
              type: "array",
              items: { type: "object", properties: { member: memberRef, weight: { type: "number" } }, required: ["member", "weight"] },
            },
          },
          required: ["type"],
        },
        reason: { type: "string", description: "Why it changed, for the record." },
      },
      required: ["expense_id", "reason"],
    },
  },
  {
    name: "void_expense",
    description: "Remove an expense from the ledger (duplicate, never happened, entered by mistake). Kept for the record.",
    input_schema: {
      type: "object",
      properties: { expense_id: { type: "integer" }, reason: { type: "string" } },
      required: ["expense_id", "reason"],
    },
  },
  {
    name: "record_payment",
    description:
      "Record that someone paid someone back outside PayPal (cash, bank transfer). If it matches an open settle-up request exactly, that request is closed and its PayPal invoice marked paid.",
    input_schema: {
      type: "object",
      properties: { from: memberRef, to: memberRef, amount: { type: "number" }, note: { type: "string" } },
      required: ["from", "to", "amount"],
    },
  },
  {
    name: "show_debts",
    description:
      "Render a 'who owes whom' card: everyone who owes money ranked biggest first, who each should pay (the settle-up plan), and who is owed. Use for 'who owes the most?', 'who owes whom?', 'who do I owe?'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "settle_up",
    description:
      "Compute the minimum set of transfers that settles everyone, and send a real PayPal sandbox invoice for each (debtor pays creditor). Supersedes any earlier unpaid requests.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "refresh_invoices",
    description: "Check PayPal for the latest status of open invoices and book any that were paid.",
    input_schema: { type: "object", properties: {} },
  },
];

// ---------- input validation ----------

const SplitInput = z.object({
  type: z.enum(["even", "custom", "weights"]),
  participants: z.array(z.string()).optional(),
  amounts: z.array(z.object({ member: z.string(), amount: z.number() })).optional(),
  weights: z.array(z.object({ member: z.string(), weight: z.number() })).optional(),
});

const Inputs = {
  setup_group: z.object({ name: z.string().optional(), currency: z.string().length(3).optional() }),
  add_members: z.object({ members: z.array(z.object({ name: z.string().min(1), email: z.string().optional() })).min(1) }),
  update_member: z.object({
    member: z.string(),
    new_name: z.string().optional(),
    email: z.string().optional(),
    budget: z.number().min(0).optional(),
  }),
  add_expense: z.object({
    payer: z.string(),
    description: z.string().min(1),
    amount: z.number().positive(),
    currency: z.string().optional(),
    date: z.string().optional(),
    split: SplitInput,
    receipt_id: z.number().int().optional(),
  }),
  get_ledger: z.object({}),
  show_balances: z.object({}),
  show_debts: z.object({}),
  update_expense: z.object({
    expense_id: z.number().int(),
    amount: z.number().positive().optional(),
    description: z.string().optional(),
    payer: z.string().optional(),
    split: SplitInput.optional(),
    reason: z.string(),
  }),
  void_expense: z.object({ expense_id: z.number().int(), reason: z.string() }),
  record_payment: z.object({ from: z.string(), to: z.string(), amount: z.number().positive(), note: z.string().optional() }),
  settle_up: z.object({}),
  refresh_invoices: z.object({}),
} as const;

// ---------- tool execution ----------

interface TurnCtx {
  groupId: number;
  speakerId: number | null;
  cards: Card[];
  after: (() => void)[]; // run once the reply is posted (e.g. per-person settlement requests)
}

function resolve(ctx: TurnCtx, ref: string): L.Member {
  const r = ref.trim();
  if (/^(me|i|myself)$/i.test(r)) {
    if (!ctx.speakerId) throw new ToolError('Nobody is selected as the current speaker, so "me" is ambiguous. Ask who they are.');
    return L.getMember(ctx.speakerId);
  }
  const m = L.findMember(ctx.groupId, r);
  if (!m) {
    const roster = L.listMembers(ctx.groupId).map((x) => x.name).join(", ") || "(nobody yet)";
    throw new ToolError(`No member matches "${ref}". Current members: ${roster}. Add them first or ask.`);
  }
  return m;
}

function computeShares(ctx: TurnCtx, totalCents: number, split: z.infer<typeof SplitInput>): Map<number, number> {
  if (split.type === "even") {
    const ids = split.participants?.length
      ? split.participants.map((p) => resolve(ctx, p).id)
      : L.listMembers(ctx.groupId).map((m) => m.id);
    if (!ids.length) throw new ToolError("The group has no members yet.");
    return splitEven(totalCents, ids);
  }
  if (split.type === "custom") {
    if (!split.amounts?.length) throw new ToolError("Custom split needs amounts per member.");
    const m = new Map<number, number>();
    for (const a of split.amounts) {
      const id = resolve(ctx, a.member).id;
      m.set(id, (m.get(id) ?? 0) + toCents(a.amount));
    }
    try {
      return splitCustom(totalCents, m);
    } catch (e) {
      throw new ToolError((e as Error).message);
    }
  }
  if (!split.weights?.length) throw new ToolError("Weighted split needs weights per member.");
  const w = new Map<number, number>();
  for (const x of split.weights) w.set(resolve(ctx, x.member).id, x.weight);
  return splitWeighted(totalCents, w);
}

function viewExpense(e: L.Expense): ExpenseView {
  const g = L.getGroup(e.group_id);
  const r = e.receipt_id ? L.getReceipt(e.receipt_id) : undefined;
  return {
    id: e.id,
    description: e.description,
    amount: formatMoney(e.amount_cents, g.currency),
    paidBy: L.getMember(e.payer_id).name,
    split: e.split_type,
    shares: e.shares.map((s) => ({ member: L.getMember(s.member_id).name, share: formatMoney(s.share_cents, g.currency) })),
    source: e.source,
    ...(e.voided_at ? { voided: true } : {}),
    ...(r ? { receipt: { merchant: r.extracted?.merchant ?? null, imageUrl: r.image_path ? `/uploads/${r.image_path}` : null } } : {}),
  };
}

async function runTool(ctx: TurnCtx, name: string, rawInput: unknown): Promise<unknown> {
  const schema = Inputs[name as keyof typeof Inputs];
  if (!schema) throw new ToolError(`Unknown tool ${name}`);
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ToolError(`Invalid input: ${parsed.error.message}`);
  const input: any = parsed.data;
  const gid = ctx.groupId;
  const group = L.getGroup(gid);

  switch (name) {
    case "setup_group": {
      const g = L.updateGroup(gid, { name: input.name, currency: input.currency });
      ctx.cards.push({ type: "members", group: g.name, members: L.listMembers(gid).map((m) => ({ name: m.name, email: m.email })) });
      return { group: g };
    }
    case "add_members": {
      const added = input.members.map((m: { name: string; email?: string }) => L.addMember(gid, m.name, m.email));
      ctx.cards.push({ type: "members", group: group.name, members: L.listMembers(gid).map((m) => ({ name: m.name, email: m.email })) });
      return { added, members: L.listMembers(gid) };
    }
    case "update_member": {
      const m = resolve(ctx, input.member);
      const budgetCents = input.budget === undefined ? undefined : input.budget === 0 ? null : toCents(input.budget);
      return { member: L.updateMember(m.id, { name: input.new_name, email: input.email, budgetCents }) };
    }
    case "add_expense": {
      if (input.currency && input.currency.toUpperCase() !== group.currency) {
        throw new ToolError(
          `This group is in ${group.currency} but the expense is in ${input.currency.toUpperCase()}. Ask for the amount in ${group.currency}.`,
        );
      }
      if (input.receipt_id && !L.getReceipt(input.receipt_id)) throw new ToolError(`Receipt ${input.receipt_id} not found.`);
      const payer = resolve(ctx, input.payer);
      const totalCents = toCents(input.amount);
      const shares = computeShares(ctx, totalCents, input.split);
      const spentAt = input.date && !Number.isNaN(Date.parse(input.date)) ? Date.parse(input.date) : now();
      const e = L.addExpense({
        groupId: gid,
        payerId: payer.id,
        description: input.description,
        amountCents: totalCents,
        splitType: input.split.type,
        shares,
        source: input.receipt_id ? "receipt" : "text",
        receiptId: input.receipt_id ?? null,
        spentAt,
      });
      const view = viewExpense(e);
      ctx.cards.push({ type: "expense", label: "Expense added", expense: view });
      return { expense: view, balances: L.snapshot(gid).balances };
    }
    case "get_ledger":
      return L.snapshot(gid);
    case "show_balances": {
      const card = balancesCard(gid);
      ctx.cards.push(card);
      // The UI draws the history chart; Claude only needs the totals.
      return { rendered: "balances card with a balance-over-time chart", balances: card.balances };
    }
    case "show_debts": {
      const card = debtsCard(gid);
      ctx.cards.push(card);
      return card;
    }
    case "update_expense": {
      const before = L.getExpense(input.expense_id);
      if (before.group_id !== gid) throw new ToolError("That expense belongs to another group.");
      const amountCents = input.amount ? toCents(input.amount) : before.amount_cents;
      let shares: Map<number, number> | undefined;
      if (input.split) shares = computeShares(ctx, amountCents, input.split);
      else if (input.amount) {
        // Keep the same people, re-split proportionally to their old shares.
        shares = splitWeighted(amountCents, new Map(before.shares.map((s) => [s.member_id, s.share_cents])));
      }
      const e = L.updateExpense(before.id, {
        amountCents,
        description: input.description,
        payerId: input.payer ? resolve(ctx, input.payer).id : undefined,
        splitType: input.split?.type,
        shares,
      });
      const view = viewExpense(e);
      ctx.cards.push({ type: "expense", label: "Expense corrected", expense: view });
      return { before: viewExpense(before), after: view, reason: input.reason, ...staleInvoiceHint(gid), balances: L.snapshot(gid).balances };
    }
    case "void_expense": {
      const e = L.getExpense(input.expense_id);
      if (e.group_id !== gid) throw new ToolError("That expense belongs to another group.");
      const view = viewExpense(L.voidExpense(e.id, input.reason));
      ctx.cards.push({ type: "expense", label: "Expense removed", expense: view });
      return { voided: view, ...staleInvoiceHint(gid), balances: L.snapshot(gid).balances };
    }
    case "record_payment": {
      const from = resolve(ctx, input.from);
      const to = resolve(ctx, input.to);
      const cents = toCents(input.amount);
      const res = await recordManualPayment(gid, from.id, to.id, cents, input.note);
      ctx.cards.push({ type: "payment", from: from.name, to: to.name, amount: formatMoney(cents, group.currency), method: "manual", note: input.note ?? null });
      return { ...res, balances: L.snapshot(gid).balances };
    }
    case "settle_up": {
      const res = await settleUp(gid);
      const { transfers, cancelled } = res;
      reportSettleProblems(gid, res);
      // Each debtor gets their own request message (UNSETTLED -> SETTLED) right after the reply.
      ctx.after.push(() => postSettlementRequests(gid, transfers));
      if (!transfers.length) return { message: "Everyone is already even. No transfers needed.", cancelledEarlierRequests: cancelled };
      return { transfers, cancelledEarlierRequests: cancelled };
    }
    case "refresh_invoices": {
      const { paid, errors } = await refreshInvoices(gid);
      if (errors.length) {
        L.addMessage({ groupId: gid, role: "system", kind: "error", content: `PayPal status check failed: ${errors.map((e) => e.message).join(" · ")}` });
      }
      return { newlyPaid: paid, errors: errors.map((e) => e.message), openRequests: L.snapshot(gid).settleUpRequests };
    }
  }
  throw new ToolError(`Unhandled tool ${name}`);
}

function staleInvoiceHint(groupId: number) {
  const open = L.listTransfers(groupId, "open").length;
  return open ? { note: `${open} PayPal request(s) are still open and now out of date. Run settle_up to reissue them.` } : {};
}

// ---------- conversation assembly ----------

function historyToMessages(history: L.ChatMessage[]): MessageParam[] {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const m of history) {
    let role: "user" | "assistant";
    let text: string;
    if (m.role === "user") {
      role = "user";
      text = `[${m.authorName ?? "Someone"}]: ${m.content}`;
      if (m.data?.receipt) text += `\n[Receipt #${m.data.receipt.id} extracted: ${JSON.stringify(m.data.receipt.extracted)}]`;
    } else if (m.role === "agent") {
      role = "assistant";
      text = m.kind === "nudge" ? `(automatic reminder) ${m.content}` : m.content;
    } else {
      role = "user";
      text = `[System event] ${m.content}`;
    }
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += `\n\n${text}`;
    else out.push({ role, text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out.map((m) => ({ role: m.role, content: m.text }));
}

function contextBlock(groupId: number, speakerId: number | null): string {
  const g = L.getGroup(groupId);
  const members = L.listMembers(groupId);
  const speaker = speakerId ? members.find((m) => m.id === speakerId) : undefined;
  const open = L.listTransfers(groupId, "open").length;
  return [
    "<context>",
    `Today: ${new Date(now()).toISOString().slice(0, 10)}`,
    `Group: ${g.name ?? "(not named yet)"} — currency ${g.currency}`,
    `Members: ${members.map((m) => `${m.name}${m.email ? ` <${m.email}>` : " (no email)"}`).join(", ") || "(none yet)"}`,
    `Current speaker: ${speaker ? speaker.name : "unknown — not in the group yet"}`,
    `Open PayPal settle-up requests: ${open}`,
    "</context>",
  ].join("\n");
}

// ---------- the turn ----------

const locks = new Map<number, Promise<unknown>>();

/** Run one agent turn in response to user message `messageId`. Posts the reply into the chat. */
export function runAgentTurn(groupId: number, messageId: number, speakerId: number | null): Promise<L.ChatMessage> {
  const prev = locks.get(groupId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => agentTurn(groupId, messageId, speakerId));
  locks.set(groupId, next);
  return next;
}

async function agentTurn(groupId: number, messageId: number, speakerId: number | null): Promise<L.ChatMessage> {
  emit({ type: "typing", groupId, typing: true });
  try {
    const all = L.listMessages(groupId, 60);
    const idx = all.findIndex((m) => m.id === messageId);
    if (idx === -1) throw new Error(`Message ${messageId} is no longer in the recent history.`);
    const current = all[idx];
    const history = historyToMessages(all.slice(0, idx).filter((m) => m.kind !== "error"));

    let currentText = `[${current.authorName ?? "Someone (not in the group yet)"}]: ${current.content}`;
    if (current.data?.receipt) {
      currentText += `\n[Receipt #${current.data.receipt.id} extracted: ${JSON.stringify(current.data.receipt.extracted)}]`;
    }
    const messages: MessageParam[] = [...history, { role: "user", content: `${contextBlock(groupId, speakerId)}\n\n${currentText}` }];

    const ctx: TurnCtx = { groupId, speakerId, cards: [], after: [] };
    let finalText = "";
    let finished = false;
    let lastStop: string | null = null;
    for (let step = 0; step < 10; step++) {
      const response = await claude().beta.messages.create({
        ...baseRequest,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        system: [{ type: "text", text: AGENT_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      });
      assertNotRefused(response);

      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      lastStop = response.stop_reason;
      if (response.stop_reason === "max_tokens") {
        throw new Error("Claude's reply was cut off (hit max_tokens) before it finished.");
      }
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        finalText = text;
        finished = true;
        break;
      }

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        try {
          const out = await runTool(ctx, tu.name, tu.input);
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
        } catch (err) {
          const msg = err instanceof ToolError ? err.message : `Tool failed: ${(err as Error).message}`;
          if (!(err instanceof ToolError)) {
            // A real failure (PayPal, database...): tell the chat directly, don't rely on Claude to mention it.
            console.error(`[agent] ${tu.name} failed`, err);
            L.addMessage({ groupId, role: "system", kind: "error", content: `${tu.name} failed: ${(err as Error).message}` });
          }
          results.push({ type: "tool_result", tool_use_id: tu.id, content: msg, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }

    const problem = !finished
      ? "The Collector hit its 10-step limit without finishing. Changes made so far are shown above; nothing else was confirmed."
      : !finalText && !ctx.cards.length
        ? `Claude returned an empty reply (stop_reason: ${lastStop ?? "unknown"}).`
        : null;
    // Never invent a reply: with no text, post just the cards (what actually happened).
    const reply =
      finalText || ctx.cards.length
        ? L.addMessage({ groupId, role: "agent", content: finalText, data: ctx.cards.length ? { cards: ctx.cards } : undefined })
        : null;
    for (const fn of ctx.after) fn();
    if (problem || !reply) throw new Error(problem ?? "Claude returned an empty reply.");
    return reply;
  } finally {
    emit({ type: "typing", groupId, typing: false });
  }
}
