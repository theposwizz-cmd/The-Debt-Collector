import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { GLIDE, InspectorHero, type HeroPhase } from "../components/InspectorHero";
import { AppleEmoji } from "../components/AppleEmoji";
import { PressButton } from "../components/PressButton";
import { CaseList } from "../components/CaseList";
import type { CaseSummary } from "../types";
import type { Theme } from "../components/Header";

const TAGS = ["Reads receipts", "Settles debts", "Chases payment"];

// The Collector's fine print. One is picked each time Home loads.
const QUIPS = [
  "Friendships may vary. Debts will not.",
  "No friendships harmed. Several invoiced.",
  "Never forgets. Rarely forgives. Takes PayPal.",
  "It's not personal. It's €238.12.",
];

// Each little sign hangs on its own string length, so they don't look stamped out.
const DROPS = [14, 28, 19];

/**
 * The three feature tags as small signs dangling from the big nameplate on two strings each.
 * They drop in one after another and swing to rest like they've just been hung.
 */
function HangingTags({ swing = true }: { swing?: boolean }) {
  return (
    <div className="relative z-0 -mt-1 flex w-full max-w-[330px] items-start justify-center gap-1.5" aria-label="What it does" role="list">
      {TAGS.map((t, i) => (
        <motion.div
          key={t}
          role="listitem"
          className="relative flex flex-col items-center"
          style={{ transformOrigin: "50% 0%" }}
          initial={swing ? { y: -26, opacity: 0, rotate: i === 1 ? 9 : -12 } : false}
          animate={
            swing
              ? { y: 0, opacity: 1, rotate: i === 1 ? [9, -7, 4.5, -2.5, 1.2, 0] : [-12, 9, -5, 2.6, -1.1, 0] }
              : { y: 0, opacity: 1, rotate: 0 }
          }
          transition={{
            delay: 0.26 + i * 0.12, // after the tagline has faded
            y: { type: "spring", stiffness: 420, damping: 20 },
            opacity: { duration: 0.15 },
            rotate: { duration: 1.5, ease: "easeOut", times: [0, 0.2, 0.42, 0.62, 0.82, 1] },
          }}
        >
          {/* two strings from under the big sign */}
          <div className="relative w-full" style={{ height: DROPS[i] }}>
            <span className="absolute left-[26%] top-0 h-full w-[1.5px] rounded-full bg-ink-soft/70" />
            <span className="absolute right-[26%] top-0 h-full w-[1.5px] rounded-full bg-ink-soft/70" />
          </div>
          {/* the little sign */}
          <div className="relative rounded-[8px] border border-line bg-surface px-2 py-[7px] shadow-md">
            <span aria-hidden className="absolute left-[calc(26%-2px)] top-[3px] h-1 w-1 rounded-full bg-ink-soft/40" />
            <span aria-hidden className="absolute right-[calc(26%-2px)] top-[3px] h-1 w-1 rounded-full bg-ink-soft/40" />
            <span className="label block whitespace-nowrap !text-[8.5px] !tracking-[0.07em] text-ink-soft">{t}</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

const rise = {
  hidden: { opacity: 0, y: 14 },
  shown: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } },
};

/** Entry screen: instant context for a cold visitor, two big tactile actions. */
export function HomeScreen({
  onDemo,
  onNew,
  cases = [],
  currentId,
  onOpenCase,
  tuck = "none",
  busy,
  error,
  theme,
  onTheme,
}: {
  onDemo: () => void;
  onNew: () => void;
  /** Saved cases, listed once the hero has tucked away. */
  cases?: CaseSummary[];
  currentId?: number;
  onOpenCase: (id: number) => void;
  /**
   * none    - first visit: the full bulldog hero.
   * animate - back from a chat: he lets go, ducks behind the sign, and the sign glides up.
   * static  - returning, but loaded straight onto Home: already tucked, no replay.
   */
  tuck?: "none" | "animate" | "static";
  busy: boolean;
  error: string | null;
  theme: Theme;
  onTheme: (t: Theme) => void;
}) {
  // Back from a chat: show him, let go + duck (hiding), collapse his space so the sign glides up
  // (tucked), then drop the tagline and hang the feature signs from the nameplate (hung).
  type Phase = HeroPhase | "hung";
  const [phase, setPhase] = useState<Phase>(tuck === "static" ? "hung" : "full");
  useEffect(() => {
    if (tuck !== "animate") return;
    const a = setTimeout(() => setPhase("hiding"), 380);
    const b = setTimeout(() => setPhase("tucked"), 380 + 560);
    const c = setTimeout(() => setPhase("hung"), 380 + 560 + 620);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
      clearTimeout(c);
    };
  }, [tuck]);
  const tucked = phase === "tucked" || phase === "hung";
  const hung = phase === "hung";
  const [quip] = useState(() => QUIPS[Math.floor(Math.random() * QUIPS.length)]);

  // While the sequence plays, lock scrolling: on short windows the content briefly overflows,
  // and a scrollbar popping in/out would shove the centred sign sideways mid-glide.
  const [settling, setSettling] = useState(tuck === "animate");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tuck !== "animate") return;
    scroller.current?.scrollTo({ top: 0 });
    const id = setTimeout(() => setSettling(false), 380 + 560 + 620 + 1700); // after the signs stop swinging
    return () => clearTimeout(id);
  }, [tuck]);

  return (
    <motion.div
      ref={scroller}
      className={`no-scrollbar flex h-full flex-col px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 ${settling ? "overflow-hidden" : "scroll-y"}`}
      initial="hidden"
      animate="shown"
      exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
      variants={{ shown: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } }}
    >
      {/* case-file header motif */}
      <motion.header variants={rise} className="flex shrink-0 items-center gap-2 border-b border-line pb-3">
        <span className="label !text-[10px] text-red-text">Case file · No. 0247</span>
        <span className="label rounded-full px-1.5 py-[2px] !text-[8.5px] text-muted ring-1 ring-line">Confidential</span>
        <button
          type="button"
          onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
          className="press ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-ink-soft shadow-sm hover:text-ink"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title="Theme"
        >
          {theme === "dark" ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
            </svg>
          )}
        </button>
      </motion.header>

      {/* identity: centred hero, or (once tucked) the sign up top as a header */}
      <div className={`flex flex-1 shrink-0 flex-col items-center text-center ${tucked ? "pb-4 pt-6" : "py-8"}`}>
        <div className={`flex w-full flex-col items-center ${tucked ? "" : "my-auto"}`}>
        <motion.div variants={rise} layout transition={GLIDE} className="relative z-10 w-full">
          <InspectorHero phase={phase === "hung" ? "tucked" : phase} entrance={tuck === "none"} />
        </motion.div>
        <AnimatePresence initial={false} mode="popLayout">
          {hung ? (
            <motion.div key="hanging" className="relative z-0 flex w-full justify-center">
              <HangingTags swing={tuck === "animate"} />
            </motion.div>
          ) : (
            <motion.div
              key="intro"
              className="flex flex-col items-center"
              exit={{ opacity: 0, y: -6, transition: { duration: 0.2 } }}
            >
              <motion.p variants={rise} layout="position" transition={GLIDE} className="mt-5 max-w-[320px] font-mono text-[14px] font-medium leading-[1.65] tracking-[-0.01em] text-ink-soft">
                The AI that splits the bill, sends the requests, and hounds the stragglers.
              </motion.p>
              <motion.ul variants={rise} layout="position" transition={GLIDE} className="mt-5 flex flex-wrap justify-center gap-1" aria-label="What it does">
                {TAGS.map((t) => (
                  <li key={t} className="badge no-dot px-2 py-[5px] text-[9.5px] text-ink-soft" style={{ ["--badge-rot" as string]: "0deg" }}>
                    {t}
                  </li>
                ))}
              </motion.ul>
            </motion.div>
          )}
        </AnimatePresence>
        {hung && cases.length > 0 && (
          <motion.div
            className="mt-7 flex w-full justify-center"
            initial={tuck === "animate" ? { opacity: 0, y: 12 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: tuck === "animate" ? 0.7 : 0, type: "spring", stiffness: 300, damping: 28 }}
          >
            <CaseList cases={cases} currentId={currentId} onOpen={onOpenCase} busy={busy} />
          </motion.div>
        )}
        </div>
      </div>

      {/* actions */}
      <motion.div variants={rise} className="shrink-0 space-y-3">
        <PressButton
          onClick={onDemo}
          disabled={busy}
          sub="Hvar Trip · 5 people, a villa, a receipt"
          icon={<AppleEmoji code="1f5c2-fe0f" size={26} />}
        >
          Load demo group
        </PressButton>
        <PressButton variant="secondary" onClick={onNew} disabled={busy} sub="Start a fresh case and just talk to it" icon={<AppleEmoji code="270d-fe0f" size={26} />}>
          New group
        </PressButton>
        {error && <div className="rounded-2xl border border-red/30 bg-red-soft px-3.5 py-2.5 text-[13px] text-red-text">{error}</div>}
      </motion.div>

      <motion.p variants={rise} className="label mt-4 shrink-0 text-center !text-[9px] text-amber-text">
        {quip}
      </motion.p>
    </motion.div>
  );
}
