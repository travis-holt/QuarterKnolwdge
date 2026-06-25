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
}) {
  const [ref, display] = useCountUp(value, { decimals, duration });
  return (
    <span ref={ref} className={className}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
