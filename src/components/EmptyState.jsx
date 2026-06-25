// A friendly full-panel empty state. Used when a data view has nothing to show
// yet (no submissions), a non-live department is selected, or Firebase isn't
// configured. The illustrative glyph keeps the screen from reading as "broken".
export default function EmptyState({ title, children }) {
  return (
    <section className="empty view-enter">
      <div className="card empty__card">
        <span className="empty__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <path d="M3 9h18" />
            <path d="M8 13h2.5M8 16.5h6" />
          </svg>
        </span>
        <h1 className="empty__title">{title}</h1>
        <p className="empty__body">{children}</p>
      </div>
    </section>
  );
}
