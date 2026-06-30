// ponytail: inline SVG polyline — no dep needed for a single line graph
export default function Sparkline({ values, color = 'var(--accent)', height = 28 }) {
  if (!values || values.length < 2) return null;
  const W = 100;
  const min = Math.min(...values), max = Math.max(...values);
  const ry = max - min || 1;
  const pts = values
    .map((v, i) =>
      `${((i / (values.length - 1)) * W).toFixed(1)},${(height - ((v - min) / ry) * height).toFixed(1)}`
    )
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="sparkline"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
