import { useEffect, useMemo, useRef, useState } from 'react';
import { computeQuestionHealth } from '../lib/scoring.js';
import {
  STATUS_TABS,
  TAB_LABELS,
  statusCounts,
  defaultStatusTab,
  questionStatus,
  filterQuestions,
  sortQuestions,
  nextExpandedId,
  adjacentQuestionId,
  indexOfQuestion,
} from '../lib/questionBankView.js';
import QuestionBankToolbar from './QuestionBankToolbar.jsx';
import QuestionBankItem from './QuestionBankItem.jsx';
import QuestionBankGenerateDialog from './QuestionBankGenerateDialog.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Question Bank — the supervisor's review gate. Generated scenarios land as
// `draft` and are NEVER live until activated here. Supervisors can also edit,
// archive, or delete. This is the human quality control between AI output and
// a live assessment.
//
// Redesigned 2026-07-13 from a permanently-fully-expanded long page into a
// collapsible, tabbed, filterable workspace — see CLAUDE.md F14 for the full
// description. All existing behavior (generation, activation, archive/
// restore, delete, editing, content guards, question health, feedback,
// revision queueing) is unchanged; only the presentation changed.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS = { search: '', domainId: 'all', competencyId: 'all', healthFilter: 'all' };

export default function QuestionBank({ questions, results = [], selectedDept = 'pediatrics', onActivate, onArchive, onDelete, onSaveEdit, onGenerate, onSaveFeedback, onSaveProposal }) {
  const deptQuestions = useMemo(
    () => questions.filter((q) => (q.department ?? 'pediatrics') === selectedDept),
    [questions, selectedDept]
  );

  const active = useMemo(() => deptQuestions.filter((q) => questionStatus(q) === 'active'), [deptQuestions]);
  const health = useMemo(() => computeQuestionHealth(active, results), [active, results]);
  const counts = useMemo(() => statusCounts(deptQuestions), [deptQuestions]);
  const needsReviewCount = useMemo(
    () => active.filter((q) => health[q.id]?.status === 'review').length,
    [active, health]
  );

  const [activeTab, setActiveTab] = useState(() => defaultStatusTab(counts));
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sortMode, setSortMode] = useState('updatedDesc');
  const [expandedQuestionId, setExpandedQuestionId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editError, setEditError] = useState('');
  const [generationDialogOpen, setGenerationDialogOpen] = useState(false);
  const [genMessage, setGenMessage] = useState(null);
  const [queueingId, setQueueingId] = useState(null);
  const [queueMessage, setQueueMessage] = useState(null);
  const generateBtnRef = useRef(null);

  // ── Initial-tab auto-default, async-load aware ──────────────────────────
  // `questions` starts as [] and is filled in asynchronously by a Firestore
  // subscription (SupervisorApp passes questions=[] on mount). Picking the
  // default tab (Review Queue if drafts exist, else Active) against that
  // still-empty array would wrongly stick on Active even when the first real
  // snapshot turns out to contain drafts. So the auto-default is deferred
  // until the department's first NON-EMPTY snapshot arrives (a real signal
  // that data has actually loaded, not just "nothing yet"), and is resolved
  // at most once per department-visit. A department that legitimately has
  // zero questions never gets an explicit "loaded" signal this way, but that
  // is fine: defaultStatusTab() on all-zero counts already returns 'active',
  // which is the correct final answer and matches the initial guess — there
  // is no visible "loading limbo", we just keep watching in case real
  // questions show up later. Manual tab selection (changeTab with
  // `manual: true`) marks the department resolved immediately so a later
  // snapshot can never override the supervisor's own choice; a successful
  // generation is a separate, intentional override (see handleGenerated).
  const resolvedDeptsRef = useRef(new Map()); // deptId -> resolved this visit
  const manualDeptsRef = useRef(new Set());   // deptIds the supervisor manually picked a tab for

  // Switching departments (including revisiting one) always re-arms the
  // auto-default logic for the newly selected department.
  useEffect(() => {
    resolvedDeptsRef.current.delete(selectedDept);
    manualDeptsRef.current.delete(selectedDept);
    setExpandedQuestionId(null);
    setEditingId(null);
    // Only re-derive on a genuinely new department scope, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDept]);

  // Resolve the default tab once real (non-empty) data is available for the
  // current department, unless the supervisor already picked one manually.
  useEffect(() => {
    if (resolvedDeptsRef.current.get(selectedDept) || manualDeptsRef.current.has(selectedDept)) return;
    if (deptQuestions.length === 0) return; // still waiting for a first meaningful snapshot
    resolvedDeptsRef.current.set(selectedDept, true);
    setActiveTab(defaultStatusTab(counts));
  }, [selectedDept, deptQuestions, counts]);

  const tabQuestions = useMemo(
    () => deptQuestions.filter((q) => questionStatus(q) === activeTab),
    [deptQuestions, activeTab]
  );

  const visibleQuestions = useMemo(
    () => sortQuestions(filterQuestions(tabQuestions, filters, health), sortMode, health),
    [tabQuestions, filters, sortMode, health]
  );

  // Keep expandedQuestionId valid whenever the visible list changes (tab
  // switch, filter change, or the question itself leaving/being removed).
  useEffect(() => {
    setExpandedQuestionId((cur) => nextExpandedId(visibleQuestions, cur));
  }, [visibleQuestions]);

  const changeTab = (tab, { manual = false } = {}) => {
    // A manual pick always wins over the auto-default logic for the rest of
    // this department-visit — mark it resolved so a later async snapshot
    // (e.g. more questions loading in) can never switch the tab out from
    // under the supervisor.
    if (manual) manualDeptsRef.current.add(selectedDept);
    setActiveTab(tab);
    setExpandedQuestionId(null);
    setEditingId(null);
    setEditError('');
  };

  const toggleExpand = (id) => {
    setExpandedQuestionId((cur) => (cur === id ? null : id));
    setEditingId((cur) => (cur === id ? cur : null));
  };

  const updateFilter = (patch) => setFilters((prev) => ({ ...prev, ...patch }));
  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  const openGenerateDialog = () => setGenerationDialogOpen(true);
  const closeGenerateDialog = () => setGenerationDialogOpen(false);
  const handleGenerated = (text) => {
    // Generation success is an explicit, action-driven override — distinct
    // from "don't override a manual tab pick". It still needs to stick, so
    // mark the department resolved (not "manual") so a later snapshot can't
    // undo it, without conflating it with an actual supervisor tab click.
    resolvedDeptsRef.current.set(selectedDept, true);
    changeTab('draft');
    setGenMessage({ kind: 'ok', text });
  };

  const advanceAfterRemoval = (id) => {
    if (activeTab !== 'draft' || expandedQuestionId !== id) return;
    const next = adjacentQuestionId(visibleQuestions, id, 1) ?? adjacentQuestionId(visibleQuestions, id, -1);
    setExpandedQuestionId(next);
  };

  const handleActivate = (id) => {
    advanceAfterRemoval(id);
    onActivate(id);
  };

  const handleDelete = (id) => {
    advanceAfterRemoval(id);
    onDelete(id);
  };

  const saveEdit = async (edited) => {
    try {
      await onSaveEdit(edited.id, {
        scenario: edited.scenario,
        domainId: edited.domainId,
        competencies: edited.competencies,
        options: edited.options,
        correctOptionId: edited.correctOptionId,
      });
      setEditingId(null);
      setEditError('');
    } catch (err) {
      setEditError(err?.message || 'Could not save this question. Try again.');
    }
  };

  const queueRevision = async (q, h) => {
    if (!onSaveProposal) return;
    setQueueingId(q.id);
    setQueueMessage(null);
    try {
      await onSaveProposal({
        type: 'questionRevision',
        title: `Review question ${q.id}`,
        target: { questionId: q.id, domainId: q.domainId, department: selectedDept },
        payload: {
          suggestedDraft: {
            ...q,
            status: 'draft',
            source: 'learning-loop',
            reviewNotes: `Question health flagged this item at ${Math.round((h?.correctRate ?? 0) * 100)}% correct across ${h?.responseCount ?? 0} responses. Review wording, options, rationales, and SOP alignment before activation.`,
          },
        },
        reasons: [
          `${Math.round((h?.correctRate ?? 0) * 100)}% correct across ${h?.responseCount ?? 0} responses`,
          h?.canTeachFailCount > 0 ? `${h.canTeachFailCount} Can-Teach misses` : 'No Can-Teach miss signal',
        ],
      });
      setQueueMessage({ kind: 'ok', text: 'Question revision queued in Learning Loop.' });
    } catch (err) {
      setQueueMessage({ kind: 'err', text: err?.message || 'Could not queue revision. Check Firebase config/network.' });
    } finally {
      setQueueingId(null);
    }
  };

  const expandedIndex = indexOfQuestion(visibleQuestions, expandedQuestionId);
  const showQueueNav = activeTab === 'draft' && visibleQuestions.length > 0;

  const goToAdjacentDraft = (direction) => {
    if (!expandedQuestionId) {
      setExpandedQuestionId(visibleQuestions[0]?.id ?? null);
      return;
    }
    const next = adjacentQuestionId(visibleQuestions, expandedQuestionId, direction);
    if (next) setExpandedQuestionId(next);
  };

  return (
    <section className="qbank view-enter">
      <header className="qbank__head">
        <div>
          <h1 className="overview__title">Question bank</h1>
          <p className="overview__lede">
            Only <strong>active</strong> questions appear in the navigator&rsquo;s check.
          </p>
        </div>
        <button className="btn btn--primary" type="button" ref={generateBtnRef} onClick={openGenerateDialog}>
          Generate questions
        </button>
      </header>

      <div className="qbank__summary">
        <div className="qbank__pill">
          <span className="qbank__pill-value">{counts.draft}</span>
          <span className="qbank__pill-label">Awaiting review</span>
        </div>
        <div className="qbank__pill">
          <span className="qbank__pill-value">{counts.active}</span>
          <span className="qbank__pill-label">Active</span>
        </div>
        <div className="qbank__pill">
          <span className="qbank__pill-value">{counts.archived}</span>
          <span className="qbank__pill-label">Archived</span>
        </div>
        <div className={`qbank__pill${needsReviewCount > 0 ? ' qbank__pill--warn' : ''}`}>
          <span className="qbank__pill-value">{needsReviewCount}</span>
          <span className="qbank__pill-label">Needs review</span>
        </div>
      </div>

      {generationDialogOpen && (
        <QuestionBankGenerateDialog
          onGenerate={onGenerate}
          onGenerated={handleGenerated}
          onClose={closeGenerateDialog}
          returnFocusRef={generateBtnRef}
        />
      )}

      <div className="qbank-tabs" role="tablist" aria-label="Question status">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`qbank-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls={`qbank-tabpanel-${tab}`}
            className={`qbank-tabs__tab${activeTab === tab ? ' is-active' : ''}`}
            onClick={() => changeTab(tab, { manual: true })}
          >
            {TAB_LABELS[tab]} <span className="qbank-tabs__count">{counts[tab]}</span>
          </button>
        ))}
      </div>

      <div
        className="card qbank__panel-wrap"
        role="tabpanel"
        id={`qbank-tabpanel-${activeTab}`}
        aria-labelledby={`qbank-tab-${activeTab}`}
      >
        {activeTab === 'draft' && genMessage && (
          <p className={`qbank__msg ${genMessage.kind === 'err' ? 'is-err' : 'is-ok'}`} role="status">{genMessage.text}</p>
        )}
        {queueMessage && (
          <p className={`qbank__msg ${queueMessage.kind === 'err' ? 'is-err' : 'is-ok'}`} role="status">{queueMessage.text}</p>
        )}

        {tabQuestions.length > 0 && (
          <QuestionBankToolbar
            search={filters.search}
            onSearchChange={(v) => updateFilter({ search: v })}
            domainId={filters.domainId}
            onDomainChange={(v) => updateFilter({ domainId: v })}
            competencyId={filters.competencyId}
            onCompetencyChange={(v) => updateFilter({ competencyId: v })}
            healthFilter={filters.healthFilter}
            onHealthChange={(v) => updateFilter({ healthFilter: v })}
            sortMode={sortMode}
            onSortChange={setSortMode}
            visibleCount={visibleQuestions.length}
            totalCount={tabQuestions.length}
            onClearFilters={clearFilters}
          />
        )}

        {showQueueNav && (
          <div className="qbank__queue-progress">
            <span>
              {expandedIndex >= 0
                ? `Question ${expandedIndex + 1} of ${visibleQuestions.length}`
                : `${visibleQuestions.length} question${visibleQuestions.length !== 1 ? 's' : ''} awaiting review`}
            </span>
            <span className="qbank__queue-nav">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!expandedQuestionId || adjacentQuestionId(visibleQuestions, expandedQuestionId, -1) === null}
                onClick={() => goToAdjacentDraft(-1)}
              >
                ← Previous
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={expandedQuestionId ? adjacentQuestionId(visibleQuestions, expandedQuestionId, 1) === null : visibleQuestions.length === 0}
                onClick={() => goToAdjacentDraft(1)}
              >
                Next →
              </button>
            </span>
          </div>
        )}

        {deptQuestions.length === 0 ? (
          <p className="readoff__empty">
            No questions yet for this department. Use &ldquo;Generate questions&rdquo; above, or add questions manually, to build the check for this department.
          </p>
        ) : tabQuestions.length === 0 ? (
          <p className="readoff__empty">
            {activeTab === 'draft' && 'No questions awaiting review.'}
            {activeTab === 'active' && 'No active questions yet.'}
            {activeTab === 'archived' && 'No archived questions.'}
          </p>
        ) : visibleQuestions.length === 0 ? (
          <div className="qbank__empty-filtered">
            <p className="readoff__empty">No questions match these filters.</p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>Clear filters</button>
          </div>
        ) : (
          <ul className="qbank__list">
            {visibleQuestions.map((q) => (
              <QuestionBankItem
                key={q.id}
                question={q}
                status={activeTab}
                health={health[q.id]}
                isExpanded={expandedQuestionId === q.id}
                isEditing={editingId === q.id}
                onToggleExpand={() => toggleExpand(q.id)}
                onEdit={() => { setEditingId(q.id); setEditError(''); }}
                onCancelEdit={() => { setEditingId(null); setEditError(''); }}
                onSaveEdit={saveEdit}
                onActivate={handleActivate}
                onArchive={onArchive}
                onDelete={handleDelete}
                onSaveFeedback={onSaveFeedback}
                onQueueRevision={() => queueRevision(q, health[q.id])}
                queueing={queueingId === q.id}
              />
            ))}
          </ul>
        )}
        {editError && editingId && <p className="qedit__error qbank__edit-error">{editError}</p>}
      </div>
    </section>
  );
}
