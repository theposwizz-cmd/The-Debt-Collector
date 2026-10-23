import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * A button that feels like a physical key: raised at rest (bottom lip + soft shadow),
 * lifts on hover, sinks on press with a springy settle, and a faint ripple from the touch
 * point. Reduced motion is handled globally by <MotionConfig reducedMotion="user">.
 */
export function PressButton({
  children,
  sub,
  icon,
  variant = "primary",
  disabled,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const next = useRef(0);
  const primary = variant === "primary";

  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onPointerDown={(e) => {
        if (disabled) return;
        const r = e.currentTarget.getBoundingClientRect();
        const id = next.current++;
        setRipples((list) => [...list, { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
      }}
      whileHover={disabled ? undefined : { y: -1.5 }}
      whileTap={disabled ? undefined : { scale: 0.96, y: 2 }}
      transition={{ type: "spring", stiffness: 520, damping: 26, mass: 0.6 }}
      className={`relative flex w-full select-none items-center gap-3.5 overflow-hidden rounded-[20px] px-5 text-left outline-none focus-visible:ring-4 focus-visible:ring-red/25 disabled:cursor-not-allowed disabled:opacity-50 ${
        primary ? "key bg-ink text-own-fg" : "key2 bg-surface text-ink"
      } ${sub ? "py-3.5" : "py-4"} ${className}`}
    >
      {/* faint top highlight so it reads as a raised key */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
        style={{ background: `linear-gradient(${primary ? "var(--key-hl)" : "var(--key2-hl)"}, transparent)` }}
      />
      {icon && <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">{icon}</span>}
      <span className="relative min-w-0 flex-1">
        <span className="block font-mono text-[13.5px] font-semibold uppercase tracking-[0.08em]">{children}</span>
        {sub && <span className={`mt-0.5 block truncate text-[12.5px] ${primary ? "text-own-fg/65" : "text-muted"}`}>{sub}</span>}
      </span>
      <span aria-hidden className={`relative font-mono text-[15px] ${primary ? "text-own-fg/70" : "text-muted"}`}>
        →
      </span>

      {/* touch ripple */}
      <AnimatePresence>
        {ripples.map((r) => (
          <motion.span
            key={r.id}
            aria-hidden
            className={`pointer-events-none absolute h-24 w-24 rounded-full ${primary ? "bg-white/25" : "bg-ink/10"}`}
            style={{ left: r.x - 48, top: r.y - 48 }}
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 3.2, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.2, 0.7, 0.2, 1] }}
            onAnimationComplete={() => setRipples((list) => list.filter((x) => x.id !== r.id))}
          />
        ))}
      </AnimatePresence>
    </motion.button>
  );
}
