import { useLayoutEffect, useMemo, useRef, useState } from "react";

export interface BalanceHistory {
  members: string[];
  points: { t: number; label: string; values: number[] }[];
}

const SERIES = 8;
const seriesColor = (i: number) => `var(--series-${(i % SERIES) + 1})`;

const H = 196;
const PAD_TOP = 16;
const PAD_BOTTOM = 26;
const GUTTER = 66; // right side, for direct labels at line ends
const LEFT = 46; // left side, for y-axis values
const LABEL_GAP = 13;

/** Monotone cubic (Fritsch–Carlson): smooth, but never overshoots between points. */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  m.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += ` C${x0 + h},${y0 + m[i] * h} ${x1 - h},${y1 - m[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

/** Push end labels apart so they never overlap, keeping them inside the plot height. */
function spreadLabels(ys: { i: number; y: number }[], top: number, bottom: number) {
  const sorted = [...ys].sort((a, b) => a.y - b.y);
  for (let k = 1; k < sorted.length; k++) sorted[k].y = Math.max(sorted[k].y, sorted[k - 1].y + LABEL_GAP);
  const overflow = sorted.length ? sorted[sorted.length - 1].y - bottom : 0;
  if (overflow > 0) for (const s of sorted) s.y -= overflow;
  for (let k = sorted.length - 2; k >= 0; k--) sorted[k].y = Math.min(sorted[k].y, sorted[k + 1].y - LABEL_GAP);
  if (sorted.length && sorted[0].y < top) {
    const shift = top - sorted[0].y;
    for (const s of sorted) s.y += shift;
  }
  return new Map(sorted.map((s) => [s.i, s.y]));
}

export function BalanceChart({ history, currency }: { history: BalanceHistory; currency: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(220, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fmt = useMemo(() => {
    const nf = new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 });
    const nf0 = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
    return {
      full: (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${nf.format(Math.abs(c) / 100)}`,
      short: (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${nf0.format(Math.abs(c) / 100)}`,
    };
  }, [currency]);

  const { members, points } = history;
  if (points.length < 2 || members.length === 0) {
    return <div className="rounded-xl bg-surface-2 px-3 py-6 text-center text-[13px] text-muted">Nothing to chart yet. Add an expense first.</div>;
  }

  // Scales
  const plotW = width - GUTTER - LEFT;
  const all = points.flatMap((p) => p.values);
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  if (hi - lo < 100) {
    hi += 50;
    lo -= 50;
  }
  const pad = (hi - lo) * 0.08;
  hi += pad;
  lo -= pad;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const x = (i: number) => LEFT + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD_TOP + ((hi - v) / (hi - lo)) * plotH;

  const series = members.map((name, s) => ({
    name,
    color: seriesColor(s),
    pts: points.map((p, i) => [x(i), y(p.values[s])] as [number, number]),
    last: points[points.length - 1].values[s],
  }));
  const labelY = spreadLabels(
    series.map((sr, i) => ({ i, y: sr.pts[sr.pts.length - 1][1] })),
    PAD_TOP,
    H - PAD_BOTTOM,
  );

  const day = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const i = Math.round((Math.min(Math.max(px - LEFT, 0), plotW) / plotW) * (points.length - 1));
    setHover(i);
  };

  const hp = hover !== null ? points[hover] : null;
  // Tooltip sits on the far side of the crosshair so the inspected point stays visible.
  const tipLeft =
    hover !== null ? Math.min(Math.max(x(hover) < LEFT + plotW / 2 ? x(hover) + 14 : x(hover) - 194, 0), width - 180) : 0;

  return (
    <div ref={wrap} className="relative select-none">
      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        className="block touch-pan-y overflow-visible"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Balance over time for ${members.join(", ")}`}
      >
        {/* recessive grid: data max, zero, data min; values in the left gutter */}
        {[hi - pad, lo + pad].map((v, k) =>
          Math.abs(v) < 1 ? null : (
            <g key={k}>
              <line x1={LEFT} x2={LEFT + plotW} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="2 4" />
              <text x={LEFT - 8} y={y(v) + 3.5} textAnchor="end" className="fill-muted font-mono text-[9.5px]">
                {fmt.short(v)}
              </text>
            </g>
          ),
        )}
        <line x1={LEFT} x2={LEFT + plotW} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeOpacity={0.45} />
        <text x={LEFT - 8} y={y(0) + 3.5} textAnchor="end" className="fill-muted font-mono text-[9.5px]">
          {fmt.short(0).replace(/^[+−]/, "")}
        </text>

        {/* x axis: first and last date */}
        <text x={LEFT} y={H - 6} className="fill-muted font-mono text-[9.5px]">
          {day(points[0].t)}
        </text>
        <text x={LEFT + plotW} y={H - 6} textAnchor="end" className="fill-muted font-mono text-[9.5px]">
          {day(points[points.length - 1].t)}
        </text>

        {/* crosshair */}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD_TOP - 6} y2={H - PAD_BOTTOM} stroke="var(--ink)" strokeOpacity={0.25} />}

        {/* lines */}
        {series.map((sr) => (
          <path
            key={sr.name}
            d={smoothPath(sr.pts)}
            pathLength={1}
            className="chart-draw"
            fill="none"
            stroke={sr.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* end markers + direct labels (text in ink tokens; the colored mark carries identity) */}
        {series.map((sr, i) => {
          const [ex, ey] = sr.pts[sr.pts.length - 1];
          const ly = labelY.get(i) ?? ey;
          return (
            <g key={sr.name}>
              <circle cx={ex} cy={ey} r={4} fill={sr.color} stroke="var(--surface)" strokeWidth={2} />
              {Math.abs(ly - ey) > 2 && <line x1={ex + 5} y1={ey} x2={ex + 9} y2={ly} stroke="var(--line)" />}
              <text x={ex + 11} y={ly + 3.5} className="fill-ink-soft text-[11px] font-medium">
                {sr.name}
              </text>
            </g>
          );
        })}

        {/* hover markers */}
        {hover !== null &&
          series.map((sr) => (
            <circle key={sr.name} cx={sr.pts[hover][0]} cy={sr.pts[hover][1]} r={4} fill={sr.color} stroke="var(--surface)" strokeWidth={2} />
          ))}
      </svg>

      {/* tooltip */}
      {hp && (
        <div
          className="animate-pop pointer-events-none absolute top-0 z-10 w-[180px] rounded-xl border border-line bg-surface px-3 py-2 shadow-lg"
          style={{ left: tipLeft, transformOrigin: "top center" }}
        >
          <div className="truncate text-[12px] font-semibold">{hp.label}</div>
          <div className="label mb-1.5 !text-[9px] text-muted">{day(hp.t)}</div>
          {members
            .map((name, s) => ({ name, s, v: hp.values[s] }))
            .sort((a, b) => b.v - a.v)
            .map(({ name, s, v }) => (
              <div key={name} className="flex items-center gap-2 py-[2px] text-[12px]">
                <span className="h-[3px] w-3 rounded-full" style={{ background: seriesColor(s) }} />
                <span className="flex-1 truncate text-ink-soft">{name}</span>
                <span className="tabular font-mono font-semibold text-ink">{fmt.full(v)}</span>
              </div>
            ))}
        </div>
      )}

      {/* table view for screen readers */}
      <div className="sr-only">
      <table>
        <caption>Balance after each entry</caption>
        <thead>
          <tr>
            <th>Entry</th>
            {members.map((m) => (
              <th key={m}>{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{p.label}</td>
              {p.values.map((v, s) => (
                <td key={s}>{fmt.full(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export { seriesColor };
