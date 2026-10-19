import { useEffect, useRef, useState } from "react";
import { fmt } from "./ui";

export interface Series {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * Grafik garis kecil: satu sumbu-y, garis 2px, titik 8px dengan cincin permukaan,
 * garis bantu tipis, tooltip saat disentuh, label langsung di ujung garis.
 */
export function LineChart({
  series,
  xLabels,
  tooltipTitles,
  unit,
  refLine,
  height = 180,
  yMin,
  yMaxHint,
}: {
  series: Series[];
  xLabels: string[];
  tooltipTitles?: string[];
  unit: string;
  refLine?: { value: number; label: string };
  height?: number;
  yMin?: number;
  yMaxHint?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = xLabels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const lo = yMin ?? 0;
  const hi = niceMax(Math.max(...all, refLine?.value ?? 0, yMaxHint ?? 0, lo + 1));
  const pad = { top: 10, right: 44, bottom: 22, left: 34 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => pad.top + h - ((v - lo) / (hi - lo)) * h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(w / 46)));

  const pointerToIndex = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = clientX - rect.left - pad.left;
    return Math.max(0, Math.min(n - 1, Math.round((px / w) * (n - 1))));
  };

  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  return (
    <div
      className="chart"
      ref={ref}
      onPointerMove={(e) => setHover(pointerToIndex(e.clientX))}
      onPointerDown={(e) => setHover(pointerToIndex(e.clientX))}
      onPointerLeave={() => setHover(null)}
    >
      <svg height={height} role="img" aria-label={series.map((s) => s.label).join(", ")}>
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((t) => (
            <text key={t} x={pad.left - 6} y={y(t) + 4} textAnchor="end">
              {fmt(t, 1)}
            </text>
          ))}
          {xLabels.map((l, i) =>
            i === n - 1 || (i % labelEvery === 0 && n - 1 - i >= labelEvery) ? (
              <text key={i} x={x(i)} y={height - 6} textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
        </g>
        {refLine && (
          <>
            <line className="ref" x1={pad.left} x2={pad.left + w} y1={y(refLine.value)} y2={y(refLine.value)} />
            <text className="ref-label" x={pad.left + 2} y={y(refLine.value) - 4}>
              {refLine.label}
            </text>
          </>
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + h} stroke="var(--muted)" strokeWidth={1} />}
        {series.map((s) => (
          <g key={s.key}>
            <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) =>
              v === null ? null : (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(v)}
                  r={hover === i ? 5 : 4}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ),
            )}
          </g>
        ))}
        {series.map((s) => {
          const lastIndex = (vals: (number | null)[]) => vals.reduce<number>((acc, v, i) => (v === null ? acc : i), -1);
          const last = lastIndex(s.values);
          if (last < 0 || series.length > 2) return null;
          // Label ujung yang berdekatan tidak ditumpuk; legenda + tooltip yang membawa nilainya.
          const crowded = series.some((o) => {
            if (o === s) return false;
            const j = lastIndex(o.values);
            return j === last && Math.abs(y(o.values[j]!) - y(s.values[last]!)) < 14;
          });
          if (crowded) return null;
          return (
            <text key={s.key} className="label" x={x(last) + 8} y={y(s.values[last]!) + 4}>
              {fmt(s.values[last])}
              {unit === "%" ? "%" : ""}
            </text>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="chart-tooltip"
          style={{ left: Math.min(Math.max(x(hover) - 70, 0), width - 150), top: 0 }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{tooltipTitles?.[hover] ?? xLabels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="row" style={{ gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: s.color, display: "inline-block" }} />
              <span className="secondary">{s.label}</span>
              <strong style={{ marginLeft: "auto" }}>
                {s.values[hover] === null ? "–" : `${fmt(s.values[hover], 1)} ${unit}`}
              </strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
