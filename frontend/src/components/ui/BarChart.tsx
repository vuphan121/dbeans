import { useMemo, useState } from "react";

// A small hand-rolled SVG bar chart, matching LineChart's approach (no
// library, app color tokens) — used where the underlying data really is a
// sequence of discrete samples (hourly stats snapshots) rather than a
// continuous signal, so a column per sample reads more honestly than a line.
export function BarChart({
  points,
  height = 64,
  formatValue = (v) => String(Math.round(v)),
  formatX,
  emptyLabel = "No data yet",
  compact = false,
}: {
  points: { x: number; y: number }[];
  height?: number;
  formatValue?: (v: number) => string;
  formatX?: (x: number) => string;
  emptyLabel?: string;
  compact?: boolean;
}) {
  const width = compact ? 140 : 380;
  const padding = compact ? { top: 1, bottom: 1 } : { top: 6, bottom: 4 };
  const gap = compact ? 1.5 : 2;
  const [hover, setHover] = useState<number | null>(null);

  const maxY = useMemo(() => Math.max(...points.map((p) => p.y), 1) * 1.1, [points]);
  const hasData = points.length > 0;
  const innerH = height - padding.top - padding.bottom;
  const barW = hasData ? (width - gap * (points.length - 1)) / points.length : 0;

  function barHeight(y: number) {
    return Math.max((y / maxY) * innerH, 1);
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
          const idx = Math.min(points.length - 1, Math.max(0, Math.floor(relX / (barW + gap))));
          setHover(idx);
        }}
      >
        {!compact &&
          [0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1={0}
              x2={width}
              y1={padding.top + innerH * f}
              y2={padding.top + innerH * f}
              stroke="var(--color-border-default)"
              strokeWidth={1}
            />
          ))}
        {points.map((p, i) => {
          const bh = barHeight(p.y);
          const x = i * (barW + gap);
          const y = padding.top + innerH - bh;
          const isLast = i === points.length - 1;
          const isHovered = hover === i;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={Math.max(barW, 0.5)}
              height={bh}
              rx={1}
              fill="var(--color-accent)"
              opacity={isHovered ? 1 : isLast ? 1 : 0.5}
            />
          );
        })}
      </svg>
      {hover != null && !compact && (
        <div
          className="pointer-events-none absolute top-0 flex -translate-x-1/2 flex-col gap-0.5 rounded-[6px] border border-border-elevated bg-bg-raised px-2 py-1.5 text-[10.5px] shadow-lg"
          style={{ left: ((hover * (barW + gap) + barW / 2) / width) * 100 + "%" }}
        >
          {formatX && <div className="font-mono text-text-faint">{formatX(points[hover].x)}</div>}
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="font-mono font-medium text-text-primary">{formatValue(points[hover].y)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
