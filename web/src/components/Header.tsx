import { useEffect, useRef, useState } from "react";
import type { AppState, ChatMessage, CheckResult } from "../types";
import { AppIcon, Avatar, Stamp, type StampTone } from "./Cards";
import { caseNumber } from "./CaseList";

export type Theme = "light" | "dark";

function useOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return ref;
}

function Popover({ open, onClose, children, align = "right" }: { open: boolean; onClose: () => void; children: React.ReactNode; align?: "left" | "right" }) {
  const ref = useOutside(onClose);
  if (!open) return null;
  return (
    <div
      ref={ref}
      style={{ transformOrigin: align === "right" ? "top right" : "top left" }}
      className={`animate-pop absolute top-full z-30 mt-2 min-w-60 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
    >
      {children}
    </div>
  );
}

const item = "press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] hover:bg-surface-2 disabled:opacity-50";
const iconBtn = "press flex h-9 items-center justify-center rounded-full border border-line bg-surface text-ink-soft shadow-sm hover:text-ink";

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);

type SubjectStatus = { label: string; tone: StampTone };

/** Derived purely from what the UI already has: balances, open requests, and notices sent. */
function subjectStatus(state: AppState, messages: ChatMessage[], name: string, netCents: number): SubjectStatus {
  const overdue = new Set(messages.filter((m) => m.kind === "nudge" && (m.data?.level ?? 1) >= 2).map((m) => m.data?.transferId));
  const open = state.transfers.filter((t) => t.status === "open" && t.from === name);
  if (open.some((t) => overdue.has(t.id))) return { label: "Overdue", tone: "red" };
  if (open.length || netCents < 0) return { label: "Outstanding", tone: "amber" };
  if (netCents > 0) return { label: "Creditor", tone: "ink" };
  return { label: "Settled", tone: "green" };
}

/** What's left of a person's trip budget after their share of expenses: amber under 20%, red once it's gone. */
function BudgetBar({ budget, spent, currency }: { budget: number; spent: number; currency: string }) {
  const left = budget - spent;
  const frac = Math.max(0, Math.min(1, left / budget));
  const tone = left <= 0 ? "red" : frac < 0.2 ? "amber" : "green";
  return (
    <div className="col-span-3 -mt-1 flex items-center gap-2.5 pl-[36px]">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.max(0, left)} aria-label="Budget left">
        <div className={`h-full rounded-full transition-[width] duration-500 ${tone === "red" ? "bg-red" : tone === "amber" ? "bg-amber" : "bg-green"}`} style={{ width: `${frac * 100}%` }} />
      </div>
      <span className={`tabular whitespace-nowrap font-mono text-[11.5px] ${tone === "red" ? "text-red-text" : tone === "amber" ? "text-amber-text" : "text-muted"}`}>
        {left < 0 ? `${money(-left, currency)} over ${money(budget, currency)}` : `${money(left, currency)} of ${money(budget, currency)} left`}
      </span>
    </div>
  );
}

/** Live integration status: real calls, with the actual error when one fails. */
function SelfCheckPanel({ state, onRun }: { state: AppState; onRun: () => void }) {
  const sc = state.selfcheck;
  const running = sc.status === "running";
  const row = (name: string, r: CheckResult | null) => (
    <div className="py-1.5">
      <div className="flex items-center gap-2 text-[13px]">
        <span
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
            running ? "bg-muted" : !r ? "bg-line" : r.ok ? "bg-green" : "bg-red"
          }`}
          aria-label={running ? "checking" : !r ? "not run" : r.ok ? "passed" : "failed"}
        >
          {running ? "…" : !r ? "" : r.ok ? "✓" : "✗"}
        </span>
        <span className="font-medium">{name}</span>
        {r?.ms != null && !running && <span className="tabular ml-auto font-mono text-[10px] text-muted">{r.ms} ms</span>}
      </div>
      {r && !running && (
        <div className={`mt-1 break-words pl-[26px] text-[11.5px] leading-snug ${r.ok ? "text-muted" : "text-red-text"}`}>{r.detail}</div>
      )}
    </div>
  );
  return (
    <div className="max-w-[300px] px-3 pb-1.5 pt-1">
      <div className="label pb-1 text-muted">Integration self-check</div>
      {row("Claude", sc.claude)}
      {row("PayPal sandbox", sc.paypal)}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-muted">
          {running ? "Running live calls…" : sc.at ? `Checked ${new Date(sc.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Not run yet"}
        </span>
        <button
          onClick={onRun}
          disabled={running}
          className="press shrink-0 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-own-fg disabled:opacity-50"
        >
          {running ? "Checking…" : "Run self-check"}
        </button>
      </div>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = { Overdue: "bg-red", Outstanding: "bg-amber", Settled: "bg-green" };

export function Header({
  state,
  messages,
  speakerId,
  onSpeaker,
  onDemo,
  onReset,
  onFastForward,
  onResetClock,
  onCheckPayments,
  theme,
  onTheme,
  onSelfCheck,
  onHome,
  onOpenCase,
  busy,
}: {
  state: AppState;
  messages: ChatMessage[];
  speakerId: number | null;
  onSpeaker: (id: number) => void;
  onDemo: () => void;
  onReset: () => void;
  onFastForward: (days: number) => void;
  onResetClock: () => void;
  onCheckPayments: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onSelfCheck: () => void;
  onHome: () => void;
  onOpenCase: (id: number) => void;
  busy: boolean;
}) {
  const [who, setWho] = useState(false);
  const [menu, setMenu] = useState(false);
  const [clock, setClock] = useState(false);
  const [subjectsOpen, setSubjectsOpen] = useState(false);
  const speaker = state.members.find((m) => m.id === speakerId);
  const outstanding = state.transfers.filter((t) => t.status === "open").reduce((s, t) => s + t.amountCents, 0);
  const caseNo = caseNumber(state.group.id);
  const otherCases = state.cases.filter((c) => c.id !== state.group.id).slice(0, 5);

  const subjects = state.balances.map((b) => ({ ...b, status: subjectStatus(state, messages, b.name, b.netCents) }));
  const counts = subjects.reduce<Record<string, number>>((acc, s) => ((acc[s.status.label] = (acc[s.status.label] ?? 0) + 1), acc), {});
  const summary = (["Overdue", "Outstanding", "Settled"] as const).filter((k) => counts[k]);

  return (
    <header className="relative z-20 border-b border-line bg-bg/85 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <AppIcon size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="label !text-[10px] text-red-text">Case #{caseNo}</span>
            <span className="label rounded-full px-1.5 py-[2px] !text-[8.5px] text-muted ring-1 ring-line">Confidential</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[17px] font-semibold leading-tight tracking-[-0.01em]">{state.group.name ?? "Unassigned case"}</div>
          <div className="mt-0.5 truncate text-[12px] text-muted">
            {state.members.length ? `${state.members.length} subjects` : "No subjects on file"}
            {outstanding > 0 && (
              <>
                {" · "}
                <span className="tabular font-mono font-medium text-amber-text">{money(outstanding, state.group.currency)} due</span>
              </>
            )}
          </div>
        </div>

        {/* Demo clock */}
        <div className="relative">
          <button
            onClick={() => setClock((v) => !v)}
            className={`${iconBtn} gap-1.5 px-3 font-mono text-[11px] font-medium uppercase ${state.clock.offsetDays ? "!border-amber/40 !bg-amber-soft !text-amber-text" : ""}`}
            title="Demo clock"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {state.clock.offsetDays ? `+${state.clock.offsetDays}d` : "Now"}
          </button>
          <Popover open={clock} onClose={() => setClock(false)}>
            <div className="label px-3 pb-1 pt-2 text-muted">Demo clock</div>
            <div className="px-3 pb-2 text-[12.5px] leading-relaxed text-muted">
              {new Date(state.clock.now).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}. Move time forward to watch the
              notices escalate.
            </div>
            {[1, 2].map((d) => (
              <button key={d} className={item} disabled={busy} onClick={() => onFastForward(d)}>
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 font-mono text-[11px]">+{d}</span>
                Forward {d} day{d > 1 ? "s" : ""}
              </button>
            ))}
            <button className={item} disabled={busy} onClick={() => (onResetClock(), setClock(false))}>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 font-mono text-[12px]">↺</span>
              Back to real time
            </button>
            {state.config.paypal && (
              <>
                <div className="mx-2 my-1.5 h-px bg-line" />
                <button className={item} disabled={busy} onClick={() => (onCheckPayments(), setClock(false))}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 font-mono text-[12px]">⟳</span>
                  Check all payments now
                </button>
              </>
            )}
          </Popover>
        </div>

        {/* Menu */}
        <div className="relative">
          <button onClick={() => setMenu((v) => !v)} className={`${iconBtn} w-9`} aria-label="Menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
          <Popover open={menu} onClose={() => setMenu(false)}>
            <button className={item} onClick={() => (onHome(), setMenu(false))}>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 text-[12px]">⌂</span> Home
            </button>
            <button className={item} disabled={busy} onClick={() => (onDemo(), setMenu(false))}>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 text-[12px]">✦</span> Load demo group
            </button>
            <button
              className={item}
              disabled={busy}
              onClick={() => {
                onReset();
                setMenu(false);
              }}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 text-[13px]">+</span> New group
            </button>
            {otherCases.length > 0 && (
              <>
                <div className="mx-2 my-1.5 h-px bg-line" />
                <div className="label px-3 pb-1.5 pt-1 text-muted">Switch case</div>
                {otherCases.map((c) => (
                  <button key={c.id} className={item} disabled={busy} onClick={() => (onOpenCase(c.id), setMenu(false))}>
                    <Avatar name={c.members[0] ?? "?"} size={24} />
                    <span className="min-w-0 flex-1 truncate">{c.name ?? "Untitled case"}</span>
                    <span className="label shrink-0 !text-[8.5px] text-muted">#{caseNumber(c.id)}</span>
                  </button>
                ))}
              </>
            )}
            <div className="mx-2 my-1.5 h-px bg-line" />
            <div className="label px-3 pb-1.5 pt-1 text-muted">Theme</div>
            <div className="mx-2 mb-1.5 flex rounded-xl bg-surface-2 p-1">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => onTheme(t)}
                  className={`press flex-1 rounded-lg px-2 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] ${
                    theme === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="mx-2 my-1.5 h-px bg-line" />
            <SelfCheckPanel state={state} onRun={onSelfCheck} />
          </Popover>
        </div>
      </div>

      {state.members.length > 0 && (
        <div className="px-4 pb-3">
          <div className="rounded-2xl border border-line bg-surface shadow-sm">
            {/* Speaking as + subjects toggle */}
            <div className="relative flex items-center gap-2 p-1.5">
              <button onClick={() => setWho((v) => !v)} className="press flex min-w-0 items-center gap-2 rounded-xl py-1 pl-1 pr-2.5 hover:bg-surface-2">
                {speaker ? <Avatar name={speaker.name} size={24} /> : <span className="h-6 w-6 rounded-[30%] bg-line" />}
                <span className="label !text-[9px] text-muted">As</span>
                <span className="truncate text-[13.5px] font-medium">{speaker?.name ?? "—"}</span>
                <svg width="10" height="10" viewBox="0 0 12 12" className="text-muted" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 4.5 6 7.5l3-3" />
                </svg>
              </button>
              <Popover open={who} onClose={() => setWho(false)} align="left">
                <div className="label px-3 pb-1 pt-2 text-muted">Who's typing?</div>
                {state.members.map((m) => (
                  <button key={m.id} className={item} onClick={() => (onSpeaker(m.id), setWho(false))}>
                    <Avatar name={m.name} size={24} />
                    <span className="flex-1">{m.name}</span>
                    {m.id === speakerId && <span className="text-green-text">✓</span>}
                  </button>
                ))}
              </Popover>

              <span className="h-5 w-px bg-line" />

              <button
                onClick={() => setSubjectsOpen((v) => !v)}
                className="press flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2"
                aria-expanded={subjectsOpen}
              >
                <span className="label shrink-0 !text-[9.5px] text-ink">Subjects</span>
                <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  {summary.map((k) => (
                    <span key={k} className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-muted">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[k]}`} />
                      {counts[k]}
                    </span>
                  ))}
                </span>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  className={`shrink-0 text-muted transition-transform duration-300 ${subjectsOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M3 4.5 6 7.5l3-3" />
                </svg>
              </button>
            </div>

            {subjectsOpen && (
              <div className="animate-pop scroll-y max-h-[42dvh] border-t border-line px-3 py-1" style={{ transformOrigin: "top center" }}>
                <div className="divide-y divide-line">
                  {subjects.map((s) => (
                    <div key={s.memberId} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={s.name} size={26} />
                        <span className="truncate text-[14px] font-medium">{s.name}</span>
                      </div>
                      <Stamp tone={s.status.tone} size="xs">
                        {s.status.label}
                      </Stamp>
                      <span
                        className={`tabular min-w-[88px] text-right font-mono text-[13.5px] font-semibold ${s.netCents > 0 ? "text-green-text" : s.netCents < 0 ? "text-red-text" : "text-muted"}`}
                      >
                        {s.netCents > 0 ? "+" : s.netCents < 0 ? "−" : ""}
                        {money(Math.abs(s.netCents), state.group.currency)}
                      </span>
                      {s.budgetCents != null && s.budgetCents > 0 && <BudgetBar budget={s.budgetCents} spent={s.spentCents} currency={state.group.currency} />}
                    </div>
                  ))}
                </div>
                <div className="label py-2 !text-[9px] text-muted">Green owed · Red owes</div>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
