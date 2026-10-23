import { useContext } from "react";
import type { Card, ExpenseView, Transfer } from "../types";
import { BalancesContext } from "./balances";
import { MeContext } from "./me";
import { BalanceChart, seriesColor } from "./BalanceChart";

// ---------- primitives ----------

const TONES = ["#5b6cff", "#d9663b", "#2f9e8f", "#a259d9", "#c98a1a", "#3f8fd9", "#d94f86"];
export function toneFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** Subject avatar: soft tinted rounded square with the initial. */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const tone = toneFor(name);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[30%] font-mono font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.44,
        color: tone,
        background: `color-mix(in srgb, ${tone} 15%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 25%, transparent)`,
      }}
      aria-hidden
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The app icon: the Collector distilled to a fedora and a handlebar mustache, on Collector red.
 * Used for branding (tab icon, loading, Home, header). The cube character below stays as
 * The Collector's avatar in the chat.
 */
export function AppIcon({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`shrink-0 ${size <= 32 ? "drop-shadow-[0_2px_4px_rgba(229,72,77,0.25)]" : "drop-shadow-[0_6px_14px_rgba(229,72,77,0.28)]"} ${className}`}
      role="img"
      aria-label="The Debt Collector"
    >
      <rect width="64" height="64" rx="16" fill="#E5484D" />
      <path d="M17 30 C17 19 20 11.5 25 10.5 C29 9.7 30.5 13 32 13 C33.5 13 35 9.7 39 10.5 C44 11.5 47 19 47 30 Z" fill="#111113" />
      <rect x="17" y="24" width="30" height="5.5" fill="#F7F5F0" />
      <path d="M6 31.5 C14 26.5 50 26.5 58 31.5 C59.6 33 57.5 34.6 54 34.2 C40 32.6 24 32.6 10 34.2 C6.5 34.6 4.4 33 6 31.5 Z" fill="#111113" />
      <path
        d="M32 44 C28 39.5 20 40 17 45.5 C15.8 47.8 13 47.8 11.8 46 C12.8 52.5 21.5 53.5 26.5 50.3 C29 48.8 31.2 47.6 32 47.6 C32.8 47.6 35 48.8 37.5 50.3 C42.5 53.5 51.2 52.5 52.2 46 C51 47.8 48.2 47.8 47 45.5 C44 40 36 39.5 32 44 Z"
        fill="#111113"
      />
    </svg>
  );
}

export type StampTone = "red" | "amber" | "green" | "ink" | "muted";
const BADGE_COLOR: Record<StampTone, string> = {
  red: "text-red-text",
  amber: "text-amber-text",
  green: "text-green-text",
  ink: "text-ink-soft",
  muted: "text-muted",
};

/** Status badge: a pill with a faint stamped tilt. Name kept for call sites. */
export function Stamp({
  children,
  tone,
  size = "sm",
  animate = false,
  dot = true,
  className = "",
}: {
  children: React.ReactNode;
  tone: StampTone;
  size?: "xs" | "sm" | "lg";
  animate?: boolean;
  dot?: boolean;
  className?: string;
}) {
  const sz = size === "lg" ? "px-5 py-2.5 text-[22px]" : size === "sm" ? "px-2.5 py-[5px] text-[10.5px]" : "px-2 py-[4px] text-[9.5px]";
  return <span className={`badge ${sz} ${BADGE_COLOR[tone]} ${dot ? "" : "no-dot"} ${animate ? "stamp-press" : ""} ${className}`}>{children}</span>;
}

/** A card in the file: label row + body. */
function Panel({
  label,
  right,
  children,
  muted = false,
  accent = false,
  className = "",
}: {
  label: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  muted?: boolean;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative mt-2 rounded-[18px] border border-line bg-surface shadow-md ${muted ? "opacity-60" : ""} ${className}`}>
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3.5">
        <span className={`label flex min-w-0 items-center gap-1.5 truncate ${accent ? "text-red-text" : "text-muted"}`}>{label}</span>
        {right}
      </div>
      <div className="px-4 pb-4 pt-1.5">{children}</div>
    </div>
  );
}

export function SettledTick() {
  return (
    <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-green text-white shadow-sm" title="Settled" aria-label="Settled">
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2.5 6.3 5 8.6 9.6 3.6" />
      </svg>
    </span>
  );
}

/** One person's share of an expense, with whether they have settled their dues. */
function ShareRow({ name, amount, settled }: { name: string; amount: string; settled: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-[7px] text-[14px]">
      <span className="min-w-0 truncate text-ink-soft">{name}</span>
      <span className="flex min-w-[86px] justify-end">
        {settled ? (
          <SettledTick />
        ) : (
          <Stamp tone="red" size="xs">
            Unsettled
          </Stamp>
        )}
      </span>
      <span className="tabular min-w-[60px] text-right font-mono font-medium">{amount}</span>
    </div>
  );
}

function Field({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[5px] text-[13px]">
      <span className="label !text-[9.5px] text-muted">{k}</span>
      <span className={`min-w-0 truncate ${mono ? "tabular font-mono font-semibold" : ""}`}>{v}</span>
    </div>
  );
}

// ---------- expense / evidence ----------

function ExpenseCard({ label, e }: { label: string; e: ExpenseView }) {
  const evidence = e.source === "receipt";
  const nets = useContext(BalancesContext);
  // Settled = paid this expense themselves, or owes nobody overall (balance >= 0).
  const isSettled = (member: string) => member === e.paidBy || (nets.get(member) ?? 0) >= 0;
  const splitLabel = e.split === "even" ? "Split evenly" : e.split === "custom" ? "Custom split" : e.split === "opening" ? "Opening balance" : "Weighted split";
  return (
    <Panel
      muted={e.voided}
      accent={evidence}
      label={
        <>
          {evidence ? "Evidence · " : ""}
          {label}
          <span className="text-muted/70">· #{String(e.id).padStart(3, "0")}</span>
        </>
      }
      right={e.voided ? <Stamp tone="red" size="xs">Void</Stamp> : undefined}
    >
      <div className="flex items-start gap-3.5">
        {e.receipt?.imageUrl && (
          <a href={e.receipt.imageUrl} target="_blank" rel="noreferrer" className="press shrink-0">
            <img src={e.receipt.imageUrl} alt="Receipt" className="h-[72px] w-[56px] rounded-xl object-cover shadow-sm ring-1 ring-line" />
          </a>
        )}
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[16px] font-semibold tracking-[-0.01em] ${e.voided ? "line-through" : ""}`}>{e.description}</div>
          <div className={`tabular mt-0.5 font-mono text-[22px] font-semibold tracking-[-0.02em] ${e.voided ? "line-through" : ""}`}>{e.amount}</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            Paid by <span className="text-ink-soft">{e.paidBy}</span>
            {evidence && e.receipt?.merchant ? <> · {e.receipt.merchant}</> : null}
          </div>
        </div>
      </div>
      {!e.voided && (
        <div className="mt-3.5 rounded-xl bg-surface-2 px-3 py-1.5">
          <div className="label pb-0.5 pt-1.5 !text-[9.5px] text-muted">{evidence ? "Proposed split" : splitLabel}</div>
          <div className="divide-y divide-line">
            {e.shares.map((s) => (
              <ShareRow key={s.member} name={s.member} amount={s.share} settled={isSettled(s.member)} />
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------- settlement order ----------

export function PayPalButton({ url, compact = false }: { url: string; compact?: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`press inline-flex items-center gap-1.5 rounded-full bg-ink font-mono font-medium uppercase tracking-[0.06em] text-own-fg shadow-sm hover:opacity-90 ${compact ? "px-3 py-[7px] text-[10.5px]" : "px-4 py-2 text-[11px]"}`}
    >
      Open PayPal request <span aria-hidden>↗</span>
    </a>
  );
}

function TransferLine({ t, n, fresh }: { t: Transfer; n: number; fresh: boolean }) {
  const me = useContext(MeContext);
  const paid = t.status === "paid";
  const cancelled = t.status === "cancelled";
  return (
    <div className={`py-3.5 first:pt-1 last:pb-0.5 ${cancelled ? "opacity-45" : ""}`}>
      <div className="flex items-center gap-2.5">
        <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-[10.5px] font-medium text-muted">
          {n}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14.5px]">
          <span className="font-medium">{t.from}</span>
          <span className="mx-1.5 text-muted">→</span>
          <span className="font-medium">{t.to}</span>
        </span>
        <span className={`tabular font-mono text-[15px] font-semibold ${paid ? "text-green-text" : ""}`}>{t.amount}</span>
      </div>
      <div className="mt-2.5 flex min-h-[30px] flex-wrap items-center justify-between gap-2 pl-[34px]">
        <div className="flex items-center gap-2">
          {paid ? (
            <Stamp tone="green" animate={fresh}>
              Paid
            </Stamp>
          ) : cancelled ? (
            <Stamp tone="muted" size="xs">Superseded</Stamp>
          ) : t.invoiceUrl ? (
            <Stamp tone="amber" size="xs">Request sent</Stamp>
          ) : (
            <Stamp tone="red" size="xs">Not sent</Stamp>
          )}
        </div>
        {/* only the person who owes gets the pay button */}
        {t.invoiceUrl && t.status === "open" && me === t.from && <PayPalButton url={t.invoiceUrl} compact />}
      </div>
      {t.error && <div className="mt-2 pl-[34px] text-[12.5px] text-red-text">{t.error}</div>}
    </div>
  );
}

function SettlementOrder({ transfers, live, fresh, note }: { transfers: Transfer[]; live: Map<number, Transfer>; fresh: Set<number>; note?: string }) {
  const rows = transfers.map((t) => live.get(t.id) ?? { ...t, status: "cancelled" as const });
  const allPaid = rows.length > 0 && rows.every((t) => t.status === "paid");
  const settledFresh = allPaid && rows.some((t) => fresh.has(t.id));
  return (
    <Panel
      label={`Settlement order · ${rows.length}`}
      right={<span className="label shrink-0 whitespace-nowrap !text-[9.5px] text-muted">PayPal · Sandbox</span>}
      className="overflow-hidden"
    >
      {rows.length === 0 ? (
        <div className="text-sm text-muted">All accounts balanced. No transfers required.</div>
      ) : (
        <div className="divide-y divide-line">
          {rows.map((t, i) => (
            <TransferLine key={t.id} t={t} n={i + 1} fresh={fresh.has(t.id)} />
          ))}
        </div>
      )}
      {note && <div className="mt-3 text-[12px] text-muted">{note}</div>}
      {allPaid && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            style={{ ["--badge-rot" as string]: "-7deg" }}
            className={`badge no-dot px-5 py-2.5 text-[22px] !font-bold text-green-text shadow-md backdrop-blur-[2px] [background:color-mix(in_srgb,var(--surface)_82%,var(--green)_18%)] [box-shadow:inset_0_0_0_2px_var(--green),var(--shadow-md)] ${settledFresh ? "stamp-press" : ""}`}
          >
            ✓ Settled
          </span>
        </div>
      )}
    </Panel>
  );
}

// ---------- balance sheet ----------

type BalancesCard = Extract<Card, { type: "balances" }>;

function BalanceSheet({ card }: { card: BalancesCard }) {
  const { balances, history } = card;
  const valueCls = (c: number) => (c > 0 ? "text-green-text" : c < 0 ? "text-red-text" : "text-muted");

  // Balance over time: smooth line chart + legend with each person's current balance.
  if (history && history.points.length >= 2) {
    const order = new Map(history.members.map((m, i) => [m, i]));
    return (
      <Panel label="Balances over time" right={<span className="label shrink-0 !text-[9.5px] text-muted">{card.currency}</span>}>
        <div className="pt-2">
          <BalanceChart history={history} currency={card.currency} />
        </div>
        <div className="mt-3 divide-y divide-line rounded-xl bg-surface-2 px-3 py-1">
          {[...balances]
            .sort((a, b) => b.netCents - a.netCents)
            .map((b) => (
              <div key={b.member} className="flex items-center gap-2.5 py-[7px] text-[13.5px]">
                <span className="h-[3px] w-3.5 shrink-0 rounded-full" style={{ background: seriesColor(order.get(b.member) ?? 0) }} />
                <span className="min-w-0 flex-1 truncate text-ink-soft">{b.member}</span>
                <span className={`tabular font-mono font-semibold ${valueCls(b.netCents)}`}>
                  {b.netCents > 0 ? "+" : ""}
                  {b.net}
                </span>
              </div>
            ))}
        </div>
        <div className="label mt-3 !text-[9.5px] text-muted">Above zero owed · Below zero owes · Hover for detail</div>
      </Panel>
    );
  }

  const max = Math.max(1, ...balances.map((b) => Math.abs(b.netCents)));
  return (
    <Panel label="Balance sheet">
      <div className="space-y-2.5 pt-1">
        {[...balances].sort((a, b) => b.netCents - a.netCents).map((b) => (
          <div key={b.member} className="grid grid-cols-[minmax(52px,72px)_1fr_84px] items-center gap-3 text-[13.5px]">
            <span className="truncate font-medium">{b.member}</span>
            <div className="relative h-1.5 rounded-full bg-surface-2">
              <div className="absolute inset-y-[-3px] left-1/2 w-px bg-line" />
              <div
                className={`absolute inset-y-0 rounded-full ${b.netCents >= 0 ? "left-1/2 bg-green" : "right-1/2 bg-red"}`}
                style={{ width: `${(Math.abs(b.netCents) / max) * 50}%` }}
              />
            </div>
            <span className={`tabular text-right font-mono font-semibold ${valueCls(b.netCents)}`}>
              {b.netCents > 0 ? "+" : ""}
              {b.net}
            </span>
          </div>
        ))}
      </div>
      <div className="label mt-3.5 !text-[9.5px] text-muted">Green owed · Red owes</div>
    </Panel>
  );
}

// ---------- who owes whom ----------

type DebtsCard = Extract<Card, { type: "debts" }>;

function PaysTo({ to }: { to: DebtsCard["debtors"][number]["to"] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {to.map((t) => (
        <span key={t.member} className="inline-flex items-center gap-1.5 rounded-full bg-surface py-[3px] pl-1 pr-2.5 text-[12.5px] shadow-sm ring-1 ring-line">
          <span className="pl-1 text-muted">→</span>
          <Avatar name={t.member} size={18} />
          <span className="font-medium">{t.member}</span>
          <span className="tabular font-mono font-semibold">{t.amount}</span>
        </span>
      ))}
    </div>
  );
}

function DebtRanking({ card }: { card: DebtsCard }) {
  const [top, ...rest] = card.debtors;
  const max = top?.owesCents ?? 1;
  return (
    <Panel
      label="Who owes whom"
      right={<span className="label shrink-0 !text-[9.5px] text-muted">{card.debtors.length} owe</span>}
    >
      {!top ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-green-soft px-3 py-3 text-[14px] text-green-text">
          <SettledTick /> Everyone is square. Nobody owes anything.
        </div>
      ) : (
        <>
          {/* the headline: biggest debtor and who they pay */}
          <div className="mt-1 rounded-2xl border border-red/25 bg-red-soft px-3.5 py-3.5">
            <div className="flex items-center gap-3">
              <Avatar name={top.member} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-semibold">{top.member}</div>
                <div className="text-[12px] text-muted">owes the most</div>
              </div>
              <Stamp tone="red" size="xs">
                Most wanted
              </Stamp>
            </div>
            <div className="tabular mt-2.5 font-mono text-[26px] font-semibold tracking-[-0.02em] text-red-text">{top.owes}</div>
            {top.to.length > 0 && (
              <div className="mt-2">
                <PaysTo to={top.to} />
              </div>
            )}
          </div>

          {/* everyone else who owes, ranked */}
          {rest.length > 0 && (
            <div className="mt-3 divide-y divide-line">
              {rest.map((d, i) => (
                <div key={d.member} className="py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-[10.5px] font-medium text-muted">
                      {i + 2}
                    </span>
                    <Avatar name={d.member} size={24} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{d.member}</span>
                    <span className="tabular font-mono text-[14px] font-semibold text-red-text">{d.owes}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 pl-[34px]">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-red/70" style={{ width: `${Math.max(4, (d.owesCents / max) * 100)}%` }} />
                    </div>
                  </div>
                  {d.to.length > 0 && (
                    <div className="mt-1.5 truncate pl-[34px] text-[12px] text-muted">
                      pays{" "}
                      {d.to.map((t, k) => (
                        <span key={t.member}>
                          {k > 0 && " · "}
                          <span className="text-ink-soft">{t.member}</span> <span className="tabular font-mono font-semibold text-ink">{t.amount}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* who is owed */}
      {card.creditors.length > 0 && (
        <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5">
          <div className="label mb-1.5 !text-[9.5px] text-muted">Owed</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {card.creditors.map((c) => (
              <span key={c.member} className="inline-flex items-center gap-1.5 text-[13px]">
                <Avatar name={c.member} size={20} />
                <span className="text-ink-soft">{c.member}</span>
                <span className="tabular font-mono font-semibold text-green-text">+{c.owed}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------- dispatcher ----------

export function CardView({ card, liveTransfers, fresh }: { card: Card; liveTransfers: Map<number, Transfer>; fresh: Set<number> }) {
  switch (card.type) {
    case "members":
      return (
        <Panel label={card.group ? `Subjects on file · ${card.group}` : "Subjects on file"}>
          <div className="divide-y divide-line">
            {card.members.map((m) => (
              <div key={m.name} className="flex items-center gap-3 py-2 text-sm">
                <Avatar name={m.name} size={26} />
                <span className="font-medium">{m.name}</span>
                <span className="ml-auto max-w-[55%] truncate font-mono text-[11.5px] text-muted">{m.email ?? "no email on file"}</span>
              </div>
            ))}
          </div>
        </Panel>
      );
    case "expense":
      return <ExpenseCard label={card.label} e={card.expense} />;
    case "transfers":
      return <SettlementOrder transfers={card.transfers} live={liveTransfers} fresh={fresh} note={card.note} />;
    case "balances":
      return <BalanceSheet card={card} />;
    case "debts":
      return <DebtRanking card={card} />;
    case "payment":
      return (
        <div className="mt-2 flex max-w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-2.5 shadow-sm">
          <Stamp tone="green" size="xs">Paid</Stamp>
          <span className="min-w-0 truncate text-[14px]">
            <span className="font-medium">{card.from}</span>
            <span className="mx-1.5 text-muted">→</span>
            <span className="font-medium">{card.to}</span>
          </span>
          <span className="tabular ml-auto font-mono text-[14px] font-semibold">{card.amount}</span>
          <span className="hidden truncate text-[12px] text-muted min-[400px]:inline">{card.method === "paypal" ? "via PayPal" : card.note || "off-PayPal"}</span>
        </div>
      );
  }
}
