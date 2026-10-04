"use client";

/** Polar → cartesian for SVG arc endpoints. */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  // sweep-flag 1 = clockwise (matches top-start progress rings)
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

interface SparkSegmentRingProps {
  available: number;
  max?: number;
  infinite?: boolean;
  className?: string;
}

/** Segmented ring — one lit arc per available Spark (default max 4). */
export default function SparkSegmentRing({
  available,
  max = 4,
  infinite = false,
  className,
}: SparkSegmentRingProps) {
  const size = 100;
  const cx = 50;
  const cy = 50;
  const r = 38;
  const gapDeg = 14;
  const slotCount = Math.max(1, Math.floor(max));
  const lit = infinite ? slotCount : Math.max(0, Math.min(slotCount, Math.floor(available)));
  const sweep = (360 - gapDeg * slotCount) / slotCount;

  const segments = Array.from({ length: slotCount }, (_, i) => {
    const start = i * (sweep + gapDeg) + gapDeg / 2;
    const end = start + sweep;
    return {
      d: arcPath(cx, cy, r, start, end),
      filled: infinite || i < lit,
    };
  });

  return (
    <span className={`spark-segment-ring${className ? ` ${className}` : ""}`}>
      <svg
        className="spark-segment-ring__svg"
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        height="100%"
        aria-hidden
      >
        {segments.map((seg, i) => (
          <path
            key={i}
            d={seg.d}
            className={
              seg.filled
                ? "spark-segment-ring__arc spark-segment-ring__arc--on"
                : "spark-segment-ring__arc spark-segment-ring__arc--off"
            }
            fill="none"
            strokeLinecap="round"
          />
        ))}
      </svg>
      <span className="spark-segment-ring__bolt" aria-hidden>
        {infinite ? "∞" : "⚡"}
      </span>
    </span>
  );
}
