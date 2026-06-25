import { useEffect, useRef, useState } from 'react';
import { useInView } from './useInView.js';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Animates a number from 0 → value with an ease-out curve, but only once the
// element is scrolled into view (so KPIs "land" as the user reaches them).
// Honours prefers-reduced-motion by snapping straight to the final value.
// Returns [ref, formattedString] — attach the ref to the rendered element.
export function useCountUp(value, { duration = 1100, decimals = 0 } = {}) {
  const [ref, inView] = useInView();
  const [display, setDisplay] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    if (!inView) return undefined;
    const target = Number(value) || 0;
    if (prefersReducedMotion() || duration <= 0) {
      setDisplay(target);
      return undefined;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(target * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else setDisplay(target);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [inView, value, duration]);

  return [ref, Number(display).toFixed(decimals)];
}
