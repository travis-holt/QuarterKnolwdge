import { useInView } from '../lib/useInView.js';

// Wraps content in a scroll-triggered entrance (fade + rise). `delay` staggers
// siblings (ms). The CSS lives in styles.css (.reveal / .is-in) and is disabled
// under prefers-reduced-motion, so this never hides content for those users.
export default function Reveal({ as: Tag = 'div', delay = 0, className = '', children, ...rest }) {
  const [ref, inView] = useInView();
  return (
    <Tag
      ref={ref}
      className={`reveal ${inView ? 'is-in' : ''} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
