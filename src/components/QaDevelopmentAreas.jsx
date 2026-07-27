// Presentation-only Call QA coaching. Scoring remains server-authoritative;
// this groups the stored structured criterion results for readable review.
export default function QaDevelopmentAreas({ criteria = [] }) {
  const missed = criteria.filter((criterion) => criterion.verdict === 'NOT_MET');
  if (missed.length === 0) return null;
  const groups = missed.reduce((byCategory, criterion) => {
    const id = criterion.categoryId ?? criterion.categoryName ?? 'other';
    if (!byCategory.has(id)) {
      byCategory.set(id, { id, name: criterion.categoryName ?? 'Areas to develop', items: [], points: 0 });
    }
    const group = byCategory.get(id);
    group.items.push(criterion);
    group.points += Number(criterion.points) || 0;
    return byCategory;
  }, new Map());
  const categoryGroups = [...groups.values()];
  const lostPoints = missed.reduce((total, criterion) => total + (Number(criterion.points) || 0), 0);

  return (
    <section className="qa-development" aria-labelledby="qa-development-title">
      <header className="qa-development__header">
        <div>
          <h3 id="qa-development-title" className="qa-development__title">Areas to develop</h3>
          <p className="qa-development__summary">{categoryGroups.length} {categoryGroups.length === 1 ? 'area' : 'areas'} · {lostPoints} {lostPoints === 1 ? 'point' : 'points'} to recover</p>
        </div>
      </header>
      <div className="qa-development__groups">
        {categoryGroups.map((group) => (
          <article key={group.id} className="qa-development__group">
            <header className="qa-development__group-header">
              <h4>{group.name}</h4>
              <span className="qa-development__points">−{group.points} pts</span>
            </header>
            <div className="qa-development__items">
              {group.items.map((criterion) => {
                const coaching = String(criterion.note ?? '').trim() || criterion.text;
                const hasCoachingNote = Boolean(String(criterion.note ?? '').trim());
                return (
                  <div key={criterion.id} className="qa-development__item">
                    <p className="qa-development__criterion">What to improve</p>
                    <p className="qa-development__coaching">{coaching}</p>
                    {hasCoachingNote && (
                      <details className="qa-development__rubric">
                        <summary>Rubric detail</summary>
                        <p>{criterion.text}</p>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export { QaDevelopmentAreas };
