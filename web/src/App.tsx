import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { api } from "./api";
import { Composer } from "./components/Composer";
import { AppIcon } from "./components/Cards";
import { BalancesProvider } from "./components/balances";
import { MeProvider } from "./components/me";
import { Header, type Theme } from "./components/Header";
import { MessageList } from "./components/MessageList";
import { HomeScreen } from "./screens/HomeScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { LoadingScreen, type LoadingMode } from "./screens/LoadingScreen";
import type { AppState, ChatMessage, Transfer } from "./types";

const SPEAKER_KEY = "debt-collector.speaker";
// Who you were in each case, so switching cases brings you back as yourself.
const SPEAKERS_KEY = "debt-collector.speakers";
const THEME_KEY = "debt-collector.theme";
const ENTERED_KEY = "debt-collector.entered"; // has opened the chat before -> skip Home next time
const INTRO_KEY = "debt-collector.introSeen"; // has seen the full intro -> quick loader only
const TUCKED_KEY = "debt-collector.homeTucked"; // has seen the bulldog duck away once -> never replay it

type Screen = "loading" | "home" | "setup" | "chat";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function setFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* storage unavailable */
  }
}

/** Where to land after loading: a #home / #chat link wins; otherwise returning users go straight to the chat. */
function initialTarget(): "home" | "chat" {
  if (location.hash === "#chat") return "chat";
  if (location.hash === "#home") return "home";
  return readFlag(ENTERED_KEY) ? "chat" : "home";
}

function upsert(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i === -1) return [...list, m].sort((a, b) => a.id - b.id);
  const next = list.slice();
  next[i] = m;
  return next;
}

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function readSpeaker(): number | null {
  try {
    const v = localStorage.getItem(SPEAKER_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

function readSpeakers(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SPEAKERS_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function EmptyState({ onDemo, busy, onSend }: { onDemo: () => void; busy: boolean; onSend: (t: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
      <div className="animate-rise w-full max-w-[340px] rounded-[24px] border border-line bg-surface px-6 pb-6 pt-8 shadow-lg">
        <div className="flex justify-center">
          <AppIcon size={56} />
        </div>
        <div className="mt-5 flex items-center justify-center gap-1.5">
          <span className="label !text-[10px] text-red-text">Collections division</span>
          <span className="label rounded-full px-1.5 py-[2px] !text-[8.5px] text-muted ring-1 ring-line">No open case</span>
        </div>
        <h1 className="mt-2 font-mono text-[24px] font-semibold leading-tight tracking-[-0.02em]">The Debt Collector</h1>
        <p className="mx-auto mt-2.5 max-w-[270px] text-[14.5px] leading-relaxed text-muted">
          Your group's money, kept by a calm collector with a very long memory. Just talk to it.
        </p>
        <button
          onClick={onDemo}
          disabled={busy}
          className="press mt-6 w-full rounded-full bg-ink px-5 py-3.5 font-mono text-[12.5px] font-medium uppercase tracking-[0.1em] text-own-fg shadow-md hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Opening file…" : "Load demo group"}
        </button>
      </div>
      <div className="label mt-8 text-muted">Or open a new case</div>
      <button
        onClick={() => onSend("New group for our Hvar trip. It's me, Ana, Luka and Marko. Euros.")}
        disabled={busy}
        className="press mt-3 max-w-[340px] rounded-2xl border border-line bg-surface/60 px-4 py-3 text-left text-[14px] text-ink-soft hover:bg-surface"
      >
        “New group for our Hvar trip. It's me, Ana, Luka and Marko. Euros.”
      </button>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speakerId, setSpeakerId] = useState<number | null>(readSpeaker);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const prevStatus = useRef<Map<number, string> | null>(null);

  // Entry flow: Loading -> Home -> Chat (repeat visits skip the intro and Home).
  const [screen, setScreen] = useState<Screen>("loading");
  const [loadingMode, setLoadingMode] = useState<LoadingMode>(() => (readFlag(INTRO_KEY) ? "quick" : "intro"));
  const [seedReady, setSeedReady] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  // The new-group survey remembers where it was opened from, so Cancel goes back there.
  const setupFrom = useRef<"home" | "chat">("home");
  const openSetup = (from: "home" | "chat") => {
    setupFrom.current = from;
    setScreen("setup");
  };
  // How Home was entered: back from a chat animates the bulldog away; a returning visitor
  // landing straight on Home sees it already tucked; first-timers get the full hero.
  const [homeTuck, setHomeTuck] = useState<"none" | "animate" | "static">(() => (readFlag(ENTERED_KEY) ? "static" : "none"));
  const target = useRef<"home" | "chat">(initialTarget());

  const finishLoading = useCallback(() => {
    setFlag(INTRO_KEY);
    setScreen(loadingMode === "seeding" ? "chat" : target.current);
  }, [loadingMode]);

  // Keep the URL in step so refreshes and shared links land in the same place.
  useEffect(() => {
    if (screen === "loading") return;
    history.replaceState(null, "", screen === "chat" ? "#chat" : "#home");
    if (screen === "chat") setFlag(ENTERED_KEY);
  }, [screen]);

  /** Home actions: run the existing API call, then enter the chat. Demo seeding shows the loader. */
  const enter = async (fn: () => Promise<AppState>, seeding: boolean) => {
    setHomeError(null);
    setBusy(true);
    if (seeding) {
      setSeedReady(false);
      setLoadingMode("seeding");
      setScreen("loading");
    }
    try {
      apply(await fn());
      if (seeding) setSeedReady(true);
      else setScreen("chat");
    } catch (e) {
      setHomeError((e as Error).message);
      setScreen("home");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#101014" : "#f7f5f0");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const apply = useCallback((s: AppState) => {
    setState(s);
    setMessages(s.messages);
  }, []);

  // Retry while the API server is still starting up.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const load = () =>
      api
        .state()
        .then((s) => !cancelled && (setLoadError(null), apply(s)))
        .catch((e) => {
          if (cancelled) return;
          ++tries;
          setLoadError(e.message); // shown calmly on the loading screen after a long wait
          setTimeout(load, tries < 10 ? 1500 : 3000);
        });
    load();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // Live updates: agent replies, nudges, PayPal status changes.
  const groupId = state?.group.id;
  useEffect(() => {
    if (!groupId) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let lastSeen = Date.now();
    const seen = () => {
      lastSeen = Date.now();
    };
    const connect = () => {
      es?.close();
      lastSeen = Date.now();
      es = new EventSource("/api/stream");
      // Resync on every (re)connect so nothing sent while disconnected is missed.
      es.onopen = () => {
        seen();
        api.state().then(apply).catch(() => undefined);
      };
      es.addEventListener("ping", seen);
      es.addEventListener("message", (e) => {
        seen();
        setMessages((list) => upsert(list, JSON.parse((e as MessageEvent).data).message));
      });
      es.addEventListener("typing", (e) => {
        seen();
        setTyping(JSON.parse((e as MessageEvent).data).typing);
      });
      es.addEventListener("state", (e) => {
        seen();
        apply(JSON.parse((e as MessageEvent).data));
      });
      es.onerror = () => {
        // The browser gives up for good on a non-200 reconnect (e.g. server restarting); retry ourselves.
        if (es?.readyState === EventSource.CLOSED && !closed) {
          setTyping(false);
          if (retry) clearTimeout(retry);
          retry = setTimeout(connect, 2000);
        }
      };
    };
    connect();
    // Watchdog: a proxy can leave a dead stream looking "open". The server pings every 10 s;
    // if nothing arrives for 25 s, reconnect (and resync) instead of silently missing messages.
    const watchdog = setInterval(() => {
      if (!closed && Date.now() - lastSeen > 25_000) {
        setTyping(false);
        connect();
      }
    }, 5000);
    return () => {
      closed = true;
      clearInterval(watchdog);
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [groupId, apply]);

  // Keep the speaker valid for the current case: who you were here last time, else the first member.
  useEffect(() => {
    if (!state) return;
    if (state.members.some((m) => m.id === speakerId)) return;
    const saved = readSpeakers()[state.group.id];
    setSpeakerId(state.members.some((m) => m.id === saved) ? saved : (state.members[0]?.id ?? null));
  }, [state, speakerId]);
  useEffect(() => {
    if (!state || !speakerId || !state.members.some((m) => m.id === speakerId)) return;
    try {
      localStorage.setItem(SPEAKER_KEY, String(speakerId));
      localStorage.setItem(SPEAKERS_KEY, JSON.stringify({ ...readSpeakers(), [state.group.id]: speakerId }));
    } catch {
      /* storage unavailable */
    }
  }, [speakerId, state]);

  const run = async (fn: () => Promise<AppState>) => {
    setBusy(true);
    try {
      apply(await fn());
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async (text: string) => {
    try {
      const m = await api.send(text, speakerId);
      setMessages((list) => upsert(list, m));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // These chips are answered instantly from the ledger (no AI key needed); the rest go to The Collector.
  const QUICK: Record<string, "balances" | "debts" | "settle"> = {
    "Show balances": "balances",
    "Who owes the most?": "debts",
    "Settle up": "settle",
  };
  const chip = async (text: string) => {
    const kind = QUICK[text];
    if (!kind) return send(text);
    try {
      const m = await api.quick(kind, text, speakerId);
      setMessages((list) => upsert(list, m));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const sendImage = async (file: File, caption: string) => {
    try {
      const m = await api.receipt(file, caption, speakerId);
      setMessages((list) => upsert(list, m));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // Transfers that flip open -> paid while the page is open get the stamp animation (not on reload).
  useEffect(() => {
    if (!state) return;
    const next = new Map(state.transfers.map((t) => [t.id, t.status]));
    const prev = prevStatus.current;
    if (prev) {
      const newly = [...next].filter(([id, st]) => st === "paid" && prev.get(id) === "open").map(([id]) => id);
      if (newly.length) setFresh((f) => new Set([...f, ...newly]));
    }
    prevStatus.current = next;
  }, [state]);

  const nets = useMemo(() => new Map((state?.balances ?? []).map((b) => [b.name, b.netCents])), [state?.balances]);

  const liveTransfers = useMemo(() => new Map<number, Transfer>((state?.transfers ?? []).map((t) => [t.id, t])), [state?.transfers]);

  const suggestions = useMemo(() => {
    if (!state || !state.members.length) return [];
    const hasExpenses = state.balances.some((b) => b.netCents !== 0) || messages.some((m) => m.data?.cards?.some((c: any) => c.type === "expense"));
    const open = state.transfers.some((t) => t.status === "open");
    if (!hasExpenses) return ["I paid 600 for the villa, split evenly"];
    if (open) return ["Has everyone paid?", "Who still owes me?", "Show balances"];
    return ["Settle up", "Who owes the most?", "Show balances"];
  }, [state, messages]);

  const missing = state && (!state.config.anthropic || !state.config.paypal);
  // Keys present but the live self-check failed: say so loudly, with the real error.
  const failedChecks =
    state?.selfcheck.status === "done"
      ? ([
          ["Claude", state.config.anthropic, state.selfcheck.claude],
          ["PayPal", state.config.paypal, state.selfcheck.paypal],
        ] as const).filter(([, keySet, r]) => keySet && r && !r.ok)
      : [];

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-full items-stretch justify-center sm:items-center sm:p-5">
      <div className="relative w-full max-w-[460px]">
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-bg sm:h-[min(900px,calc(100dvh-40px))] sm:rounded-[32px] sm:border sm:border-line sm:shadow-lg">
        <AnimatePresence mode="wait" initial={false}>
        {screen === "loading" ? (
          <LoadingScreen
            key={`loading-${loadingMode}`}
            mode={loadingMode}
            ready={loadingMode === "seeding" ? seedReady : !!state}
            slowNote={loadError}
            onDone={finishLoading}
            onSkip={loadingMode === "seeding" ? undefined : finishLoading}
          />
        ) : screen === "setup" ? (
          <SetupScreen
            key="setup"
            onCancel={() => setScreen(setupFrom.current)}
            onDone={(s) => {
              apply(s);
              setSpeakerId(s.meId); // you're the one speaking in your new group
              setFlag(ENTERED_KEY);
              setScreen("chat");
            }}
          />
        ) : screen === "home" ? (
          <HomeScreen
            key="home"
            onDemo={() => enter(api.demo, true)}
            onNew={() => openSetup("home")}
            cases={state?.cases ?? []}
            currentId={state?.group.id}
            onOpenCase={(id) => enter(() => api.openGroup(id), false)}
            tuck={homeTuck}
            busy={busy || !state}
            error={homeError ?? (!state && loadError ? "Still waking the server. The buttons will work in a moment." : null)}
            theme={theme}
            onTheme={setTheme}
          />
        ) : (
        <motion.div
          key="chat"
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
        {state && (
          <Header
            state={state}
            messages={messages}
            speakerId={speakerId}
            onSpeaker={setSpeakerId}
            onDemo={() => run(api.demo)}
            onReset={() => openSetup("chat")}
            onFastForward={(d) => run(() => api.fastForward(d))}
            onResetClock={() => run(api.resetClock)}
            theme={theme}
            onTheme={setTheme}
            onSelfCheck={() => run(api.selfCheck)}
            onOpenCase={(id) => run(() => api.openGroup(id))}
            onHome={() => {
              // The duck-and-glide plays only the first time; after that Home opens already settled.
              setHomeTuck(readFlag(TUCKED_KEY) ? "static" : "animate");
              setFlag(TUCKED_KEY);
              setScreen("home");
            }}
            busy={busy}
          />
        )}
        {missing && (
          <div className="flex gap-2 border-b border-amber/25 bg-amber-soft px-4 py-2 text-[12px] text-amber-text">
            <span className="label shrink-0 pt-[1px] !text-[9.5px]">Notice</span>
            <span>
              {!state!.config.anthropic && "ANTHROPIC_API_KEY missing. "}
              {!state!.config.paypal && "PayPal sandbox keys missing. "}
              Add them to <span className="font-mono">.env</span> and restart.
            </span>
          </div>
        )}
        {failedChecks.length > 0 && (
          <div className="flex gap-2 border-b border-red/25 bg-red-soft px-4 py-2 text-[12px] text-red-text">
            <span className="label shrink-0 pt-[1px] !text-[9.5px]">Self-check</span>
            <span className="min-w-0 break-words">
              {failedChecks.map(([name, , r]) => (
                <span key={name} className="block">
                  <span className="font-semibold">{name} failed:</span> {r!.detail}
                </span>
              ))}
            </span>
          </div>
        )}
        {/* The composer lives inside the scroller (sticky), so the log slides under it and blurs. */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-1 flex-col">
          {!state ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading…</div>
          ) : messages.length === 0 ? (
            <EmptyState onDemo={() => run(api.demo)} busy={busy} onSend={send} />
          ) : (
            <BalancesProvider value={nets}>
              <MeProvider value={state.members.find((m) => m.id === speakerId)?.name ?? null}>
              <MessageList
                messages={messages}
                speakerId={speakerId}
                typing={typing}
                liveTransfers={liveTransfers}
                fresh={fresh}
                onSettle={(id) => run(() => api.settleTransfer(id, speakerId))}
              />
              </MeProvider>
            </BalancesProvider>
          )}
          </div>
          {state && <Composer onSend={send} onChip={chip} onImage={sendImage} suggestions={messages.length ? suggestions : []} />}
        </main>
        </motion.div>
        )}
        </AnimatePresence>
      </div>
      </div>
    </div>
    </MotionConfig>
  );
}
