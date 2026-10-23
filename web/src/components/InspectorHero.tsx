import { motion } from "framer-motion";

/*
 * Home-screen hero: a heavy-set bulldog enforcer (inspector's fedora, dark trench coat,
 * gold fang) leaning on "The Debt Collector" nameplate, glaring like he wants your money.
 * Two SVG layers share one viewBox: the dog (behind the sign) and his paws (in front of it),
 * so he genuinely grips the sign's top edge.
 */

const VB = "0 0 300 190"; // the sign's top edge sits at y≈162 in this viewBox
const FUR = "#C28B57";
const FUR_DARK = "#8A5730";
const FUR_DEEP = "#5E3A1E";
const MUZZLE = "#EACBA0";
const COAT = "#3B424D";
const COAT_DARK = "#2C323B";
const INK = "#1A1A1E";
const RED = "#E5484D";
const GOLD = "#E2B33F";

const LAND = { type: "spring" as const, stiffness: 420, damping: 15, mass: 1.1, delay: 0.1 };

/** Thick arms, spread wide along the top of the sign. */
function Arms() {
  return (
    <>
      {/* upper arms bulge up from the shoulders, then run out to the paws */}
      <path d="M112 150 C92 132 64 136 44 158" stroke={COAT_DARK} strokeWidth="26" fill="none" strokeLinecap="round" />
      <path d="M188 150 C208 132 236 136 256 158" stroke={COAT_DARK} strokeWidth="26" fill="none" strokeLinecap="round" />
      {/* seam highlights so they read as heavy sleeves */}
      <path d="M100 136 C84 134 70 140 60 148" stroke={COAT} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.9" />
      <path d="M200 136 C216 134 230 140 240 148" stroke={COAT} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.9" />
    </>
  );
}

/** Body, head and hat. Sits behind the sign. */
function Dog() {
  return (
    <>
      {/* broad shoulders in a dark trench coat */}
      <path d="M70 190 C72 150 104 128 150 128 C196 128 228 150 230 190 Z" fill={COAT} />
      <path d="M134 128 L150 162 L166 128 Z" fill="#F4F1EA" />
      <path d="M146 132 L154 132 L156 144 L150 166 L144 144 Z" fill={RED} />
      <path d="M134 128 L114 168" stroke={COAT_DARK} strokeWidth="3" strokeLinecap="round" />
      <path d="M166 128 L186 168" stroke={COAT_DARK} strokeWidth="3" strokeLinecap="round" />
      {/* thick neck */}
      <path d="M122 112 L178 112 L176 134 L124 134 Z" fill={FUR_DARK} />

      <g transform="translate(150 96) scale(1.14) translate(-150 -96)">
      {/* small folded rose ears */}
      <path d="M108 66 C96 58 88 66 92 80 C100 78 106 76 112 74 Z" fill={FUR_DEEP} />
      <path d="M192 66 C204 58 212 66 208 80 C200 78 194 76 188 74 Z" fill={FUR_DEEP} />

      {/* huge, wide head */}
      <path d="M102 88 C102 60 122 46 150 46 C178 46 198 60 198 88 C198 112 186 126 150 128 C114 126 102 112 102 88 Z" fill={FUR} />
      {/* forehead furrows */}
      <path d="M136 62 C142 59 158 59 164 62" stroke={FUR_DARK} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M140 67 C145 65 155 65 160 67" stroke={FUR_DARK} strokeWidth="2" fill="none" strokeLinecap="round" />

      {/* narrowed, glaring eyes (with a slow, unimpressed blink) */}
      <motion.g
        style={{ transformOrigin: "150px 82px" }}
        animate={{ scaleY: [1, 1, 0.12, 1, 1] }}
        transition={{ duration: 5, times: [0, 0.9, 0.93, 0.96, 1], repeat: Infinity, delay: 1.6 }}
      >
        <path d="M119 82.5 C123 75.5 135 75 141 81 C135 87.5 123 87.5 119 82.5 Z" fill="#FFF8EA" />
        <path d="M181 82.5 C177 75.5 165 75 159 81 C165 87.5 177 87.5 181 82.5 Z" fill="#FFF8EA" />
        <circle cx="134.5" cy="81.8" r="3.8" fill={INK} />
        <circle cx="165.5" cy="81.8" r="3.8" fill={INK} />
        <circle cx="135" cy="80.4" r="0.9" fill="#fff" />
        <circle cx="167" cy="80.4" r="0.9" fill="#fff" />
      </motion.g>
      {/* heavy angry brows, slammed down toward the nose */}
      <path d="M114 70 L144 79 L143 84 L116 77 Z" fill={FUR_DEEP} />
      <path d="M186 70 L156 79 L157 84 L184 77 Z" fill={FUR_DEEP} />

      {/* big jowly muzzle */}
      <path d="M112 104 C112 94 130 89 150 91 C170 89 188 94 188 104 C190 122 174 134 150 134 C126 134 110 122 112 104 Z" fill={MUZZLE} />
      {/* wide nose */}
      <ellipse cx="150" cy="98" rx="12" ry="7.5" fill={INK} />
      <ellipse cx="146" cy="95.6" rx="3.6" ry="1.8" fill="#fff" opacity="0.45" />
      <path d="M150 105 L150 111" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      {/* underbite: jutting lower jaw, two fangs (one gold), a mean frown */}
      <path d="M124 118 C134 136 166 136 176 118 C168 124 132 124 124 118 Z" fill={FUR_DARK} />
      <path d="M118 116 C132 109 168 109 182 116" stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      {/* fangs rising from the jutting jaw (one gold) */}
      <path d="M128.5 118 C129.5 112 131.5 107 135.5 103.5 C136 109 137.5 114 140.5 118.5 Z" fill="#FFF8EA" />
      <path d="M131 116 C131.8 112 133.2 108.5 135.2 106" stroke="#D9CDB8" strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M171.5 118 C170.5 112 168.5 107 164.5 103.5 C164 109 162.5 114 159.5 118.5 Z" fill={GOLD} />
      <path d="M168.6 115 C168 111.5 166.8 108.5 165.2 106.2" stroke="#FFF3C4" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* stubble dots on the jowls */}
      {[
        [124, 104],
        [128, 108],
        [122, 110],
        [176, 104],
        [172, 108],
        [178, 110],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill={FUR_DARK} />
      ))}

      {/* fedora pulled low and tilted */}
      <g transform="rotate(-6 150 60)">
        <path d="M117 64 C117 38 128 27 140 26 C145 25.5 147 31 150 31 C153 31 155 25.5 160 26 C172 27 183 38 183 64 Z" fill={INK} stroke="var(--hat-edge)" strokeWidth="1.2" />
        <rect x="117" y="51" width="66" height="8.5" fill={RED} />
        <path d="M88 66 C112 55 188 55 212 66 C214 69.5 210 72.5 202 71.5 C176 67.5 124 67.5 98 71.5 C90 72.5 86 69.5 88 66 Z" fill={INK} stroke="var(--hat-edge)" strokeWidth="1.2" />
      </g>
      </g>
    </>
  );
}

/** Big meaty paws slammed onto the sign's top edge. */
function Paws() {
  const paw = (cx: number) => (
    <g>
      <ellipse cx={cx} cy="160" rx="19" ry="12" fill={FUR} />
      <ellipse cx={cx} cy="163.5" rx="14" ry="6.5" fill={MUZZLE} opacity="0.5" />
      {/* knuckles + claws */}
      <path d={`M${cx - 8} 153 L${cx - 8} 163 M${cx} 151.5 L${cx} 164 M${cx + 8} 153 L${cx + 8} 163`} stroke={FUR_DEEP} strokeWidth="1.8" strokeLinecap="round" />
      {[-12, -4, 4, 12].map((dx) => (
        <path key={dx} d={`M${cx + dx - 1.6} 170 L${cx + dx} 174.5 L${cx + dx + 1.6} 170 Z`} fill={INK} />
      ))}
    </g>
  );
  return (
    <>
      {paw(40)}
      {paw(260)}
    </>
  );
}

/**
 * full    - the bulldog grips the sign (first visits).
 * hiding  - he lets go and ducks down behind the sign.
 * tucked  - he's gone; his space collapses so the sign can glide up (returning from a chat).
 */
export type HeroPhase = "full" | "hiding" | "tucked";

export const GLIDE = { type: "spring" as const, stiffness: 230, damping: 30, mass: 0.9 };

export function InspectorHero({
  title = "The Debt Collector",
  phase = "full",
  entrance = true,
}: {
  title?: string;
  phase?: HeroPhase;
  /** Play the landing entrance (first visit). Off when Home is entered to tuck him away. */
  entrance?: boolean;
}) {
  const away = phase !== "full";
  return (
    <motion.div
      layout
      transition={GLIDE}
      className="relative mx-auto w-full max-w-[330px]"
      role="img"
      aria-label={away ? `A sign that reads ${title}` : `A bulldog enforcer in a fedora glaring over a sign that reads ${title}`}
    >
      {/* the dog: clipped at the sign's top edge, so ducking down means vanishing behind it */}
      <motion.div
        layout
        transition={GLIDE}
        className="relative mx-auto w-[300px] max-w-full overflow-hidden"
        style={{ height: phase === "tucked" ? 0 : 166 }}
      >
        <motion.svg
          viewBox={VB}
          className="absolute left-0 top-0 h-[190px] w-[300px] overflow-visible"
          aria-hidden
          initial={entrance ? { y: 56, opacity: 0 } : false}
          animate={away ? { y: 175, opacity: 1 } : { y: 0, opacity: 1 }}
          transition={away ? { duration: 0.42, delay: 0.12, ease: [0.55, 0, 0.85, 0.3] } : LAND}
        >
          <Arms />
          <Dog />
        </motion.svg>
      </motion.div>

      {/* the nameplate: jolts when the paws land; glides up when he's gone */}
      <motion.div
        layout
        transition={GLIDE}
        className="relative z-10 -mt-[4px] rounded-[18px] bg-ink px-5 pb-4 pt-5 text-center text-own-fg shadow-lg"
      >
        <motion.div
          initial={false}
          animate={entrance && phase === "full" ? { y: [0, 0, 5, -1.5, 0], rotate: [0, 0, 0.8, -0.3, 0] } : { y: 0, rotate: 0 }}
          transition={{ duration: 0.6, times: [0, 0.28, 0.42, 0.62, 1], delay: 0.1 }}
        >
          {["left-2.5 top-2.5", "right-2.5 top-2.5", "left-2.5 bottom-2.5", "right-2.5 bottom-2.5"].map((pos) => (
            <span key={pos} aria-hidden className={`absolute ${pos} h-1.5 w-1.5 rounded-full bg-own-fg/25`} />
          ))}
          <div className="font-mono text-[25px] font-semibold leading-tight tracking-[-0.02em]">{title}</div>
          <div className="mt-1.5 flex items-center justify-center gap-2">
            <span className="h-px w-6 bg-red" />
            <span className="label !text-[9px] text-own-fg/60">Collections division</span>
            <span className="h-px w-6 bg-red" />
          </div>
        </motion.div>
      </motion.div>

      {/* paws on the sign's edge: they let go first, then he ducks */}
      <div className="pointer-events-none absolute left-1/2 top-0 z-20 h-[190px] w-[300px] -translate-x-1/2">
        <motion.svg
          viewBox={VB}
          className="h-full w-full overflow-visible"
          aria-hidden
          initial={entrance ? { y: 56, opacity: 0 } : false}
          animate={away ? { y: 26, opacity: 0 } : { y: 0, opacity: 1 }}
          transition={away ? { duration: 0.22, ease: "easeIn" } : LAND}
        >
          <Paws />
        </motion.svg>
      </div>
    </motion.div>
  );
}
