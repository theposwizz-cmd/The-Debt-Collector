import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppIcon } from "../components/Cards";

export type LoadingMode = "intro" | "quick" | "seeding";

const LINES: Record<LoadingMode, string> = {
  intro: "OPENING CASE FILE…",
  quick: "OPENING CASE FILE…",
  seeding: "SEEDING DEMO CASE…",
};

// Calm status lines for a slow (e.g. free-tier, waking) server. Never "error"-looking.
const WAITING = ["Opening case file…", "Waking the records room…", "Dusting off the ledger…", "Still here. The Collector is patient."];

const MIN_MS: Record<LoadingMode, number> = { intro: 3200, quick: 0, seeding: 500 };

// First visit: the bar fills over the intro while these lines tick by (ms from start).
const INTRO_STEPS: [number, string][] = [
  [0, "Opening the case file…"],
  [900, "Checking who owes whom…"],
  [1900, "Sharpening the pencil…"],
  [2700, "All accounted for."],
];

/**
 * Branded loading sequence. Dismisses itself as soon as `ready` (after a short minimum so the
 * intro reads), keeps a single calm loop running while waiting, and offers Skip after 1 s.
 */
export function LoadingScreen({
  mode,
  ready,
  slowNote,
  onDone,
  onSkip,
}: {
  mode: LoadingMode;
  ready: boolean;
  slowNote?: string | null;
  onDone: () => void;
  onSkip?: () => void;
}) {
  const t0 = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - t0.current), 250);
    return () => clearInterval(id);
  }, []);

  // Finish: fill the bar, then hand off. Never later than needed.
  useEffect(() => {
    if (!ready || finishing) return;
    const wait = Math.max(0, MIN_MS[mode] - (Date.now() - t0.current));
    const id = setTimeout(() => setFinishing(true), wait);
    return () => clearTimeout(id);
  }, [ready, finishing, mode]);
  // Quick mode (repeat visits): stay invisible for a beat so a fast load never flashes.
  const neverShown = mode === "quick" && Date.now() - t0.current < 350;
  const hiddenForNow = mode === "quick" && elapsed < 350;
  useEffect(() => {
    if (!finishing || done.current) return;
    // If it was never visible, hand off immediately (no fill animation to show).
    const id = setTimeout(
      () => {
        done.current = true;
        onDone();
      },
      neverShown ? 0 : 260,
    );
    return () => clearTimeout(id);
  }, [finishing, onDone, neverShown]);
  const text = LINES[mode];
  // The first-visit intro fills its bar over MIN_MS; past that (slow server) it falls back to the sweep.
  const introFill = mode === "intro" && !finishing && elapsed < MIN_MS.intro;
  const introStep = [...INTRO_STEPS].reverse().find(([at]) => elapsed >= at)?.[1] ?? "";
  const status =
    slowNote && elapsed > 60_000
      ? "Can't reach the server yet. Still trying…"
      : mode === "intro" && elapsed < MIN_MS.intro + 300
        ? introStep
        : elapsed > 3000
        ? WAITING[Math.floor((elapsed - 3000) / 4000) % WAITING.length]
        : mode === "seeding"
          ? "Five subjects, one villa, one boat, one very long memory."
          : "";

  return (
    <motion.div
      className="no-scrollbar scroll-y relative flex h-full flex-col items-center overflow-x-hidden px-8 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: hiddenForNow ? 0 : 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.25 } }}
      transition={{ duration: 0.25 }}
      aria-busy={!finishing}
      aria-live="polite"
    >
      {/* Equal spacers above and below centre the content when it fits; when it doesn't they
          collapse to nothing, so it scrolls from the top instead of being clipped above it. */}
      <div aria-hidden className="min-h-6 flex-1" />
      {/* the Collector springs in */}
      <motion.div
        initial={{ scale: 0.6, y: 14, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 18 }}
      >
        <AppIcon size={84} />
      </motion.div>

      <motion.div
        className="label mt-6 !text-[10px] text-red-text"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.35 }}
      >
        Case #0247 · Collections division
      </motion.div>

      {/* the line types out, letter by letter */}
      <div className="relative mt-2.5 flex items-center justify-center">
        <motion.h1
          className="font-mono text-[17px] font-semibold tracking-[0.06em]"
          aria-label={text}
          initial="hidden"
          animate="shown"
          variants={{ shown: { transition: { delayChildren: 0.25, staggerChildren: 0.035 } } }}
        >
          {[...text].map((ch, i) => (
            <motion.span
              key={i}
              aria-hidden
              className="inline-block whitespace-pre"
              variants={{ hidden: { opacity: 0, y: 3 }, shown: { opacity: 1, y: 0, transition: { duration: 0.08 } } }}
            >
              {ch}
            </motion.span>
          ))}
        </motion.h1>
      </div>

      {/* a faint CONFIDENTIAL stamp presses in */}
      <motion.span
        aria-hidden
        className="badge no-dot mt-4 px-2.5 py-[5px] text-[10px] text-red-text"
        style={{ ["--badge-rot" as string]: "-7deg" }}
        initial={{ scale: 1.8, opacity: 0, rotate: -14 }}
        animate={{ scale: 1, opacity: 0.55, rotate: -7 }}
        transition={{ delay: 0.85, type: "spring", stiffness: 520, damping: 17 }}
      >
        Confidential
      </motion.span>

      {/* the one loop: a stamp-style progress bar sweeping until ready, then filling */}
      <div className="relative mt-7 h-[3px] w-44 overflow-hidden rounded-full bg-line">
        {finishing ? (
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-ink"
            initial={{ width: mode === "intro" ? "92%" : "35%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 0.22 }}
          />
        ) : introFill ? (
          <div className="intro-fill absolute inset-y-0 left-0 rounded-full bg-ink" style={{ animationDuration: `${MIN_MS.intro}ms` }} />
        ) : (
          <motion.div
            className="absolute inset-y-0 w-1/3 rounded-full bg-ink"
            initial={{ x: "-110%" }}
            animate={{ x: "310%" }}
            transition={{ repeat: Infinity, duration: 1.15, ease: [0.45, 0, 0.35, 1] }}
          />
        )}
      </div>

      <div className="mt-3 h-5 text-[12.5px] text-muted">
        <AnimatePresence mode="wait">
          {status && (
            <motion.span
              key={status}
              className="block"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
            >
              {status}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {slowNote && elapsed > 60_000 && <div className="mt-1 max-w-[280px] break-words font-mono text-[10.5px] text-muted">{slowNote}</div>}

      <div aria-hidden className="min-h-16 flex-1" />

      {/* Skip, after 1 s */}
      {onSkip && (
        <AnimatePresence>
          {elapsed > 1000 && !finishing && (
            <motion.button
              type="button"
              onClick={onSkip}
              className="press absolute bottom-6 rounded-full px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-ink"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              Skip →
            </motion.button>
          )}
        </AnimatePresence>
      )}
    </motion.div>
  );
}
