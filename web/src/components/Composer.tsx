import { useEffect, useRef, useState } from "react";

// Apple-style emoji images (pinned CDN version) so chips look the same on every OS.
const EMOJI_CDN = "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64";
const CHIP_EMOJI: Record<string, string> = {
  "Settle up": "1f91d", // 🤝
  "Who owes the most?": "1f575-fe0f", // 🕵️
  "Show balances": "2696-fe0f", // ⚖️
  "Has everyone paid?": "1f4b8", // 💸
  "Who still owes me?": "1f9fe", // 🧾
  "I paid 600 for the villa, split evenly": "1f3e1", // 🏡
};

export function Composer({
  onSend,
  onChip,
  onImage,
  suggestions,
  disabled,
}: {
  onSend: (text: string) => void;
  onChip?: (text: string) => void;
  onImage: (file: File, caption: string) => void;
  suggestions: string[];
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="sticky bottom-0 z-10 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5">
      {/* Frosted layer: messages scrolling underneath blur, fading in from the top (no hard edge). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 bottom-0 bg-bg/60 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,transparent,black_40px)]"
      />
      <div className="relative">
      {suggestions.length > 0 && (
        <div className="no-scrollbar -mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3">
          {suggestions.map((s) => (
            <button
              key={s}
              disabled={disabled}
              onClick={() => (onChip ?? onSend)(s)}
              className="press flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface py-1.5 pl-2.5 pr-3.5 text-[13px] text-ink-soft shadow-sm hover:text-ink disabled:opacity-50"
            >
              {CHIP_EMOJI[s] && (
                <img
                  src={`${EMOJI_CDN}/${CHIP_EMOJI[s]}.png`}
                  alt=""
                  width={16}
                  height={16}
                  className="h-4 w-4"
                  draggable={false}
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              )}
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          onClick={() => file.current?.click()}
          disabled={disabled}
          className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-soft shadow-sm hover:text-ink disabled:opacity-50"
          aria-label="Submit receipt as evidence"
          title="Submit receipt as evidence"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </button>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImage(f, text.trim());
            setText("");
            e.target.value = "";
          }}
        />
        <div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-line bg-surface px-4 py-2.5 shadow-sm transition-shadow focus-within:border-red/40 focus-within:shadow-[0_0_0_4px_var(--red-soft)]">
          <textarea
            ref={area}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Message the Collector…"
            className="max-h-[140px] w-full resize-none bg-transparent text-[15px] leading-snug outline-none placeholder:text-muted"
          />
        </div>
        <button
          onClick={submit}
          disabled={disabled || !text.trim()}
          className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red text-white shadow-md disabled:bg-ink/15 disabled:text-muted disabled:shadow-none"
          aria-label="Send"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      </div>
    </div>
  );
}
