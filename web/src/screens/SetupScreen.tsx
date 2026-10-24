import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../api";
import { AppleEmoji } from "../components/AppleEmoji";
import { Avatar } from "../components/Cards";
import { PressButton } from "../components/PressButton";
import type { AppState } from "../types";

type Purpose = "trip" | "flat" | "class" | "event" | "couple" | "team" | "other";
type Step = "purpose" | "name" | "people" | "balances";

const PURPOSES: { id: Purpose; label: string; sub: string; emoji: string }[] = [
  { id: "trip", label: "Trip", sub: "Holidays, weekends away", emoji: "2708-fe0f" },
  { id: "flat", label: "Shared flat", sub: "Rent, bills, groceries", emoji: "1f3e0" },
  { id: "class", label: "Class", sub: "School or course costs", emoji: "1f393" },
  { id: "event", label: "Event / party", sub: "Birthdays, festivals", emoji: "1f389" },
  { id: "couple", label: "Couple", sub: "Just the two of you", emoji: "1f491" },
  { id: "team", label: "Team / work", sub: "Lunches, gifts, kitty", emoji: "1f4bc" },
  { id: "other", label: "Something else", sub: "Any shared money", emoji: "2728" },
];
/** Only trips and events ask "where does everyone stand right now?". */
const BALANCE_PURPOSES: Purpose[] = ["trip", "event"];

const SLIDE = { type: "spring" as const, stiffness: 320, damping: 32 };
const slide = {
  enter: (dir: number) => ({ x: dir * 56, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -56, opacity: 0 }),
};

const euro = (cents: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(cents / 100);

/** The new-group survey: one question per page, sliding between them, dots showing where you are. */
export function SetupScreen({ onCancel, onDone }: { onCancel: () => void; onDone: (s: AppState & { meId: number }) => void }) {
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [me, setMe] = useState("");
  const [others, setOthers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [bal, setBal] = useState<Record<string, { owes: boolean; amount: string }>>({});
  const [budget, setBudget] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"budget" | "debts">("budget");
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const steps = useMemo<Step[]>(
    () => ["purpose", "name", "people", ...(purpose && BALANCE_PURPOSES.includes(purpose) ? (["balances"] as Step[]) : [])],
    [purpose],
  );
  const step = steps[i];
  const isLast = i === steps.length - 1;
  const people = [me.trim(), ...others].filter(Boolean);

  // Focus the step's text box once it has slid in.
  useEffect(() => {
    setError(null);
    const id = setTimeout(() => input.current?.focus(), 260);
    return () => clearTimeout(id);
  }, [step]);

  const go = (to: number) => {
    setDir(to > i ? 1 : -1);
    setI(Math.max(0, Math.min(steps.length - 1, to)));
  };

  // Signed cents per person: + is owed, - owes.
  const signed = people.map((n) => {
    const b = bal[n];
    const cents = Math.round((parseFloat((b?.amount ?? "").replace(",", ".")) || 0) * 100);
    return { name: n, cents: b?.owes ? -cents : cents };
  });
  const off = signed.reduce((s, b) => s + b.cents, 0);
  const anyBalance = signed.some((b) => b.cents !== 0);
  const budgets = people
    .map((n) => ({ name: n, cents: Math.round((parseFloat((budget[n] ?? "").replace(",", ".")) || 0) * 100) }))
    .filter((b) => b.cents > 0);
  const budgetTotal = budgets.reduce((s, b) => s + b.cents, 0);

  const nameTaken = (n: string) => people.some((p) => p.toLowerCase() === n.toLowerCase());
  const addPerson = () => {
    const n = draft.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!n) return;
    if (nameTaken(n)) return setError(`${n} is already in the group.`);
    setOthers((o) => [...o, n]);
    setDraft("");
    setError(null);
  };

  const canContinue =
    step === "purpose" ? !!purpose : step === "name" ? !!me.trim() : step === "people" ? others.length > 0 : off === 0;

  const finish = async (withBalances: boolean) => {
    if (!purpose) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createGroup({
        purpose,
        me: me.trim(),
        others,
        balances: withBalances && anyBalance ? signed.map((b) => ({ name: b.name, amount: b.cents / 100 })) : undefined,
        budgets: withBalances && budgets.length ? budgets.map((b) => ({ name: b.name, amount: b.cents / 100 })) : undefined,
      });
      onDone(res);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const next = () => {
    if (!canContinue || busy) return;
    if (isLast) return finish(true);
    go(i + 1);
  };

  return (
    <motion.div
      className="flex h-full flex-col"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={SLIDE}
    >
      {/* top bar: back, progress dots, close */}
      <div className="flex items-center px-4 pb-2 pt-4">
        <button
          type="button"
          onClick={() => (i === 0 ? onCancel() : go(i - 1))}
          className="press flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-soft shadow-sm hover:text-ink"
          aria-label={i === 0 ? "Cancel" : "Back"}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex flex-1 items-center justify-center gap-1.5" aria-label={`Step ${i + 1} of ${steps.length}`}>
          {steps.map((s, k) => (
            <motion.span
              key={s}
              layout
              transition={SLIDE}
              className={`block h-[7px] rounded-full ${k === i ? "bg-ink" : k < i ? "bg-ink/40" : "bg-line"}`}
              style={{ width: k === i ? 22 : 7 }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="press flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-soft shadow-sm hover:text-ink"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* the current question, sliding */}
      <div className="no-scrollbar scroll-y relative min-h-0 flex-1 overflow-x-hidden px-5">
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <motion.div key={step} custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={SLIDE} className="pb-6 pt-6">
            <div className="label !text-[10px] text-red-text">
              Question {i + 1} of {steps.length}
            </div>

            {step === "purpose" && (
              <>
                <h1 className="mt-2 font-mono text-[23px] font-semibold leading-tight tracking-[-0.02em]">What's this group for?</h1>
                <p className="mt-1.5 text-[14px] text-muted">So the Collector knows what kind of case this is.</p>
                <div className="mt-5 grid grid-cols-2 gap-2.5">
                  {PURPOSES.map((p) => (
                    <motion.button
                      key={p.id}
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      onClick={() => {
                        setPurpose(p.id);
                        setTimeout(() => {
                          setDir(1);
                          setI(1);
                        }, 220);
                      }}
                      className={`flex flex-col items-start gap-2 rounded-2xl border bg-surface p-3.5 text-left shadow-sm transition-colors ${
                        purpose === p.id ? "border-ink ring-2 ring-ink" : "border-line hover:border-ink/30"
                      } ${p.id === "other" ? "col-span-2 flex-row items-center" : ""}`}
                    >
                      <AppleEmoji code={p.emoji} size={28} />
                      <span className="min-w-0">
                        <span className="block text-[14.5px] font-semibold">{p.label}</span>
                        <span className="block text-[12px] leading-snug text-muted">{p.sub}</span>
                      </span>
                    </motion.button>
                  ))}
                </div>
              </>
            )}

            {step === "name" && (
              <>
                <h1 className="mt-2 font-mono text-[23px] font-semibold leading-tight tracking-[-0.02em]">What's your name?</h1>
                <p className="mt-1.5 text-[14px] text-muted">You'll be the first subject on file.</p>
                <input
                  ref={input}
                  value={me}
                  onChange={(e) => setMe(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && next()}
                  maxLength={40}
                  placeholder="e.g. Filip"
                  autoComplete="given-name"
                  className="mt-6 w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-[18px] shadow-sm outline-none transition-shadow placeholder:text-muted focus:border-red/40 focus:shadow-[0_0_0_4px_var(--red-soft)]"
                />
              </>
            )}

            {step === "people" && (
              <>
                <h1 className="mt-2 font-mono text-[23px] font-semibold leading-tight tracking-[-0.02em]">Who would you like to add?</h1>
                <p className="mt-1.5 text-[14px] text-muted">Everyone who'll share costs. Emails can come later in the chat.</p>
                <div className="mt-6 flex gap-2">
                  <input
                    ref={input}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (draft.trim()) addPerson();
                      else next();
                    }}
                    maxLength={40}
                    placeholder="Their name"
                    className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 py-3 text-[16px] shadow-sm outline-none transition-shadow placeholder:text-muted focus:border-red/40 focus:shadow-[0_0_0_4px_var(--red-soft)]"
                  />
                  <button
                    type="button"
                    onClick={addPerson}
                    disabled={!draft.trim()}
                    className="press shrink-0 rounded-2xl bg-ink px-4 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-own-fg shadow-sm disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 py-1 pl-1 pr-3 text-[14px]">
                    <Avatar name={me || "?"} size={24} />
                    {me} <span className="text-muted">· you</span>
                  </span>
                  <AnimatePresence initial={false}>
                    {others.map((n) => (
                      <motion.span
                        key={n}
                        layout
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 28 }}
                        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-1.5 text-[14px] shadow-sm"
                      >
                        <Avatar name={n} size={24} />
                        {n}
                        <button
                          type="button"
                          onClick={() => setOthers((o) => o.filter((x) => x !== n))}
                          className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
                          aria-label={`Remove ${n}`}
                        >
                          ×
                        </button>
                      </motion.span>
                    ))}
                  </AnimatePresence>
                </div>
              </>
            )}

            {step === "balances" && (
              <>
                <h1 className="mt-2 font-mono text-[23px] font-semibold leading-tight tracking-[-0.02em]">Where does everyone stand right now?</h1>
                <p className="mt-1.5 text-[14px] text-muted">
                  How much is each person bringing? And if anything's already owed, add it in the second tab. Starting fresh? Skip it.
                </p>

                {/* two kinds of "starting point": personal budgets, and debts already in play */}
                <div className="mt-5 flex rounded-2xl bg-surface-2 p-1" role="tablist">
                  {(
                    [
                      ["budget", "Starting budget"],
                      ["debts", "Owed / owes"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={`press relative flex-1 rounded-xl px-2 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] ${
                        tab === id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {tab === "budget" ? (
                  <>
                    <div className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface shadow-sm">
                      {people.map((n, k) => (
                        <div key={n} className="flex items-center gap-2.5 px-3 py-2.5">
                          <Avatar name={n} size={26} />
                          <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">
                            {n}
                            {k === 0 && <span className="font-normal text-muted"> · you</span>}
                          </span>
                          <span className="shrink-0 text-[12px] text-muted">brings</span>
                          <div className="flex w-[104px] shrink-0 items-center rounded-xl border border-line bg-bg px-2 focus-within:border-red/40">
                            <span className="text-[13px] text-muted">€</span>
                            <input
                              ref={k === 0 ? input : undefined}
                              value={budget[n] ?? ""}
                              onChange={(e) => setBudget((x) => ({ ...x, [n]: e.target.value.replace(/[^0-9.,]/g, "") }))}
                              onKeyDown={(e) => e.key === "Enter" && next()}
                              inputMode="decimal"
                              placeholder="0"
                              aria-label={`${n}'s starting budget`}
                              className="tabular w-full bg-transparent px-1 py-1.5 text-right font-mono text-[14px] outline-none placeholder:text-muted"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 text-center text-[13px] text-muted" aria-live="polite">
                      {budgetTotal
                        ? `Total brought: ${euro(budgetTotal)}. Each person's share of spending comes out of their own budget.`
                        : "Optional. Budgets show how much each person has left; they never change who owes whom."}
                    </div>
                  </>
                ) : (
                  <>
                <div className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface shadow-sm">
                  {people.map((n, k) => {
                    const b = bal[n] ?? { owes: false, amount: "" };
                    const set = (patch: Partial<typeof b>) => setBal((x) => ({ ...x, [n]: { ...b, ...patch } }));
                    return (
                      <div key={n} className="flex items-center gap-2.5 px-3 py-2.5">
                        <Avatar name={n} size={26} />
                        <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">
                          {n}
                          {k === 0 && <span className="font-normal text-muted"> · you</span>}
                        </span>
                        <div className="flex shrink-0 rounded-full bg-surface-2 p-0.5" role="group" aria-label={`${n}: owed or owes`}>
                          {(["Owed", "Owes"] as const).map((label) => {
                            const active = (label === "Owes") === b.owes;
                            return (
                              <button
                                key={label}
                                type="button"
                                onClick={() => set({ owes: label === "Owes" })}
                                className={`rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                                  active ? (label === "Owes" ? "bg-red text-white" : "bg-green text-white") : "text-muted"
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex w-[84px] shrink-0 items-center rounded-xl border border-line bg-bg px-2 focus-within:border-red/40">
                          <span className="text-[13px] text-muted">€</span>
                          <input
                            
                            value={b.amount}
                            onChange={(e) => set({ amount: e.target.value.replace(/[^0-9.,]/g, "") })}
                            onKeyDown={(e) => e.key === "Enter" && next()}
                            inputMode="decimal"
                            placeholder="0"
                            aria-label={`${n}'s amount`}
                            className="tabular w-full bg-transparent px-1 py-1.5 text-right font-mono text-[14px] outline-none placeholder:text-muted"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div
                  className={`mt-3 text-center text-[13px] ${!anyBalance ? "text-muted" : off === 0 ? "text-green-text" : "text-red-text"}`}
                  aria-live="polite"
                >
                  {!anyBalance
                    ? "Everyone starts at zero."
                    : off === 0
                      ? "✓ Balanced: what's owed matches what's owing."
                      : `Off by ${euro(Math.abs(off))}. What's owed and what's owing need to match.`}
                </div>
                  </>
                )}
              </>
            )}

            {error && <div className="mt-4 rounded-2xl border border-red/30 bg-red-soft px-3.5 py-2.5 text-[13px] text-red-text">{error}</div>}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* actions */}
      {step !== "purpose" && (
        <div className="space-y-2.5 px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3">
          <PressButton onClick={next} disabled={!canContinue || busy}>
            {busy ? "Opening the case…" : isLast ? "Open the case" : "Continue"}
          </PressButton>
          {step === "balances" && (
            <button
              type="button"
              onClick={() => finish(false)}
              disabled={busy}
              className="press mx-auto block rounded-full px-4 py-2 text-[13px] text-muted hover:text-ink disabled:opacity-50"
            >
              Skip, start everyone at zero
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
