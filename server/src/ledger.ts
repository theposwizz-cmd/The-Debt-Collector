import { getDb } from "./db.js";
import { now } from "./clock.js";
import { emit } from "./events.js";
import { formatMoney } from "./money.js";
import { settle, type Transfer } from "./settle.js";

// ---------- types ----------

export interface Group {
  id: number;
  name: string | null;
  currency: string;
  created_at: number;
}

export interface Member {
  id: number;
  group_id: number;
  name: string;
  email: string | null;
  budget_cents: number | null; // personal trip budget (money they brought), if set
}

export interface Expense {
  id: number;
  group_id: number;
  payer_id: number;
  description: string;
  amount_cents: number;
  split_type: string;
  source: string;
  receipt_id: number | null;
  spent_at: number;
  created_at: number;
  voided_at: number | null;
  void_reason: string | null;
  shares: { member_id: number; share_cents: number }[];
}

export interface Payment {
  id: number;
  from_id: number;
  to_id: number;
  amount_cents: number;
  method: string;
  transfer_id: number | null;
  note: string | null;
  paid_at: number;
}

export interface TransferRow {
  id: number;
  group_id: number;
  from_id: number;
  to_id: number;
  amount_cents: number;
  status: "open" | "paid" | "cancelled";
  paypal_invoice_id: string | null;
  paypal_invoice_url: string | null;
  paypal_status: string | null;
  paypal_error: string | null;
  paypal_checked_at: number | null;
  paypal_paid_cents: number | null;
  nudge_count: number;
  last_nudge_at: number | null;
  created_at: number;
  closed_at: number | null;
}

export interface MessageRow {
  id: number;
  group_id: number;
  role: "user" | "agent" | "system";
  kind: string;
  author_id: number | null;
  content: string;
  data: string | null;
  created_at: number;
}

// ---------- groups ----------

const CURRENT_KEY = "current_group_id";

function setCurrent(id: number) {
  getDb()
    .prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(CURRENT_KEY, String(id));
}

/** The open case: the one last opened or created (remembered across restarts). */
export function currentGroup(): Group {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get(CURRENT_KEY) as { value: string } | undefined;
  const picked = row && (db.prepare("SELECT * FROM groups WHERE id = ?").get(Number(row.value)) as Group | undefined);
  if (picked) return picked;
  const g = db.prepare("SELECT * FROM groups ORDER BY id DESC LIMIT 1").get() as Group | undefined;
  if (g) return g;
  return newGroup();
}

/** Switch the open case. */
export function openGroup(id: number): Group {
  const g = getGroup(id);
  setCurrent(g.id);
  return g;
}

export interface CaseSummary {
  id: number;
  name: string | null;
  members: string[];
  createdAt: number;
  lastAt: number;
  lastMessage: string | null;
  openCents: number;
  spentCents: number;
}

/** Every case that has people in it, most recently active first. */
export function listGroups(): CaseSummary[] {
  const db = getDb();
  const groups = db.prepare("SELECT * FROM groups ORDER BY id DESC").all() as Group[];
  const out: CaseSummary[] = [];
  for (const g of groups) {
    const members = listMembers(g.id).map((m) => m.name);
    if (!members.length) continue;
    const last = db
      .prepare("SELECT content, created_at FROM messages WHERE group_id = ? AND role != 'system' ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(g.id) as { content: string; created_at: number } | undefined;
    const open = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM transfers WHERE group_id = ? AND status = 'open'").get(g.id) as { c: number };
    const spent = db
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM expenses WHERE group_id = ? AND split_type != 'opening'")
      .get(g.id) as { c: number };
    out.push({
      id: g.id,
      name: g.name,
      members,
      createdAt: g.created_at,
      lastAt: last?.created_at ?? g.created_at,
      lastMessage: last?.content ?? null,
      openCents: open.c,
      spentCents: spent.c,
    });
  }
  return out.sort((a, b) => b.lastAt - a.lastAt);
}

/** Remove a case and everything in it (used to replace the previous demo). */
export function deleteGroup(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM expense_shares WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)").run(id);
    for (const t of ["payments", "messages", "expenses", "transfers", "receipts", "members"]) db.prepare(`DELETE FROM ${t} WHERE group_id = ?`).run(id);
    db.prepare("DELETE FROM groups WHERE id = ?").run(id);
  })();
}

export function getGroup(id: number): Group {
  const g = getDb().prepare("SELECT * FROM groups WHERE id = ?").get(id) as Group | undefined;
  if (!g) throw new Error(`Group ${id} not found`);
  return g;
}

export function updateGroup(id: number, patch: { name?: string; currency?: string }): Group {
  const g = getGroup(id);
  getDb()
    .prepare("UPDATE groups SET name = ?, currency = ? WHERE id = ?")
    .run(patch.name ?? g.name, (patch.currency ?? g.currency).toUpperCase(), id);
  emit({ type: "state", groupId: id });
  return getGroup(id);
}

/** Start over: a brand-new empty group becomes current. Older cases stay on file. */
export function newGroup(): Group {
  const id = getDb().prepare("INSERT INTO groups (name, currency, created_at) VALUES (NULL, 'EUR', ?)").run(now())
    .lastInsertRowid as number;
  setCurrent(id);
  return getGroup(id);
}

// ---------- members ----------

export function listMembers(groupId: number): Member[] {
  return getDb().prepare("SELECT id, group_id, name, email, budget_cents FROM members WHERE group_id = ? ORDER BY id").all(groupId) as Member[];
}

export function getMember(id: number): Member {
  const m = getDb().prepare("SELECT id, group_id, name, email, budget_cents FROM members WHERE id = ?").get(id) as Member | undefined;
  if (!m) throw new Error(`Member ${id} not found`);
  return m;
}

export function addMember(groupId: number, name: string, email?: string | null): Member {
  const clean = name.trim();
  const existing = findMember(groupId, clean);
  if (existing) {
    if (email && email !== existing.email) return updateMember(existing.id, { email });
    return existing;
  }
  const id = getDb()
    .prepare("INSERT INTO members (group_id, name, email, created_at) VALUES (?, ?, ?, ?)")
    .run(groupId, clean, email?.trim() || null, now()).lastInsertRowid as number;
  emit({ type: "state", groupId });
  return getMember(id);
}

export function updateMember(id: number, patch: { name?: string; email?: string | null; budgetCents?: number | null }): Member {
  const m = getMember(id);
  getDb()
    .prepare("UPDATE members SET name = ?, email = ?, budget_cents = ? WHERE id = ?")
    .run(
      patch.name?.trim() || m.name,
      patch.email === undefined ? m.email : patch.email,
      patch.budgetCents === undefined ? m.budget_cents : patch.budgetCents,
      id,
    );
  emit({ type: "state", groupId: m.group_id });
  return getMember(id);
}

/** Case-insensitive match on full name, then on unique first-name prefix. */
export function findMember(groupId: number, name: string): Member | undefined {
  const members = listMembers(groupId);
  const q = name.trim().toLowerCase();
  const exact = members.find((m) => m.name.toLowerCase() === q);
  if (exact) return exact;
  const prefix = members.filter((m) => m.name.toLowerCase().startsWith(q) || m.name.toLowerCase().split(" ")[0] === q);
  return prefix.length === 1 ? prefix[0] : undefined;
}

// ---------- expenses ----------

export function addExpense(input: {
  groupId: number;
  payerId: number;
  description: string;
  amountCents: number;
  splitType: string;
  shares: Map<number, number>;
  source?: "text" | "receipt";
  receiptId?: number | null;
  spentAt?: number;
}): Expense {
  const db = getDb();
  const tx = db.transaction(() => {
    const id = db
      .prepare(
        `INSERT INTO expenses (group_id, payer_id, description, amount_cents, split_type, source, receipt_id, spent_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.groupId,
        input.payerId,
        input.description,
        input.amountCents,
        input.splitType,
        input.source ?? "text",
        input.receiptId ?? null,
        input.spentAt ?? now(),
        now(),
      ).lastInsertRowid as number;
    writeShares(id, input.shares);
    return id;
  });
  const id = tx();
  emit({ type: "state", groupId: input.groupId });
  return getExpense(id);
}

function writeShares(expenseId: number, shares: Map<number, number>) {
  const db = getDb();
  db.prepare("DELETE FROM expense_shares WHERE expense_id = ?").run(expenseId);
  const ins = db.prepare("INSERT INTO expense_shares (expense_id, member_id, share_cents) VALUES (?, ?, ?)");
  for (const [memberId, cents] of shares) if (cents > 0) ins.run(expenseId, memberId, cents);
}

export function getExpense(id: number): Expense {
  const db = getDb();
  const e = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as Omit<Expense, "shares"> | undefined;
  if (!e) throw new Error(`Expense ${id} not found`);
  const shares = db
    .prepare("SELECT member_id, share_cents FROM expense_shares WHERE expense_id = ? ORDER BY member_id")
    .all(id) as Expense["shares"];
  return { ...e, shares };
}

export function listExpenses(groupId: number, includeVoided = false): Expense[] {
  const ids = getDb()
    .prepare(`SELECT id FROM expenses WHERE group_id = ? ${includeVoided ? "" : "AND voided_at IS NULL"} ORDER BY spent_at, id`)
    .all(groupId) as { id: number }[];
  return ids.map((r) => getExpense(r.id));
}

export function updateExpense(
  id: number,
  patch: { amountCents?: number; description?: string; payerId?: number; splitType?: string; shares?: Map<number, number> },
): Expense {
  const db = getDb();
  const e = getExpense(id);
  db.transaction(() => {
    db.prepare("UPDATE expenses SET amount_cents = ?, description = ?, payer_id = ?, split_type = ? WHERE id = ?").run(
      patch.amountCents ?? e.amount_cents,
      patch.description ?? e.description,
      patch.payerId ?? e.payer_id,
      patch.splitType ?? e.split_type,
      id,
    );
    if (patch.shares) writeShares(id, patch.shares);
  })();
  emit({ type: "state", groupId: e.group_id });
  return getExpense(id);
}

export function voidExpense(id: number, reason: string): Expense {
  const e = getExpense(id);
  getDb().prepare("UPDATE expenses SET voided_at = ?, void_reason = ? WHERE id = ?").run(now(), reason, id);
  emit({ type: "state", groupId: e.group_id });
  return getExpense(id);
}

// ---------- receipts ----------

export function addReceipt(groupId: number, imagePath: string | null, extracted: unknown): number {
  return getDb()
    .prepare("INSERT INTO receipts (group_id, image_path, extracted, created_at) VALUES (?, ?, ?, ?)")
    .run(groupId, imagePath, JSON.stringify(extracted), now()).lastInsertRowid as number;
}

export function getReceipt(id: number): { id: number; group_id: number; image_path: string | null; extracted: any } | undefined {
  const r = getDb().prepare("SELECT * FROM receipts WHERE id = ?").get(id) as any;
  return r ? { ...r, extracted: JSON.parse(r.extracted) } : undefined;
}

// ---------- payments ----------

export function recordPayment(input: {
  groupId: number;
  fromId: number;
  toId: number;
  amountCents: number;
  method?: "manual" | "paypal";
  transferId?: number | null;
  note?: string | null;
}): Payment {
  const id = getDb()
    .prepare(
      "INSERT INTO payments (group_id, from_id, to_id, amount_cents, method, transfer_id, note, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.groupId,
      input.fromId,
      input.toId,
      input.amountCents,
      input.method ?? "manual",
      input.transferId ?? null,
      input.note ?? null,
      now(),
    ).lastInsertRowid as number;
  emit({ type: "state", groupId: input.groupId });
  return getDb().prepare("SELECT * FROM payments WHERE id = ?").get(id) as Payment;
}

export function listPayments(groupId: number): Payment[] {
  return getDb().prepare("SELECT * FROM payments WHERE group_id = ? ORDER BY paid_at, id").all(groupId) as Payment[];
}

// ---------- balances ----------

export interface Balance {
  memberId: number;
  name: string;
  paidCents: number; // paid for group expenses
  shareCents: number; // their share of expenses
  sentCents: number; // repayments sent
  receivedCents: number; // repayments received
  netCents: number; // + is owed money, - owes money
  /** Personal budget tracking (separate from who owes whom). */
  budgetCents: number | null; // money they brought, if set
  spentCents: number; // their share of real spending (opening balances excluded)
}

export function balances(groupId: number): Balance[] {
  const members = listMembers(groupId);
  const map = new Map<number, Balance>(
    members.map((m) => [
      m.id,
      {
        memberId: m.id,
        name: m.name,
        paidCents: 0,
        shareCents: 0,
        sentCents: 0,
        receivedCents: 0,
        netCents: 0,
        budgetCents: m.budget_cents,
        spentCents: 0,
      },
    ]),
  );
  for (const e of listExpenses(groupId)) {
    map.get(e.payer_id)!.paidCents += e.amount_cents;
    for (const s of e.shares) {
      map.get(s.member_id)!.shareCents += s.share_cents;
      // Opening balances are debts carried in, not spending, so they don't eat into a budget.
      if (e.split_type !== "opening") map.get(s.member_id)!.spentCents += s.share_cents;
    }
  }
  for (const p of listPayments(groupId)) {
    map.get(p.from_id)!.sentCents += p.amount_cents;
    map.get(p.to_id)!.receivedCents += p.amount_cents;
  }
  for (const b of map.values()) b.netCents = b.paidCents - b.shareCents + b.sentCents - b.receivedCents;
  return [...map.values()];
}

export interface BalanceHistory {
  members: string[]; // series order = member order (stable colors per person)
  points: { t: number; label: string; values: number[] }[]; // values: net cents per member, same order
}

/** Each member's running net balance after every expense and repayment, oldest first. */
export function balanceHistory(groupId: number): BalanceHistory {
  const members = listMembers(groupId);
  const name = (id: number) => members.find((m) => m.id === id)?.name ?? `#${id}`;
  const net = new Map(members.map((m) => [m.id, 0]));
  const add = (id: number, cents: number) => net.set(id, (net.get(id) ?? 0) + cents);

  const events = [
    ...listExpenses(groupId).map((e) => ({
      t: e.spent_at,
      label: e.description,
      apply: () => {
        add(e.payer_id, e.amount_cents);
        for (const sh of e.shares) add(sh.member_id, -sh.share_cents);
      },
    })),
    ...listPayments(groupId).map((p) => ({
      t: p.paid_at,
      label: `${name(p.from_id)} paid ${name(p.to_id)}`,
      apply: () => {
        add(p.from_id, p.amount_cents);
        add(p.to_id, -p.amount_cents);
      },
    })),
  ].sort((a, b) => a.t - b.t);

  const snap = () => members.map((m) => net.get(m.id) ?? 0);
  const points = [{ t: events[0]?.t ?? now(), label: "Start", values: snap() }];
  for (const ev of events) {
    ev.apply();
    points.push({ t: ev.t, label: ev.label, values: snap() });
  }
  return { members: members.map((m) => m.name), points };
}

export interface DebtSummary {
  debtors: { member: string; owesCents: number; to: { member: string; amountCents: number }[] }[]; // biggest first
  creditors: { member: string; owedCents: number }[]; // biggest first
}

/** Who owes the most, and to whom (via the same minimal-transfer plan settle-up uses). */
export function debtSummary(groupId: number): DebtSummary {
  const bal = balances(groupId);
  const name = (id: number) => bal.find((b) => b.memberId === id)?.name ?? `#${id}`;
  const plan = suggestedTransfers(groupId);
  return {
    debtors: bal
      .filter((b) => b.netCents < 0)
      .sort((a, b) => a.netCents - b.netCents || a.memberId - b.memberId)
      .map((b) => ({
        member: b.name,
        owesCents: -b.netCents,
        to: plan
          .filter((t) => t.from === b.memberId)
          .sort((x, y) => y.amountCents - x.amountCents)
          .map((t) => ({ member: name(t.to), amountCents: t.amountCents })),
      })),
    creditors: bal
      .filter((b) => b.netCents > 0)
      .sort((a, b) => b.netCents - a.netCents || a.memberId - b.memberId)
      .map((b) => ({ member: b.name, owedCents: b.netCents })),
  };
}

export function suggestedTransfers(groupId: number): Transfer[] {
  return settle(new Map(balances(groupId).map((b) => [b.memberId, b.netCents])));
}

// ---------- transfers ----------

export function createTransfer(groupId: number, t: Transfer): TransferRow {
  const id = getDb()
    .prepare("INSERT INTO transfers (group_id, from_id, to_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(groupId, t.from, t.to, t.amountCents, now()).lastInsertRowid as number;
  return getTransfer(id);
}

export function getTransfer(id: number): TransferRow {
  return getDb().prepare("SELECT * FROM transfers WHERE id = ?").get(id) as TransferRow;
}

export function listTransfers(groupId: number, status?: TransferRow["status"]): TransferRow[] {
  return (
    status
      ? getDb().prepare("SELECT * FROM transfers WHERE group_id = ? AND status = ? ORDER BY id").all(groupId, status)
      : getDb().prepare("SELECT * FROM transfers WHERE group_id = ? ORDER BY id").all(groupId)
  ) as TransferRow[];
}

export function openTransfersAll(): TransferRow[] {
  return getDb().prepare("SELECT * FROM transfers WHERE status = 'open' ORDER BY id").all() as TransferRow[];
}

export function updateTransfer(id: number, patch: Partial<Omit<TransferRow, "id" | "group_id">>): TransferRow {
  const keys = Object.keys(patch);
  if (keys.length) {
    getDb()
      .prepare(`UPDATE transfers SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`)
      .run({ ...patch, id });
  }
  const t = getTransfer(id);
  emit({ type: "state", groupId: t.group_id });
  return t;
}

/** Mark a transfer paid and book the matching payment so the ledger stays consistent. */
export function markTransferPaid(id: number, method: "manual" | "paypal", note?: string): TransferRow {
  const t = getTransfer(id);
  if (t.status !== "open") return t;
  recordPayment({ groupId: t.group_id, fromId: t.from_id, toId: t.to_id, amountCents: t.amount_cents, method, transferId: id, note });
  return updateTransfer(id, { status: "paid", closed_at: now() });
}

/** PayPal says a payment was refunded: undo the booked payment and reopen the request. */
export function reopenTransfer(id: number): TransferRow {
  const t = getTransfer(id);
  if (t.status !== "paid") return t;
  getDb().prepare("DELETE FROM payments WHERE transfer_id = ?").run(id);
  return updateTransfer(id, { status: "open", closed_at: null });
}

/** Requests closed through PayPal recently: still worth watching for a refund. */
export function recentlyPaidPaypalTransfers(sinceMs: number): TransferRow[] {
  return getDb()
    .prepare("SELECT * FROM transfers WHERE status = 'paid' AND paypal_invoice_id IS NOT NULL AND closed_at >= ? ORDER BY id")
    .all(sinceMs) as TransferRow[];
}

// ---------- messages ----------

export interface ChatMessage {
  id: number;
  role: MessageRow["role"];
  kind: string;
  authorId: number | null;
  authorName: string | null;
  content: string;
  data: any;
  createdAt: number;
}

export function toChatMessage(row: MessageRow): ChatMessage {
  let authorName: string | null = null;
  if (row.author_id) {
    try {
      authorName = getMember(row.author_id).name;
    } catch {
      authorName = null;
    }
  }
  return {
    id: row.id,
    role: row.role,
    kind: row.kind,
    authorId: row.author_id,
    authorName,
    content: row.content,
    data: row.data ? JSON.parse(row.data) : null,
    createdAt: row.created_at,
  };
}

export function addMessage(input: {
  groupId: number;
  role: MessageRow["role"];
  kind?: string;
  authorId?: number | null;
  content: string;
  data?: unknown;
  createdAt?: number;
}): ChatMessage {
  const id = getDb()
    .prepare("INSERT INTO messages (group_id, role, kind, author_id, content, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      input.groupId,
      input.role,
      input.kind ?? "text",
      input.authorId ?? null,
      input.content,
      input.data === undefined ? null : JSON.stringify(input.data),
      input.createdAt ?? now(),
    ).lastInsertRowid as number;
  const msg = toChatMessage(getDb().prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow);
  emit({ type: "message", groupId: input.groupId, message: msg });
  return msg;
}

/** Merge into a message's data and re-broadcast it (clients upsert by id). */
export function updateMessageData(id: number, patch: Record<string, unknown>): ChatMessage {
  const row = getDb().prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow;
  const data = { ...(row.data ? JSON.parse(row.data) : {}), ...patch };
  getDb().prepare("UPDATE messages SET data = ? WHERE id = ?").run(JSON.stringify(data), id);
  const msg = toChatMessage({ ...row, data: JSON.stringify(data) });
  emit({ type: "message", groupId: row.group_id, message: msg });
  return msg;
}

export function listMessages(groupId: number, limit = 500): ChatMessage[] {
  const rows = getDb()
    .prepare("SELECT * FROM (SELECT * FROM messages WHERE group_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id")
    .all(groupId, limit) as MessageRow[];
  return rows.map(toChatMessage);
}

// ---------- snapshot (used by the agent and the UI) ----------

export function snapshot(groupId: number) {
  const group = getGroup(groupId);
  const members = listMembers(groupId);
  const name = (id: number) => members.find((m) => m.id === id)?.name ?? `#${id}`;
  const fmt = (c: number) => formatMoney(c, group.currency);
  return {
    group: { id: group.id, name: group.name, currency: group.currency },
    members: members.map((m) => ({ id: m.id, name: m.name, email: m.email })),
    expenses: listExpenses(groupId, true).map((e) => ({
      id: e.id,
      description: e.description,
      amount: fmt(e.amount_cents),
      paidBy: name(e.payer_id),
      split: e.split_type,
      source: e.source,
      date: new Date(e.spent_at).toISOString().slice(0, 10),
      shares: e.shares.map((s) => ({ member: name(s.member_id), share: fmt(s.share_cents) })),
      ...(e.voided_at ? { voided: true, voidReason: e.void_reason } : {}),
    })),
    payments: listPayments(groupId).map((p) => ({
      id: p.id,
      from: name(p.from_id),
      to: name(p.to_id),
      amount: fmt(p.amount_cents),
      method: p.method,
      note: p.note,
      date: new Date(p.paid_at).toISOString().slice(0, 10),
    })),
    balances: balances(groupId).map((b) => ({
      member: b.name,
      paid: fmt(b.paidCents),
      share: fmt(b.shareCents),
      repaymentsSent: fmt(b.sentCents),
      repaymentsReceived: fmt(b.receivedCents),
      net: fmt(b.netCents),
      netCents: b.netCents,
      position: b.netCents > 0 ? "is owed" : b.netCents < 0 ? "owes" : "even",
      // Personal trip budget (separate from debts): what they brought, their spending, what's left.
      ...(b.budgetCents != null
        ? { budget: fmt(b.budgetCents), spentOfBudget: fmt(b.spentCents), budgetLeft: fmt(b.budgetCents - b.spentCents) }
        : {}),
    })),
    settleUpRequests: listTransfers(groupId)
      .filter((t) => t.status !== "cancelled")
      .map((t) => ({
        id: t.id,
        from: name(t.from_id),
        to: name(t.to_id),
        amount: fmt(t.amount_cents),
        status: t.status,
        paypalStatus: t.paypal_status,
        invoiceUrl: t.paypal_invoice_url,
        nudgesSent: t.nudge_count,
        createdDate: new Date(t.created_at).toISOString().slice(0, 10),
      })),
  };
}
