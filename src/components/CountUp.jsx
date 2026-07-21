import { useCountUp } from '../lib/useCountUp.js';

// Animated number that counts up when scrolled into view. Wrap-able with
// prefix/suffix (e.g. "%"). Snaps to the final value under reduced-motion.
export default function CountUp({
  value,
  decimals = 0,
  duration = 1100,
  prefix = '',
  suffix = '',
  className,
  // Rendered when `value` is null/undefined/NaN — i.e. there is no evidence to
  // report. This must NOT animate to 0: "no data" and "measured zero" are
  // different facts, and 0% would read as a real floor-wide result.
  emptyLabel = '—',
}) {
  const missing = !Number.isFinite(value);
  // Hooks must run unconditionally; feed the hook 0 and discard its output when
  // the value is missing.
  const [ref, display] = useCountUp(missing ? 0 : value, { decimals, duration });
  if (missing) {
    return <span ref={ref} className={className}>{emptyLabel}</span>;
  }
  return (
    <span ref={ref} className={className}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
