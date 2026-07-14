import { DOMAINS } from '../data/questions.js';
import { COMPETENCIES } from '../data/competencies.js';
import { HEALTH_FILTERS, SORT_OPTIONS, hasActiveFilters } from '../lib/questionBankView.js';

// Search + domain/competency/health filters + sort, for one status tab's
// question list. Purely controlled — QuestionBank owns all the state.
export default function QuestionBankToolbar({
  search,
  onSearchChange,
  domainId,
  onDomainChange,
  competencyId,
  onCompetencyChange,
  healthFilter,
  onHealthChange,
  sortMode,
  onSortChange,
  visibleCount,
  totalCount,
  onClearFilters,
}) {
  const filtersActive = hasActiveFilters({ search, domainId, competencyId, healthFilter });

  return (
    <div className="qbank-toolbar">
      <label className="qbank-toolbar__search">
        <span className="sr-only">Search questions</span>
        <input
          type="search"
          className="qbank-toolbar__input"
          placeholder="Search scenario, ID, or option text…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search questions"
        />
      </label>

      <label className="qbank-toolbar__field">
        <span className="qbank-toolbar__label">Domain</span>
        <select className="qbank-toolbar__select" value={domainId} onChange={(e) => onDomainChange(e.target.value)} aria-label="Filter by domain">
          <option value="all">All domains</option>
          {DOMAINS.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>

      <label className="qbank-toolbar__field">
        <span className="qbank-toolbar__label">Competency</span>
        <select className="qbank-toolbar__select" value={competencyId} onChange={(e) => onCompetencyChange(e.target.value)} aria-label="Filter by competency">
          <option value="all">All competencies</option>
          {COMPETENCIES.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <label className="qbank-toolbar__field">
        <span className="qbank-toolbar__label">Health</span>
        <select className="qbank-toolbar__select" value={healthFilter} onChange={(e) => onHealthChange(e.target.value)} aria-label="Filter by question health">
          {HEALTH_FILTERS.map((h) => (
            <option key={h.id} value={h.id}>{h.label}</option>
          ))}
        </select>
      </label>

      <label className="qbank-toolbar__field">
        <span className="qbank-toolbar__label">Sort</span>
        <select className="qbank-toolbar__select" value={sortMode} onChange={(e) => onSortChange(e.target.value)} aria-label="Sort questions">
          {SORT_OPTIONS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </label>

      <div className="qbank-toolbar__meta">
        <span className="qbank-toolbar__count">{visibleCount} of {totalCount} questions</span>
        {filtersActive && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClearFilters}>Clear filters</button>
        )}
      </div>
    </div>
  );
}
