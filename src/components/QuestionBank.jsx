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
//
// Hardened 2026-07-14 (second pass): activate/archive/delete/restore are now
// failure-safe (pending + inline accessible error + re-entrancy guard, no
// auto-advance on failure); the generate dialog is truly modal (portal +
// inert background + manual focus trap) and immune to a stale-completion
// race across department switches; empty departments resolve to Active
// immediately instead of showing a stale tab; edit-save errors render beside
// the active editor; and the status tabs implement full roving-tabindex
// keyboard semantics.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS = { search: '', domainId: 'all', competencyId: 'all', healthFilter: 'all' };

export default function QuestionBank({ questions, results = [], selectedDept = 'pediatrics', contentVersionContext = null, onActivate, onArchive, onDelete, onSaveEdit, onGenerate, onSaveFeedback, onSaveProposal }) {
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
  // Per-question persistence state (activate/archive/delete/restore). Keyed
  // by question id so multiple rows could in principle be mid-write at once
  // (only one is ever expanded, but state isn't lost when a row collapses).
  const [pendingActions, setPendingActions] = useState({}); // { [id]: 'activate'|'archive'|'delete' }
  const [actionErrors, setActionErrors] = useState({}); // { [id]: string }
  const generateBtnRef = useRef(null);
  const tabRefs = useRef({});

  // ── Initial-tab auto-default, async-load aware ──────────────────────────
  // `questions` starts as [] and is filled in asynchronously by a Firestore
  // subscription (SupervisorApp passes questions=[] on mount). Picking the
  // default tab (Review Queue if drafts exist, else Active) against that
  // still-empty array would wrongly stick on Active even when the first real
  // snapshot turns out to contain drafts. So the auto-default is deferred
  // until the department's first NON-EMPTY snapshot arrives (a real signal
  // that data has actually loaded, not just "nothing yet"), and is resolved
  // at most once per department-visit. Manual tab selection (changeTab with
  // `manual: true`) marks the department resolved immediately so a later
  // snapshot can never override the supervisor's own choice; a successful
  // generation is a separate, intentional override (see handleGenerated).
  const resolvedDeptsRef = useRef(new Map()); // deptId -> resolved this visit
  const manualDeptsRef = useRef(new Set());   // deptIds the supervisor manually picked a tab for

  // Switching departments (including revisiting one) always re-arms the
  // auto-default logic for the newly selected department, AND immediately
  // shows Active as the temporary tab rather than leaving the PREVIOUS
  // department's tab on screen — important for a department with zero
  // questions, which never gets a "non-empty snapshot" signal to resolve on
  // its own (see the resolve effect below).
  useEffect(() => {
    resolvedDeptsRef.current.delete(selectedDept);
    manualDeptsRef.current.delete(selectedDept);
    setActiveTab('active');
    setExpandedQuestionId(null);
    setEditingId(null);
    setEditError('');
    // Only re-derive on a genuinely new department scope, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDept]);

  // Resolve the default tab once real (non-empty) data is available for the
  // current department, unless the supervisor already picked one manually.
  // A department that legitimately never has any questions simply keeps the
  // 'active' default set above — there is no signal to wait on, and that's
  // the correct final answer anyway.
  useEffect(() => {
    if (resolvedDeptsRef.current.get(selectedDept) || manualDeptsRef.current.has(selectedDept)) return;
    if (deptQuestions.length === 0) return; // still waiting for a first meaningful snapshot
    resolvedDeptsRef.current.set(selectedDept, true);
    setActiveTab(defaultStatusTab(counts));
  }, [selectedDept, deptQuestions, counts]);

  // Always-current department, readable from stale closures (see
  // handleGenerated). Set synchronously DURING render — not via a passive
  // effect — so it is guaranteed correct even if a generation completion is
  // validated before effects for this render have flushed. Mutating a ref
  // during render like this is safe (it doesn't affect this render's output
  // and every render is idempotent).
  const selectedDeptRef = useRef(selectedDept);
  selectedDeptRef.current = selectedDept;

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

  // Roving-tabindex keyboard navigation for the tablist (WAI-ARIA APG tabs
  // pattern, automatic activation): Left/Right move focus AND selection
  // between tabs (wrapping), Home/End jump to the first/last tab. Enter/
  // Space need no extra handling — these are native <button>s.
  const handleTabKeyDown = (e, index) => {
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % STATUS_TABS.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + STATUS_TABS.length) % STATUS_TABS.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = STATUS_TABS.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextTab = STATUS_TABS[nextIndex];
    changeTab(nextTab, { manual: true });
    tabRefs.current[nextTab]?.focus();
  };

  const toggleExpand = (id) => {
    setExpandedQuestionId((cur) => (cur === id ? null : id));
    setEditingId((cur) => (cur === id ? cur : null));
  };

  const updateFilter = (patch) => setFilters((prev) => ({ ...prev, ...patch }));
  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  const openGenerateDialog = () => setGenerationDialogOpen(true);
  const closeGenerateDialog = () => setGenerationDialogOpen(false);

  // ── Generation stale-completion guard ───────────────────────────────────
  // Each request gets its own IMMUTABLE tag `{ dept, seq }` created the
  // instant it starts, and that exact tag is threaded through the whole
  // round-trip (returned alongside the count, handed back to `onGenerated`
  // by the dialog) — `handleGenerated` validates the SUPPLIED tag, it never
  // infers request identity by re-reading a mutable "latest" ref. That
  // matters because a ref only ever holds the LATEST request's tag: if
  // request A starts, request B supersedes it, and A resolves last, reading
  // "the current ref" for A's completion would wrongly return B's tag
  // (which — being current — would pass the staleness check). Carrying A's
  // own tag through its own promise chain means A is correctly recognized
  // as stale even though a *different* request is now "current".
  // `generationSeqRef` is only ever incremented (never read back into a
  // per-request tag after the fact), and `selectedDeptRef` is kept in sync
  // synchronously during render (see above) so a completion validated
  // immediately after a department switch still sees the fresh value.
  const generationSeqRef = useRef(0);

  const wrappedOnGenerate = async (args) => {
    generationSeqRef.current += 1;
    const tag = Object.freeze({ dept: selectedDept, seq: generationSeqRef.current });
    const n = await onGenerate(args);
    return { n, tag };
  };

  const handleGenerated = (text, tag) => {
    const isStale = !tag || tag.dept !== selectedDeptRef.current || tag.seq !== generationSeqRef.current;
    if (isStale) return;
    // Generation success is an explicit, action-driven override — distinct
    // from "don't override a manual tab pick". It still needs to stick, so
    // mark the department resolved (not "manual") so a later snapshot can't
    // undo it, without conflating it with an actual supervisor tab click.
    resolvedDeptsRef.current.set(tag.dept, true);
    changeTab('draft');
    // Stamp the message with the department it belongs to (see genMessage
    // render guard below) so it can never be shown while viewing a
    // different department, even if this exact completion is legitimate.
    setGenMessage({ kind: 'ok', text, dept: tag.dept });
  };

  // ── Failure-safe persistence actions ────────────────────────────────────
  // Guards re-entrancy with a ref (synchronous, so back-to-back clicks
  // before React re-renders still only trigger one write), disables the
  // relevant button while pending, and on rejection leaves the question
  // expanded with an inline accessible error instead of silently advancing.
  const pendingRef = useRef(new Set());

  const runAction = async (id, actionKey, fn, advanceOnSuccess) => {
    if (pendingRef.current.has(id)) return; // duplicate-submission guard
    pendingRef.current.add(id);
    setPendingActions((prev) => ({ ...prev, [id]: actionKey }));
    setActionErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      await Promise.resolve(fn(id));
      pendingRef.current.delete(id);
      setPendingActions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (advanceOnSuccess) advanceAfterRemoval(id);
    } catch (err) {
      pendingRef.current.delete(id);
      setPendingActions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setActionErrors((prev) => ({ ...prev, [id]: err?.message || 'Could not save this change. Try again.' }));
    }
  };

  const advanceAfterRemoval = (id) => {
    if (activeTab !== 'draft' || expandedQuestionId !== id) return;
    const next = adjacentQuestionId(visibleQuestions, id, 1) ?? adjacentQuestionId(visibleQuestions, id, -1);
    setExpandedQuestionId(next);
  };

  const handleActivate = (id) => runAction(id, 'activate', onActivate, true);
  const handleDelete = (id) => runAction(id, 'delete', onDelete, true);
  const handleArchive = (id) => runAction(id, 'archive', onArchive, false);

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
    const dept = selectedDept; // captured now — stamped on the message below
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
      setQueueMessage({ kind: 'ok', text: 'Question revision queued in Learning Loop.', dept });
    } catch (err) {
      setQueueMessage({ kind: 'err', text: err?.message || 'Could not queue revision. Check Firebase config/network.', dept });
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
          onGenerate={wrappedOnGenerate}
          onGenerated={handleGenerated}
          onClose={closeGenerateDialog}
          returnFocusRef={generateBtnRef}
        />
      )}

      <div className="qbank-tabs" role="tablist" aria-label="Question status">
        {STATUS_TABS.map((tab, index) => (
          <button
            key={tab}
            ref={(el) => { tabRefs.current[tab] = el; }}
            type="button"
            role="tab"
            id={`qbank-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls={`qbank-tabpanel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            className={`qbank-tabs__tab${activeTab === tab ? ' is-active' : ''}`}
            onClick={() => changeTab(tab, { manual: true })}
            onKeyDown={(e) => handleTabKeyDown(e, index)}
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
        {activeTab === 'draft' && genMessage && genMessage.dept === selectedDept && (
          <p className={`qbank__msg ${genMessage.kind === 'err' ? 'is-err' : 'is-ok'}`} role="status">{genMessage.text}</p>
        )}
        {queueMessage && queueMessage.dept === selectedDept && (
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
                contentVersionContext={contentVersionContext}
                status={activeTab}
                health={health[q.id]}
                isExpanded={expandedQuestionId === q.id}
                isEditing={editingId === q.id}
                editError={editingId === q.id ? editError : ''}
                pendingAction={pendingActions[q.id] ?? null}
                actionError={actionErrors[q.id] ?? ''}
                onToggleExpand={() => toggleExpand(q.id)}
                onEdit={() => { setEditingId(q.id); setEditError(''); }}
                onCancelEdit={() => { setEditingId(null); setEditError(''); }}
                onSaveEdit={saveEdit}
                onActivate={handleActivate}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onSaveFeedback={onSaveFeedback}
                onQueueRevision={() => queueRevision(q, health[q.id])}
                queueing={queueingId === q.id}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
