import { Fragment, useContext, useEffect, useRef, useState } from "react";
import type { ChatMessage, PaymentCheckResult, Transfer } from "../types";
import { AppIcon, Avatar, CardView, PayPalButton, SettledTick, Stamp, type StampTone } from "./Cards";
import { MeContext } from "./me";

/** Shown instead of pay/confirm buttons to people who aren't part of a debt. */
function NotYours({ debtor }: { debtor: string }) {
  return <span className="text-[12px] italic text-muted">Only {debtor} can pay this.</span>;
}

// Amounts, plain numbers, dates/times, and currency signs or codes.
const FIGURE = /([€$£]\s?\d+(?:[.,:/-]\d+)*(?:\s?(?:EUR|USD|GBP))?|\d+(?:[.,:/-]\d+)*(?:\s?(?:€|£|\$|EUR|USD|GBP))?|[€$£])/g;

/** Bold every number and currency sign so figures stand out in chat text. */
export function Figures({ text }: { text: string }) {
  return (
    <>
      {text.split(FIGURE).map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="tabular font-bold">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Tiny safe formatter: **bold**, line breaks, "- " bullets, bold figures. */
function RichText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const inline = (s: string, k: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={`${k}-${i}`} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <Figures key={`${k}-${i}`} text={part} />
      ),
    );
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-1 space-y-0.5 pl-4">
        {list.map((l, i) => (
          <li key={i} className="list-disc marker:text-red">
            {inline(l, `li-${blocks.length}-${i}`)}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  text.split("\n").forEach((line, i) => {
    const m = line.match(/^\s*[-•*]\s+(.*)$/);
    if (m) return void list.push(m[1]);
    flush();
    if (line.trim() === "") blocks.push(<div key={`sp-${i}`} className="h-2" />);
    else blocks.push(<div key={`p-${i}`}>{inline(line, `p-${i}`)}</div>);
  });
  flush();
  return <>{blocks}</>;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function Meta({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <div className={`label mb-1.5 !text-[10px] text-muted ${align === "right" ? "pr-1 text-right" : "pl-1"}`}>{children}</div>;
}

const NOTICES: Record<1 | 2 | 3, { title: string; tone: StampTone; dot: string }> = {
  1: { title: "Courtesy notice", tone: "ink", dot: "bg-muted" },
  2: { title: "Second notice", tone: "amber", dot: "bg-amber" },
  3: { title: "Final notice", tone: "red", dot: "bg-red" },
};

function Notice({ m, live, fresh }: { m: ChatMessage; live: Map<number, Transfer>; fresh: Set<number> }) {
  const me = useContext(MeContext);
  const d = m.data ?? {};
  const level = (d.level ?? 1) as 1 | 2 | 3;
  const n = NOTICES[level];
  const t = live.get(d.transferId);
  const paid = t?.status === "paid";
  return (
    <div
      className={`rounded-[18px] border bg-surface px-4 py-3.5 ${
        level === 3
          ? // floating red glow instead of an outline
            "border-transparent shadow-[0_18px_36px_-14px_color-mix(in_srgb,var(--red)_55%,transparent),0_4px_12px_-4px_color-mix(in_srgb,var(--red)_25%,transparent)]"
          : level === 2
            ? "border-transparent shadow-[0_18px_36px_-14px_color-mix(in_srgb,var(--amber)_50%,transparent),0_4px_12px_-4px_color-mix(in_srgb,var(--amber)_22%,transparent)]"
            : "border-line shadow-md"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <Stamp tone={n.tone} size="xs">
          {n.title}
        </Stamp>
        <span className="label !text-[9.5px] text-muted">
          No. {d.nudgeNumber} · Day {d.daysOutstanding}
        </span>
      </div>
      <div className="text-[15px] leading-[1.45]">
        <Figures text={m.content} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-[12.5px] text-muted">
          {d.debtor} → {d.creditor} · <span className="tabular font-mono font-semibold text-ink">{d.amount}</span>
        </span>
        {paid ? (
          <Stamp tone="green" animate={fresh.has(d.transferId)}>
            Paid
          </Stamp>
        ) : t?.status === "open" ? (
          me === d.debtor ? (
            d.invoiceUrl && <PayPalButton url={d.invoiceUrl} compact />
          ) : (
            <NotYours debtor={d.debtor} />
          )
        ) : null}
      </div>
    </div>
  );
}

/** One person's settlement request: UNSETTLED next to their name until paid, then SETTLED. */
function SettleRequest({
  m,
  live,
  fresh,
  onSettle,
  onCheck,
}: {
  m: ChatMessage;
  live: Map<number, Transfer>;
  fresh: Set<number>;
  onSettle: (transferId: number) => void;
  onCheck: (transferId: number) => Promise<PaymentCheckResult | null>;
}) {
  const me = useContext(MeContext);
  const d = m.data ?? {};
  const t = live.get(d.transferId);
  const status = t?.status ?? "cancelled";
  const settled = status === "paid";
  const open = status === "open";
  return (
    <div
      className={`rounded-[18px] border bg-surface px-4 py-3.5 transition-shadow duration-500 ${
        settled
          ? // floating glow instead of an outline: green once settled, red while open
            "border-transparent shadow-[0_18px_36px_-14px_color-mix(in_srgb,var(--green)_50%,transparent),0_4px_12px_-4px_color-mix(in_srgb,var(--green)_22%,transparent)]"
          : open
            ? "border-transparent shadow-[0_18px_36px_-14px_color-mix(in_srgb,var(--red)_55%,transparent),0_4px_12px_-4px_color-mix(in_srgb,var(--red)_25%,transparent)]"
            : "border-line opacity-60 shadow-md"
      }`}
    >
      <div className="label mb-2.5 !text-[9.5px] text-muted">Settlement request · for {d.debtor}</div>

      {/* who, with their status right next to the name */}
      <div className="flex items-center gap-2.5">
        <Avatar name={d.debtor} size={32} />
        <span className="truncate text-[16px] font-semibold">{d.debtor}</span>
        {settled ? (
          <span className="flex items-center gap-1.5">
            <SettledTick />
            <Stamp tone="green" size="xs" animate={fresh.has(d.transferId)}>
              Settled
            </Stamp>
          </span>
        ) : open ? (
          <Stamp tone="red" size="xs">
            Unsettled
          </Stamp>
        ) : (
          <Stamp tone="muted" size="xs">
            Replaced
          </Stamp>
        )}
      </div>

      <div className="mt-2.5 text-[15px] leading-[1.45]">
        <Figures text={m.content} />
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
        <span className={`tabular font-mono text-[20px] font-semibold tracking-[-0.02em] ${settled ? "text-green-text" : "text-red-text"}`}>{d.amount}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[13px] text-muted">
          to <Avatar name={d.creditor} size={20} /> <span className="font-medium text-ink">{d.creditor}</span>
        </span>
      </div>

      {/* Actions depend on who's looking: the debtor pays, the creditor confirms, everyone else just watches. */}
      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {me === d.debtor && t?.invoiceUrl && <PayPalButton url={t.invoiceUrl} compact />}
          {me === d.creditor && (
            <>
              <button
                onClick={() => onSettle(d.transferId)}
                className="press inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-[6px] font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-soft shadow-sm hover:text-ink"
              >
                Mark as settled
              </button>
              <span className="text-[12px] text-muted">Paid outside PayPal? Confirm it here.</span>
            </>
          )}
          {me !== d.debtor && me !== d.creditor && <NotYours debtor={d.debtor} />}
        </div>
      )}
      {open && (me === d.debtor || me === d.creditor) && !t?.invoiceUrl && (t?.error ?? d.error) && (
        <div className="mt-2 text-[12px] leading-snug text-muted">{t?.error ?? d.error}</div>
      )}
      {t?.invoiceId && status !== "cancelled" && <PaymentCheck t={t} onCheck={onCheck} />}
    </div>
  );
}

function ago(ts: number, nowMs: number) {
  const s = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Live PayPal status under a request: what PayPal last said and when, any failure in full (never
 * hidden), and "Check payment now" to ask PayPal immediately instead of waiting for the ~15 s poll.
 */
function PaymentCheck({ t, onCheck }: { t: Transfer; onCheck: (transferId: number) => Promise<PaymentCheckResult | null> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (t.status !== "open") return;
    const id = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(id);
  }, [t.status]);

  const check = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await onCheck(t.id);
      if (!r) setNote({ tone: "bad", text: "The PayPal check didn't run." });
      else if (r.kind === "error") setNote({ tone: "bad", text: r.message });
      else if (r.kind === "paid") setNote({ tone: "ok", text: `PayPal says ${r.status}. Settled.` });
      else setNote({ tone: "ok", text: `PayPal says ${r.status}${r.kind === "awaiting" ? ": not paid yet." : "."}` });
    } catch (e) {
      setNote({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(false);
      setNowMs(Date.now());
    }
  };

  // Failures are shown in full to everyone: a silent failure would look exactly like "not paid".
  const failure = t.status === "open" ? t.error : null;
  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <div className="flex items-center gap-2">
        <span className="label min-w-0 flex-1 truncate !text-[9px] text-muted">
          PayPal · {t.paypalStatus ?? "unknown"}
          {t.checkedAt ? ` · checked ${ago(t.checkedAt, nowMs)}` : " · not checked yet"}
        </span>
        {t.status === "open" && (
          <button
            type="button"
            onClick={check}
            disabled={busy}
            className="press shrink-0 rounded-full border border-line bg-surface px-2.5 py-[5px] font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-ink-soft shadow-sm hover:text-ink disabled:opacity-60"
          >
            {busy ? "Checking…" : "Check payment now"}
          </button>
        )}
      </div>
      {failure && !note && <div className="mt-1.5 text-[12px] leading-snug text-red-text">{failure}</div>}
      {note && <div className={`mt-1.5 text-[12px] leading-snug ${note.tone === "bad" ? "text-red-text" : "text-muted"}`}>{note.text}</div>}
    </div>
  );
}

/** An uploaded receipt, filed as evidence. */
function Exhibit({ m }: { m: ChatMessage }) {
  const r = m.data?.receipt?.extracted;
  const rows: [string, string, boolean][] = r?.is_receipt
    ? [
        ["Merchant", r.merchant ?? "—", false],
        ["Total", r.total != null ? `${r.total.toFixed(2)} ${r.currency ?? ""}`.trim() : "unclear", true],
        ["Date", r.date ?? "—", true],
        ["Items", String(r.items?.length ?? 0), true],
      ]
    : [];
  return (
    <div className="w-64 max-w-full rounded-[18px] border border-line bg-surface p-2 shadow-md">
      <div className="relative overflow-hidden rounded-[12px]">
        <img src={m.data.image} alt="Receipt" className="block max-h-64 w-full object-cover" />
        <span className="label absolute left-2 top-2 rounded-full bg-[#111113]/80 px-2.5 py-1 !text-[9.5px] text-white backdrop-blur">
          Exhibit {m.data?.receipt?.id ?? "·"}
        </span>
        {r && !r.is_receipt && (
          <span className="absolute right-2 top-2">
            <Stamp tone="red" size="xs" className="bg-surface">
              Not a receipt
            </Stamp>
          </span>
        )}
        {m.data.scanning && (
          <div className="absolute inset-x-2 bottom-2 flex items-center justify-between rounded-full bg-[#111113]/80 px-3 py-1.5 backdrop-blur">
            <span className="label !text-[9.5px] text-white">Analysing evidence</span>
            <span className="flex gap-1">
              <span className="dot h-1 w-1 rounded-full bg-white" />
              <span className="dot h-1 w-1 rounded-full bg-white" />
              <span className="dot h-1 w-1 rounded-full bg-white" />
            </span>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div className="divide-y divide-line px-2 pb-0.5 pt-1.5">
          {rows.map(([k, v, mono]) => (
            <div key={k} className="flex items-center justify-between gap-3 py-[6px] text-[13px]">
              <span className="label !text-[9.5px] text-muted">{k}</span>
              <span className={`truncate ${mono ? "tabular font-mono font-medium" : "font-medium"} ${k === "Total" ? "font-semibold" : ""}`}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageList({
  messages,
  speakerId,
  typing,
  liveTransfers,
  fresh,
  onSettle,
  onCheck,
}: {
  messages: ChatMessage[];
  speakerId: number | null;
  typing: boolean;
  liveTransfers: Map<number, Transfer>;
  fresh: Set<number>;
  onSettle: (transferId: number) => void;
  onCheck: (transferId: number) => Promise<PaymentCheckResult | null>;
}) {
  const end = useRef<HTMLDivElement>(null);
  const firstScroll = useRef(true);
  useEffect(() => {
    // Scroll the chat's scroller to its very end (the composer sits inside it, so aligning the
    // last message with the viewport bottom would leave it hidden behind the composer).
    const scroller = end.current?.closest("main");
    const toEnd = (behavior: ScrollBehavior) => scroller?.scrollTo({ top: scroller.scrollHeight, behavior });
    // Jump straight there when the chat opens; animate only for new messages after that.
    const first = firstScroll.current;
    firstScroll.current = false;
    toEnd(first ? "auto" : "smooth");
    if (!first) return;
    // Receipt photos and the entry animation change the height after the first scroll:
    // stay pinned to the bottom while the log settles (first ~2 s only).
    const list = end.current?.parentElement;
    if (!list) return;
    const ro = new ResizeObserver(() => toEnd("auto"));
    ro.observe(list);
    const id = setTimeout(() => ro.disconnect(), 2000);
    return () => {
      clearTimeout(id);
      ro.disconnect();
    };
  }, [messages.length, typing, messages[messages.length - 1]?.data?.scanning]);

  return (
    <div className="space-y-5 px-4 pb-6 pt-5">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const grouped =
          prev && prev.role === m.role && prev.authorId === m.authorId && prev.kind !== "clock" && m.createdAt - prev.createdAt < 5 * 60_000;

        if (m.role === "system") {
          if (m.kind === "error") {
            return (
              <div key={m.id} className="animate-rise mx-auto flex max-w-[94%] gap-2.5 rounded-2xl border border-red/30 bg-red-soft px-3.5 py-2.5 text-[13px] text-red-text">
                <span className="label shrink-0 pt-[2px] !text-[9.5px]">Error</span>
                <span className="whitespace-pre-wrap break-words">{m.content}</span>
              </div>
            );
          }
          return (
            <div key={m.id} className="animate-rise flex flex-col items-center gap-1">
              <div className="flex max-w-[92%] items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 shadow-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.kind === "clock" ? "bg-amber" : "bg-muted"}`} />
                <span className="truncate text-[11.5px] text-ink-soft">
                  <Figures text={m.content} />
                </span>
                <span className="tabular shrink-0 font-mono text-[10px] text-muted">{time(m.createdAt)}</span>
              </div>
              {m.data?.cards?.map((c: any, k: number) => (
                <div key={k} className="w-full max-w-[92%]">
                  <CardView card={c} liveTransfers={liveTransfers} fresh={fresh} />
                </div>
              ))}
            </div>
          );
        }

        if (m.role === "agent") {
          return (
            <div key={m.id} className={`animate-rise flex gap-2.5 ${grouped ? "-mt-3" : ""}`}>
              <div className="w-7 shrink-0 pt-[22px]">{!grouped && <AppIcon size={28} />}</div>
              <div className="min-w-0 max-w-[88%] flex-1">
                {!grouped && (
                  <Meta>
                    <span className="text-red-text">The Collector</span> · {time(m.createdAt)}
                  </Meta>
                )}
                {m.kind === "nudge" ? (
                  <Notice m={m} live={liveTransfers} fresh={fresh} />
                ) : m.kind === "settle_request" ? (
                  <SettleRequest m={m} live={liveTransfers} fresh={fresh} onSettle={onSettle} onCheck={onCheck} />
                ) : m.content ? (
                  <div className="inline-block rounded-[18px] rounded-tl-[6px] border border-line bg-surface px-4 py-2.5 text-[15px] leading-[1.45] shadow-sm">
                    <RichText text={m.content} />
                  </div>
                ) : null}
                {m.data?.cards?.map((c: any, k: number) => <CardView key={k} card={c} liveTransfers={liveTransfers} fresh={fresh} />)}
              </div>
            </div>
          );
        }

        const mine = m.authorId !== null && m.authorId === speakerId;
        const name = m.authorName ?? "Unknown";
        return (
          <div key={m.id} className={`animate-rise flex flex-col items-end ${grouped ? "-mt-3" : ""}`}>
            {!grouped && (
              <Meta align="right">
                {mine ? `${name} · you` : name} · {time(m.createdAt)}
              </Meta>
            )}
            <div className="flex max-w-[82%] flex-col items-end gap-1.5">
              {m.data?.image && <Exhibit m={m} />}
              {!(m.data?.image && m.content === "(sent a receipt)") && (
                <div
                  className={`whitespace-pre-wrap rounded-[18px] rounded-tr-[6px] px-4 py-2.5 text-[15px] leading-[1.45] ${
                    mine ? "bg-own text-own-fg shadow-sm" : "bg-other text-ink"
                  }`}
                >
                  <Figures text={m.content} />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {typing && (
        <div className="animate-rise flex items-center gap-2.5">
          <AppIcon size={28} />
          <div className="flex items-center gap-2.5 rounded-[18px] rounded-tl-[6px] border border-line bg-surface px-4 py-3 shadow-sm">
            <span className="flex gap-1">
              <span className="dot h-1.5 w-1.5 rounded-full bg-red" />
              <span className="dot h-1.5 w-1.5 rounded-full bg-red" />
              <span className="dot h-1.5 w-1.5 rounded-full bg-red" />
            </span>
            <span className="label !text-[9.5px] text-muted">Reviewing the file</span>
          </div>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
