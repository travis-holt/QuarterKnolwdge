// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT TESTS — one official capability status per navigator per department.
//
// These lock the supervisor-facing contract of the 2026-07-20 redesign:
//   • exactly ONE official Critical/Learning/Solid/Can-Teach badge per navigator
//   • domain columns/cards show PERCENTAGES, never six official level labels
//   • a domain below 40 is visibly flagged as a Critical gap even when the
//     navigator's overall status is higher
//   • status is never communicated by colour alone
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import Matrix from './Matrix.jsx';
import Navigators from './Navigators.jsx';
import Overview from './Overview.jsx';
import ActionCenter from './ActionCenter.jsx';
import { buildMatrixRows, departmentMatrix } from '../lib/scoring.js';
import { DOMAINS, domainName } from '../data/questions.js';

const DOMAIN_IDS = DOMAINS.map((d) => d.id);
const scoresOf = (values) => Object.fromEntries(DOMAIN_IDS.map((id, i) => [id, values[i]]));

// 92+88+96+90+94+86 = 546 → 91 overall → Can-Teach
const CAN_TEACH = scoresOf([92, 88, 96, 90, 94, 86]);
// 34+80+80+80+80+78 = 432 → 72 overall → Solid, with a critical gap in D0
const SOLID_WITH_GAP = scoresOf([34, 80, 80, 80, 80, 78]);
// all 30 → 30 overall → Critical
const CRITICAL = scoresOf([30, 30, 30, 30, 30, 30]);

const rowsFor = (samples) => buildMatrixRows(samples, null);

const SAMPLES = [
  { navigatorId: 'n1', name: 'Ahmed Mustafa', scores: CAN_TEACH },
  { navigatorId: 'n2', name: 'Bea Ortiz', scores: SOLID_WITH_GAP },
  { navigatorId: 'n3', name: 'Cyd Nakamura', scores: CRITICAL },
];

// ── Matrix ───────────────────────────────────────────────────────────────────

describe('Matrix — one official status, diagnostic domain columns', () => {
  const renderMatrix = () =>
    render(
      <Matrix
        rows={rowsFor(SAMPLES)}
        deptName="Pediatrics"
        onTakeCheck={null}
        onOpenNavigator={vi.fn()}
      />
    );

  it('renders an Overall column header', () => {
    renderMatrix();
    expect(screen.getByRole('columnheader', { name: /Overall/i })).toBeInTheDocument();
  });

  it('shows exactly one official status badge per navigator row', () => {
    const { container } = renderMatrix();
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.querySelectorAll('.overall-badge')).toHaveLength(1);
    }
  });

  it('renders the overall percentage AND the written label together', () => {
    const { container } = renderMatrix();
    const badge = container.querySelector('tbody tr .overall-badge');
    expect(badge.textContent).toContain('91%');
    expect(badge.textContent).toContain('Can-Teach');
  });

  it('shows domain cells as percentages, not six official level labels', () => {
    const { container } = renderMatrix();
    const canTeachRow = container.querySelectorAll('tbody tr')[0];
    const domainCells = [...canTeachRow.querySelectorAll('.matrix__cell')]
      .filter((c) => !c.classList.contains('matrix__cell--overall'));
    expect(domainCells).toHaveLength(DOMAINS.length);
    // Each domain cell renders its raw score…
    expect(domainCells[0].textContent).toContain('92%');
    // …and no domain cell carries an official level word.
    for (const cell of domainCells) {
      expect(cell.textContent).not.toMatch(/Can-Teach|Solid|Learning/);
    }
  });

  it('flags a domain below 40 as a Critical gap even when the overall status is Solid', () => {
    const { container } = renderMatrix();
    const solidRow = container.querySelectorAll('tbody tr')[1];
    expect(within(solidRow).getByText(/72%/)).toBeInTheDocument();
    expect(within(solidRow).getByText('Solid')).toBeInTheDocument();
    // …and the weak domain is still called out.
    expect(within(solidRow).getByText('34%')).toBeInTheDocument();
    expect(within(solidRow).getByText('Critical gap')).toBeInTheDocument();
  });

  it('describes the overall calculation in the lede', () => {
    renderMatrix();
    expect(
      screen.getByText(/Overall status is calculated from the average across all six domains/i)
    ).toBeInTheDocument();
  });

  it('lists all four levels with their ranges in the legend', () => {
    const { container } = renderMatrix();
    const legend = container.querySelector('.matrix__legend');
    for (const label of ['Critical', 'Learning', 'Solid', 'Can-Teach']) {
      expect(legend.textContent).toContain(label);
    }
    for (const range of ['0–39%', '40–64%', '65–89%', '90–100%']) {
      expect(legend.textContent).toContain(range);
    }
  });
});

// ── Navigators roster cards ──────────────────────────────────────────────────

describe('Navigators — roster cards show one overall status', () => {
  const roster = SAMPLES.map((s) => ({ id: s.navigatorId, name: s.name, status: 'active' }));

  const renderRoster = () =>
    render(
      <Navigators
        rows={rowsFor(SAMPLES)}
        roster={roster}
        deptName="Pediatrics"
        onOpenNavigator={vi.fn()}
        onAddNavigator={vi.fn()}
        onUpdateNavigator={vi.fn()}
        onDeactivateNavigator={vi.fn()}
        onReactivateNavigator={vi.fn()}
        onResetResult={vi.fn()}
      />
    );

  it('shows the official overall status on the card', () => {
    const { container } = renderRoster();
    const card = [...container.querySelectorAll('.nav-card')]
      .find((c) => c.textContent.includes('Ahmed Mustafa'));
    expect(card.textContent).toContain('91%');
    expect(card.textContent).toContain('Can-Teach');
  });

  it('does NOT show an "X Can-Teach domains" count', () => {
    const { container } = renderRoster();
    expect(container.textContent).not.toMatch(/\d+\s+Can-Teach domains?/);
    expect(container.querySelectorAll('.nav-card__counts')).toHaveLength(0);
  });

  it('renders exactly one status badge per card', () => {
    const { container } = renderRoster();
    for (const card of container.querySelectorAll('.nav-card')) {
      expect(card.querySelectorAll('.overall-badge').length).toBeLessThanOrEqual(1);
    }
  });

  it('marks a Critical navigator card as urgent without relying on colour alone', () => {
    const { container } = renderRoster();
    const card = [...container.querySelectorAll('.nav-card')]
      .find((c) => c.textContent.includes('Cyd Nakamura'));
    expect(card.classList.contains('nav-card--critical')).toBe(true);
    expect(card.textContent).toContain('Critical'); // written label, not just colour
    expect(card.textContent).toContain('30%'); // and the number
  });

  it('keeps a six-domain score strip with per-domain percentage tooltips', () => {
    const { container } = renderRoster();
    const card = [...container.querySelectorAll('.nav-card')]
      .find((c) => c.textContent.includes('Ahmed Mustafa'));
    const cells = card.querySelectorAll('.nav-card__cell');
    expect(cells).toHaveLength(DOMAINS.length);
    expect(cells[0].getAttribute('title')).toBe(`${domainName(DOMAIN_IDS[0])}: 92%`);
  });
});

// ── Overview ─────────────────────────────────────────────────────────────────

describe('Overview — navigator-level KPIs', () => {
  const renderOverview = () =>
    render(
      <Overview
        rows={rowsFor(SAMPLES)}
        deptName="Pediatrics"
        deptMatrix={departmentMatrix(
          SAMPLES.map((s) => ({ ...s, departments: { pediatrics: s.scores } })),
          null
        )}
        onOpenNavigator={vi.fn()}
        onViewMatrix={vi.fn()}
        teamHistory={[]}
      />
    );

  it('reports navigator-level capability KPIs', () => {
    renderOverview();
    expect(screen.getByText(/of navigators are Solid or above/i)).toBeInTheDocument();
    expect(screen.getByText(/navigators Can-Teach overall/i)).toBeInTheDocument();
    expect(screen.getByText(/navigators Critical overall/i)).toBeInTheDocument();
    expect(screen.getByText(/average overall score/i)).toBeInTheDocument();
  });

  it('drops the old cell-based readiness KPIs', () => {
    const { container } = renderOverview();
    expect(container.textContent).not.toMatch(/avg Can-Teach domains/i);
    expect(container.textContent).not.toMatch(/domains have a teacher/i);
  });

  it('renders the official overall-status distribution', () => {
    const { container } = renderOverview();
    const dist = container.querySelector('.statusdist');
    expect(dist).toBeTruthy();
    for (const label of ['Critical', 'Learning', 'Solid', 'Can-Teach']) {
      expect(dist.textContent).toContain(label);
    }
  });
});

// ── Action Center ────────────────────────────────────────────────────────────

describe('ActionCenter — critical signals', () => {
  const renderAC = () =>
    render(
      <ActionCenter
        rows={rowsFor(SAMPLES)}
        history={[]}
        interviews={[]}
        completions={[]}
        onOpenNavigator={vi.fn()}
      />
    );

  it('lists Critical overall first, with the recommended supervisor action', () => {
    const { container } = renderAC();
    const cards = [...container.querySelectorAll('.ac__card')];
    expect(cards[0].textContent).toContain('Critical overall');
    expect(cards[0].textContent).toContain('Cyd Nakamura');
    expect(cards[0].textContent).toContain('Immediate supervisor attention recommended');
  });

  it('lists a critical DOMAIN gap for a navigator whose overall status is healthy', () => {
    const { container } = renderAC();
    const card = [...container.querySelectorAll('.ac__card')]
      .find((c) => c.textContent.includes('Critical domain gaps'));
    expect(card.textContent).toContain('Bea Ortiz');
    expect(card.textContent).toContain(`${domainName(DOMAIN_IDS[0])} 34%`);
  });

  it('includes only overall Can-Teach navigators in Ready for more', () => {
    const { container } = renderAC();
    const card = [...container.querySelectorAll('.ac__card')]
      .find((c) => c.textContent.includes('Ready for more'));
    expect(card.textContent).toContain('Ahmed Mustafa');
    expect(card.textContent).toContain('91% overall · Can-Teach');
    expect(card.textContent).not.toContain('Bea Ortiz');
    expect(card.textContent).not.toMatch(/\d+ Can-Teach domains?/);
  });

  it('states that these are developmental signals, not employment decisions', () => {
    renderAC();
    expect(screen.getByText(/not employment\s+decisions/i)).toBeInTheDocument();
  });
});

// â”€â”€ Incomplete / unassessed profiles (2026-07-20 merge-blocker review) â”€â”€â”€â”€â”€â”€â”€

const PARTIAL = { [DOMAIN_IDS[0]]: 100 }; // one domain only
const NOTHING = {};

describe('Incomplete and unassessed profiles never fabricate a status', () => {
  const mixedRows = () => rowsFor([
    { navigatorId: 'p1', name: 'Pat Halloran', scores: PARTIAL },
    { navigatorId: 'p2', name: 'Nia Osei', scores: NOTHING },
  ]);

  it('Matrix shows Incomplete with no percentage and no official level', () => {
    const { container } = render(
      <Matrix rows={mixedRows()} deptName="Pediatrics" onTakeCheck={null} onOpenNavigator={vi.fn()} />
    );
    const row = container.querySelectorAll('tbody tr')[0];
    const badge = row.querySelector('.overall-badge');
    expect(badge.textContent).toContain('Incomplete');
    expect(badge.textContent).toContain('—');
    // A one-domain 100% must never be printed as an overall percentage.
    expect(badge.textContent).not.toContain('100%');
    expect(badge.textContent).not.toMatch(/Critical|Learning|Solid|Can-Teach/);
  });

  it('Matrix shows unscored domain cells as a dash, never 0% or a Critical gap', () => {
    const { container } = render(
      <Matrix rows={mixedRows()} deptName="Pediatrics" onTakeCheck={null} onOpenNavigator={vi.fn()} />
    );
    const row = container.querySelectorAll('tbody tr')[0];
    const domainCells = [...row.querySelectorAll('.matrix__cell')]
      .filter((c) => !c.classList.contains('matrix__cell--overall'));
    // First domain is scored; the other five are not.
    expect(domainCells[0].textContent).toContain('100%');
    for (const cell of domainCells.slice(1)) {
      expect(cell.textContent).toContain('—');
      expect(cell.textContent).not.toContain('0%');
      expect(cell.textContent).not.toContain('Critical gap');
    }
  });

  it('Matrix shows a fully unassessed navigator as Not assessed', () => {
    const { container } = render(
      <Matrix rows={mixedRows()} deptName="Pediatrics" onTakeCheck={null} onOpenNavigator={vi.fn()} />
    );
    const badge = container.querySelectorAll('tbody tr')[1].querySelector('.overall-badge');
    expect(badge.textContent).toContain('Not assessed');
  });

  it('ActionCenter raises no alerts for missing domains', () => {
    const { container } = render(
      <ActionCenter rows={mixedRows()} history={[]} interviews={[]} completions={[]} onOpenNavigator={vi.fn()} />
    );
    const criticalCards = [...container.querySelectorAll('.ac__card')]
      .filter((c) => /Critical overall|Critical domain gaps/.test(c.textContent));
    for (const card of criticalCards) {
      expect(card.textContent).not.toContain('Pat Halloran');
      expect(card.textContent).not.toContain('Nia Osei');
    }
    // The flag badge counts nothing for these two rows.
    expect(container.querySelector('.ac__badge')).toBeNull();
  });

  it('Overview excludes partial profiles from the official KPIs', () => {
    const rows = rowsFor([
      { navigatorId: 'p1', name: 'Pat Halloran', scores: PARTIAL },
      { navigatorId: 'n1', name: 'Ahmed Mustafa', scores: CAN_TEACH },
    ]);
    const { container } = render(
      <Overview
        rows={rows}
        deptName="Pediatrics"
        deptMatrix={[]}
        onOpenNavigator={vi.fn()}
        onViewMatrix={vi.fn()}
        teamHistory={[]}
      />
    );
    // Average overall must be the single complete profile's 91, not (91+100)/2.
    expect(container.textContent).toContain('across 1 complete profile');
    expect(container.textContent).toMatch(/Incomplete profiles/);
    // The eligibility note explains the exclusion.
    expect(container.querySelector('.overview__eligibility-note')).toBeTruthy();
  });

  it('Navigators roster card reports how many domains are scored', () => {
    const roster = [{ id: 'p1', name: 'Pat Halloran', status: 'active' }];
    const { container } = render(
      <Navigators
        rows={rowsFor([{ navigatorId: 'p1', name: 'Pat Halloran', scores: PARTIAL }])}
        roster={roster}
        deptName="Pediatrics"
        onOpenNavigator={vi.fn()}
        onAddNavigator={vi.fn()}
        onUpdateNavigator={vi.fn()}
        onDeactivateNavigator={vi.fn()}
        onReactivateNavigator={vi.fn()}
        onResetResult={vi.fn()}
      />
    );
    const card = container.querySelector('.nav-card');
    expect(card.textContent).toContain('Incomplete');
    expect(card.textContent).toContain('1 of 6 domains scored');
    // Not styled as a Critical navigator — it has no official status at all.
    expect(card.classList.contains('nav-card--critical')).toBe(false);
  });

  it('a RECORDED 0 still renders as a Critical gap in the Matrix', () => {
    const zeroScores = Object.fromEntries(DOMAIN_IDS.map((id, i) => [id, i === 0 ? 0 : 80]));
    const { container } = render(
      <Matrix
        rows={rowsFor([{ navigatorId: 'z', name: 'Zed Marlow', scores: zeroScores }])}
        deptName="Pediatrics"
        onTakeCheck={null}
        onOpenNavigator={vi.fn()}
      />
    );
    const row = container.querySelector('tbody tr');
    expect(row.textContent).toContain('0%');
    expect(row.textContent).toContain('Critical gap');
  });
});

