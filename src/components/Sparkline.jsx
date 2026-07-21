// ponytail: inline SVG polyline — no dep needed for a single line graph
//
// A null/undefined/NaN entry means "not measured at that point" and is drawn as
// a GAP, not as zero. Plotting a missing score at 0 would render an artificial
// crash for a domain that simply was not assessed in that check.
export default function Sparkline({ values, color = 'var(--accent)', height = 28 }) {
  if (!Array.isArray(values)) return null;
  const points = values.map((v) => (Number.isFinite(v) ? v : null));
  const measured = points.filter((v) => v !== null);
  // Need at least two real readings to draw a line.
  if (measured.length < 2) return null;

  const W = 100;
  const min = Math.min(...measured), max = Math.max(...measured);
  const ry = max - min || 1;
  const xy = (v, i) =>
    `${((i / Math.max(points.length - 1, 1)) * W).toFixed(1)},${(height - ((v - min) / ry) * height).toFixed(1)}`;

  // Split into contiguous runs of measured values so gaps break the line.
  const segments = [];
  let run = [];
  points.forEach((v, i) => {
    if (v === null) {
      if (run.length) segments.push(run);
      run = [];
      return;
    }
    run.push(xy(v, i));
  });
  if (run.length) segments.push(run);

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="sparkline"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {segments.map((seg, i) =>
        seg.length === 1 ? (
          // A lone reading between gaps still deserves a mark.
          <circle
            key={i}
            cx={seg[0].split(',')[0]}
            cy={seg[0].split(',')[1]}
            r="1.6"
            fill={color}
          />
        ) : (
          <polyline
            key={i}
            points={seg.join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      )}
    </svg>
  );
}
