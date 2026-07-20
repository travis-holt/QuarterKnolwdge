// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// NavigatorDetail — the ONE official status header, diagnostic domain cards,
// and score-based training explanations (2026-07-20 capability redesign).
// db reads are mocked; no real Firebase calls.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import NavigatorDetail from './NavigatorDetail.jsx';
import { buildMatrixRows } from '../lib/scoring.js';
import { DOMAINS, domainName } from '../data/questions.js';

const dbMocks = vi.hoisted(() => ({
  getInterviews: vi.fn(),
  getResultHistory: vi.fn(),
  updateInterviewGradeOverride: vi.fn(),
  updateQaFinalReview: vi.fn(),
}));
vi.mock('../lib/db.js', () => dbMocks);

const DOMAIN_IDS = DOMAINS.map((d) => d.id);
const scoresOf = (values) => Object.fromEntries(DOMAIN_IDS.map((id, i) => [id, values[i]]));

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getInterviews.mockResolvedValue([]);
  dbMocks.getResultHistory.mockResolvedValue([]);
});

function renderDetail(scores, extra = {}) {
  const rows = buildMatrixRows([{ navigatorId: 'nav-1', name: 'Ahmed Mustafa', scores }], null);
  return render(
    <NavigatorDetail
      rows={rows}
      name="Ahmed Mustafa"
      deptName="Pediatrics"
      completions={[]}
      onPreviewModule={vi.fn()}
      onOpenNavigator={vi.fn()}
      {...extra}
    />
  );
}

describe('NavigatorDetail — official overall status header', () => {
  it('shows one overall badge with the percentage and the level', () => {
    // 92+88+96+90+94+86 = 546 → 91 → Can-Teach
    const { container } = renderDetail(scoresOf([92, 88, 96, 90, 94, 86]));
    const header = container.querySelector('.navdetail__head');
    const badges = header.querySelectorAll('.overall-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toContain('91%');
    expect(badges[0].textContent).toContain('Can-Teach');
  });

  it('drops the old "can teach N of 6 domains" header language', () => {
    const { container } = renderDetail(scoresOf([92, 88, 96, 90, 94, 86]));
    expect(container.textContent).not.toMatch(/can teach \d+ of \d+ domains/i);
    expect(container.textContent).not.toMatch(/Can-Teach domains/i);
  });

  it('names the sections by score, not by official level', () => {
    const { container } = renderDetail(scoresOf([34, 80, 80, 95, 80, 78]));
    expect(screen.getByRole('heading', { name: 'Strongest domains' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Priority focus areas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Critical domain gaps' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/^Growth areas$/m);
  });
});

describe('NavigatorDetail — diagnostic domain cards', () => {
  it('shows percentages with neutral wording, never official level badges', () => {
    const { container } = renderDetail(scoresOf([34, 55, 70, 95, 80, 78]));
    const cards = container.querySelectorAll('.navdetail__grid .navdetail__card');
    const texts = [...cards].map((c) => c.textContent);
    const domainText = texts.join(' ');
    // Neutral diagnostic vocabulary
    expect(domainText).toContain('Critical gap');
    expect(domainText).toContain('Focus area');
    expect(domainText).toContain('Developing');
    expect(domainText).toContain('Strong score');
    // No official level names on the domain cards themselves
    expect(domainText).not.toMatch(/Can-Teach|\bSolid\b|\bLearning\b/);
  });

  it('renders every domain percentage', () => {
    const values = [34, 55, 70, 95, 80, 78];
    const { container } = renderDetail(scoresOf(values));
    const grid = container.querySelector('.navdetail__grid');
    for (const v of values) expect(grid.textContent).toContain(`${v}%`);
  });

  it('flags a critical domain gap while the overall status stays Solid', () => {
    // 34+80+80+80+80+78 = 432 → 72 → Solid
    const { container } = renderDetail(scoresOf([34, 80, 80, 80, 80, 78]));
    expect(container.querySelector('.navdetail__head .overall-badge').textContent)
      .toContain('Solid');
    expect(container.querySelector('.callout--critical')).toBeTruthy();
    expect(container.querySelector('.callout--critical').textContent)
      .toContain(domainName(DOMAIN_IDS[0]));
  });
});

describe('NavigatorDetail — training explanations cite the score', () => {
  it('explains an ordinary assignment with the measured percentage', () => {
    const { container } = renderDetail(scoresOf([54, 95, 95, 95, 95, 95]));
    expect(container.textContent)
      .toContain(`Assigned because ${domainName(DOMAIN_IDS[0])} scored 54%`);
    expect(container.textContent).not.toMatch(/is at Learning/i);
  });

  it('uses "Immediate focus" wording for a critical domain assignment', () => {
    const { container } = renderDetail(scoresOf([34, 95, 95, 95, 95, 95]));
    expect(container.textContent)
      .toContain(`Immediate focus because ${domainName(DOMAIN_IDS[0])} scored 34%`);
  });

  it('keeps targeted domain training even when the navigator is Can-Teach overall', () => {
    // 58+95*5 = 533 → 89 … push higher so the overall really is Can-Teach:
    // 58 + 100*5 = 558 → 93 → Can-Teach overall, with one weak domain.
    const { container } = renderDetail(scoresOf([58, 100, 100, 100, 100, 100]));
    expect(container.querySelector('.navdetail__head .overall-badge').textContent)
      .toContain('Can-Teach');
    // The weak domain still produces an assignment.
    expect(container.textContent)
      .toContain(`Assigned because ${domainName(DOMAIN_IDS[0])} scored 58%`);
  });
});
