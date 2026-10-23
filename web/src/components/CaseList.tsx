import { motion } from "framer-motion";
import type { CaseSummary } from "../types";
import { Avatar } from "./Cards";

/** The number on the case file, as shown in the chat header. */
export const caseNumber = (id: number) => String(246 + id).padStart(4, "0");

const euros = (cents: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

function when(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Saved cases on Home: tap one to pick up where the group left off. */
export function CaseList({ cases, currentId, onOpen, busy }: { cases: CaseSummary[]; currentId?: number; onOpen: (id: number) => void; busy: boolean }) {
  if (!cases.length) return null;
  return (
    <section className="w-full max-w-[400px] text-left" aria-label="Your cases">
      <div className="label mb-2 flex items-center justify-between px-1 !text-[9.5px] text-muted">
        <span>Your cases</span>
        <span>{cases.length} on file</span>
      </div>
      <ul className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sm">
        {cases.map((c, i) => (
          <motion.li
            key={c.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, type: "spring", stiffness: 380, damping: 30 }}
            className={i ? "border-t border-line" : ""}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpen(c.id)}
              className="press flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-2 disabled:opacity-60"
            >
              <div className="flex shrink-0 -space-x-2">
                {c.members.slice(0, 3).map((m) => (
                  <span key={m} className="rounded-[9px] ring-2 ring-surface">
                    <Avatar name={m} size={24} />
                  </span>
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-[14.5px] font-semibold">{c.name ?? "Untitled case"}</span>
                  <span className="label shrink-0 !text-[8.5px] text-muted">#{caseNumber(c.id)}</span>
                  {c.id === currentId && <span className="label shrink-0 !text-[8.5px] text-green-text">· Open</span>}
                </div>
                <div className="truncate text-[12.5px] text-muted">
                  {c.members.join(", ")}
                  {c.spentCents > 0 && ` · ${euros(c.spentCents)} spent`}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="tabular font-mono text-[10.5px] text-muted">{when(c.lastAt)}</span>
                {c.openCents > 0 && <span className="tabular font-mono text-[10.5px] font-semibold text-red-text">{euros(c.openCents)} due</span>}
              </div>
            </button>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
