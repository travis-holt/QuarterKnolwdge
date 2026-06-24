// A friendly full-panel empty state. Used when a data view has nothing to show
// yet (no submissions), a non-live department is selected, or Firebase isn't
// configured.
export default function EmptyState({ title, children }) {
  return (
    <section className="empty">
      <div className="card empty__card">
        <h1 className="empty__title">{title}</h1>
        <p className="empty__body">{children}</p>
      </div>
    </section>
  );
}
