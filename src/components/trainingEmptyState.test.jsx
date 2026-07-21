// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// Training empty states must never congratulate an unassessed navigator.
//
// `trainingForRow()` correctly skips domains with no recorded score, so an
// EMPTY assignment list is ambiguous. These tests pin the four required states
// across every surface that renders one.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import MyTraining from './MyTraining.jsx';
import NavigatorDetail from './NavigatorDetail.jsx';
import TrainingModule from './TrainingModule.jsx';
import { buildMatrixRows } from '../lib/scoring.js';
import { DOMAINS } from '../data/questions.js';

const dbMocks = vi.hoisted(() => ({
  getInterviews: vi.fn(),
  getResultHistory: vi.fn(),
  updateInterviewGradeOverride: vi.fn(),
  updateQaFinalReview: vi.fn(),
}));
vi.mock('../lib/db.js', () => dbMocks);
vi.mock('../lib/apiFetch.js', () => ({ apiFetch: vi.fn().mockResolvedValue({}) }));

const DOMAIN_IDS = DOMAINS.map((d) => d.id);
const rowFor = (scores) => buildMatrixRows([{ navigatorId: 'n1', name: 'Pat Rowan', scores }], null)[0];

const NOTHING = {};
const PARTIAL = { [DOMAIN_IDS[0]]: 95 };
const MASTERED = Object.fromEntries(DOMAIN_IDS.map((id) => [id, 95]));
const NEEDS_WORK = Object.fromEntries(DOMAIN_IDS.map((id, i) => [id, i === 0 ? 50 : 95]));

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getInterviews.mockResolvedValue([]);
  dbMocks.getResultHistory.mockResolvedValue([]);
});

// ── MyTraining (navigator's own view) ────────────────────────────────────────

describe('MyTraining empty states', () => {
  const renderMine = (scores) =>
    render(
      <MyTraining
        row={rowFor(scores)}
        completions={[]}
        interviews={[]}
        onPreviewModule={vi.fn()}
        onStartAudit={vi.fn()}
        onStartInterview={vi.fn()}
        onStartMiniCheck={vi.fn()}
      />
    );

  it('0 of 6 domains: says no results are available, never mastery', () => {
    const { container } = renderMine(NOTHING);
    expect(container.textContent).toContain('No assessment results are available yet');
    expect(container.textContent).not.toContain('90% or above');
    expect(container.textContent).not.toContain('mentoring');
  });

  it('1-5 of 6 domains: says training cannot be finalized yet', () => {
    const { container } = renderMine(PARTIAL);
    expect(container.textContent).toContain('Training cannot be finalized until the remaining domains are assessed');
    expect(container.textContent).toContain('1 of 6');
    expect(container.textContent).not.toContain('90% or above');
    expect(container.textContent).not.toContain('mentoring');
  });

  it('6 of 6 all >= 90: the mastery message is valid', () => {
    const { container } = renderMine(MASTERED);
    expect(container.textContent).toContain('Every domain scored 90% or above');
    expect(container.textContent).toContain('mentoring');
  });

  it('6 of 6 with a weak domain: renders assignments normally', () => {
    const { container } = renderMine(NEEDS_WORK);
    expect(container.textContent).not.toContain('Every domain scored 90% or above');
    expect(container.textContent).toContain('scored 50%');
  });
});

// ── NavigatorDetail (supervisor view) ───────────────────────────────────────

describe('NavigatorDetail assigned-training empty states', () => {
  const renderDetail = (scores) =>
    render(
      <NavigatorDetail
        rows={buildMatrixRows([{ navigatorId: 'n1', name: 'Pat Rowan', scores }], null)}
        name="Pat Rowan"
        deptName="Pediatrics"
        completions={[]}
        onPreviewModule={vi.fn()}
        onOpenNavigator={vi.fn()}
      />
    );

  it('0 of 6 domains: no results message, not mastery', () => {
    const { container } = renderDetail(NOTHING);
    expect(container.textContent).toContain('No assessment results are available yet');
    expect(container.textContent).not.toContain('every domain is at 90% or above');
  });

  it('1-5 of 6 domains: cannot be finalized', () => {
    const { container } = renderDetail(PARTIAL);
    expect(container.textContent).toContain('Training cannot be finalized');
    expect(container.textContent).toContain('1 of 6');
    expect(container.textContent).not.toContain('every domain is at 90% or above');
  });

  it('6 of 6 all >= 90: mastery message is valid', () => {
    const { container } = renderDetail(MASTERED);
    expect(container.textContent).toContain('every domain is at 90% or above');
  });

  it('6 of 6 with a weak domain: renders the assignment', () => {
    const { container } = renderDetail(NEEDS_WORK);
    expect(container.textContent).toContain('scored 50%');
  });
});

// ── TrainingModule cohort (supervisor view) ─────────────────────────────────

describe('TrainingModule cohort empty state', () => {
  const renderModule = (rows) =>
    render(
      <TrainingModule
        domainId={DOMAIN_IDS[0]}
        department="pediatrics"
        rows={rows}
        showCohort
        onBack={vi.fn()}
        onOpenNavigator={vi.fn()}
      />
    );

  it('nobody scored in this domain: does not claim the floor has it covered', () => {
    const rows = buildMatrixRows([{ name: 'A', scores: {} }, { name: 'B', scores: {} }], null);
    const { container } = renderModule(rows);
    expect(container.textContent).toContain('No assessment results are available for');
    expect(container.textContent).not.toContain('the floor has it covered');
  });

  it('everyone scored well in this domain: the covered message is valid', () => {
    const rows = buildMatrixRows([{ name: 'A', scores: MASTERED }], null);
    const { container } = renderModule(rows);
    expect(container.textContent).toContain('the floor has it covered');
  });
});
