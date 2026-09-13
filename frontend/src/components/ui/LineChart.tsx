import { useMemo, useState } from "react";

export interface LineChartSeries {
  label: string;
  color: string;
  points: { x: number; y: number }[];
}

// A small hand-rolled SVG line chart — no charting library, so it can match
// the app's own color tokens and stay consistent with everything else here
// instead of fighting a library's default look. Multiple series share one
// y-scale (so e.g. "active" vs "max connections" compare directly) and the
// x-axis is always time, plotted left-to-right oldest-to-newest.
export function LineChart({
  series,
  height = 96,
  formatValue = (v) => String(Math.round(v)),
  formatX,
  emptyLabel = "No data yet",
}: {
  series: LineChartSeries[];
  height?: number;
  formatValue?: (v: number) => string;
  formatX?: (x: number) => string;
  emptyLabel?: string;
}) {
  const width = 480;
  const padding = { top: 8, right: 8, bottom: 4, left: 8 };
  const [hover, setHover] = useState<{ x: number; index: number } | null>(null);

  const { minX, maxX, minY, maxY, allPoints } = useMemo(() => {
    const pts = series.flatMap((s) => s.points);
    if (pts.length === 0) {
      return { minX: 0, maxX: 1, minY: 0, maxY: 1, allPoints: pts };
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const yMax = Math.max(...ys, 1);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: 0, maxY: yMax * 1.15, allPoints: pts };
  }, [series]);

  const hasData = allPoints.length > 1;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  function sx(x: number) {
    if (maxX === minX) return padding.left + innerW / 2;
    return padding.left + ((x - minX) / (maxX - minX)) * innerW;
  }
  function sy(y: number) {
    if (maxY === minY) return padding.top + innerH / 2;
    return padding.top + innerH - ((y - minY) / (maxY - minY)) * innerH;
  }

  function pathFor(points: { x: number; y: number }[]) {
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  }

  if (!hasData) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-[11px] text-text-quiet">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className="overflow-visible"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * width;
          const ref = series.find((s) => s.points.length > 0)?.points ?? [];
          if (ref.length === 0) return;
          let best = 0;
          let bestDist = Infinity;
          ref.forEach((p, i) => {
            const d = Math.abs(sx(p.x) - relX);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          });
          setHover({ x: sx(ref[best].x), index: best });
        }}
      >
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + innerH * f}
            y2={padding.top + innerH * f}
            stroke="var(--color-border-default)"
            strokeWidth={1}
          />
        ))}
        {series.map((s) => (
          <path key={s.label} d={pathFor(s.points)} fill="none" stroke={s.color} strokeWidth={1.5} />
        ))}
        {hover && (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke="var(--color-border-focus)"
            strokeWidth={1}
          />
        )}
        {hover &&
          series.map((s) => {
            const p = s.points[hover.index];
            if (!p) return null;
            return <circle key={s.label} cx={sx(p.x)} cy={sy(p.y)} r={2.5} fill={s.color} />;
          })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute top-0 flex -translate-x-1/2 flex-col gap-0.5 rounded-[6px] border border-border-elevated bg-bg-raised px-2 py-1.5 text-[10.5px] shadow-lg" style={{ left: (hover.x / width) * 100 + "%" }}>
          {formatX && (
            <div className="font-mono text-text-faint">{formatX(series.find((s) => s.points[hover!.index])?.points[hover.index]?.x ?? 0)}</div>
          )}
          {series.map((s) => {
            const p = s.points[hover.index];
            if (!p) return null;
            return (
              <div key={s.label} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-text-muted">{s.label}</span>
                <span className="font-mono font-medium text-text-primary">{formatValue(p.y)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
