// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// Sparkline gap handling + NavigatorDetail trend labels.
//
// A missing historical score must be a GAP in the line and an "N/A" in the
// label — never a plotted zero and never a fabricated 0%.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import Sparkline from './Sparkline.jsx';
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
const fullScores = (fill) => Object.fromEntries(DOMAIN_IDS.map((id) => [id, fill]));

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getInterviews.mockResolvedValue([]);
  dbMocks.getResultHistory.mockResolvedValue([]);
});

// ── Sparkline ───────────────────────────────────────────────────────────────

describe('Sparkline gap handling', () => {
  const polylines = (c) => [...c.querySelectorAll('polyline')];

  it('draws one continuous line when every point is measured', () => {
    const { container } = render(<Sparkline values={[10, 20, 30, 40]} />);
    expect(polylines(container)).toHaveLength(1);
  });

  it('splits the line around a gap instead of plotting zero', () => {
    const { container } = render(<Sparkline values={[10, 20, null, 30, 40]} />);
    expect(polylines(container)).toHaveLength(2);
    // No point sits at the bottom edge from a fabricated zero.
    const allPoints = polylines(container).map((p) => p.getAttribute('points')).join(' ');
    expect(allPoints).not.toContain('NaN');
  });

  it('marks a lone measured reading between gaps with a dot', () => {
    const { container } = render(<Sparkline values={[10, 20, null, 55, null, 30, 40]} />);
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(1);
  });

  it('renders nothing when fewer than two points were measured', () => {
    expect(render(<Sparkline values={[null, null]} />).container.querySelector('svg')).toBeNull();
    expect(render(<Sparkline values={[50, null]} />).container.querySelector('svg')).toBeNull();
  });

  it('plots a genuine zero as a real data point', () => {
    const { container } = render(<Sparkline values={[0, 50]} />);
    expect(polylines(container)).toHaveLength(1);
  });

  it('treats undefined and NaN as gaps, not values', () => {
    // Every measured reading here is isolated between gaps, so each renders as
    // its own dot rather than a joined line — and none is plotted at zero.
    const { container } = render(<Sparkline values={[10, undefined, 20, NaN, 30]} />);
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(polylines(container)).toHaveLength(0);
    expect(container.innerHTML).not.toContain('NaN');
  });
});

// ── NavigatorDetail trend labels ────────────────────────────────────────────

describe('NavigatorDetail trend labels never fabricate 0%', () => {
  const renderWithHistory = async (history, scores = fullScores(80)) => {
    dbMocks.getResultHistory.mockResolvedValue(history);
    const view = render(
      <NavigatorDetail
        rows={buildMatrixRows([{ navigatorId: 'n1', name: 'Pat Rowan', scores }], null)}
        name="Pat Rowan"
        navigatorId="n1"
        deptName="Pediatrics"
        dept="pediatrics"
        completions={[]}
        onPreviewModule={vi.fn()}
        onOpenNavigator={vi.fn()}
      />
    );
    await screen.findByText(/Progress over time/i);
    return view;
  };

  const snap = (ts, scores) => ({ takenAt: { seconds: ts }, scores });

  it('a latest NULL domain value renders N/A, not 0%', async () => {
    const { container } = await renderWithHistory([
      snap(100, fullScores(80)),
      snap(200, fullScores(80)),
      // The most recent check did not measure the first domain.
      snap(300, { ...fullScores(80), [DOMAIN_IDS[0]]: null }),
    ]);
    const row = [...container.querySelectorAll('.trend__domain-row')]
      .find((r) => r.textContent.includes(domainName(DOMAIN_IDS[0])));
    expect(row.textContent).toContain('N/A');
    expect(row.querySelector('.trend__domain-pct').textContent).not.toBe('0%');
  });

  it('a latest UNDEFINED domain value renders N/A', async () => {
    const partial = { ...fullScores(80) };
    delete partial[DOMAIN_IDS[1]];
    const { container } = await renderWithHistory([
      snap(100, fullScores(80)),
      snap(200, partial),
    ]);
    const row = [...container.querySelectorAll('.trend__domain-row')]
      .find((r) => r.textContent.includes(domainName(DOMAIN_IDS[1])));
    expect(row.querySelector('.trend__domain-pct').textContent).toBe('N/A');
  });

  it('a genuine latest score of 0 renders 0%', async () => {
    const { container } = await renderWithHistory([
      snap(100, fullScores(80)),
      snap(200, { ...fullScores(80), [DOMAIN_IDS[0]]: 0 }),
    ]);
    const row = [...container.querySelectorAll('.trend__domain-row')]
      .find((r) => r.textContent.includes(domainName(DOMAIN_IDS[0])));
    expect(row.querySelector('.trend__domain-pct').textContent).toBe('0%');
  });

  it('an empty latest snapshot shows N/A overall and captions the last measured value', async () => {
    const { container } = await renderWithHistory([
      snap(100, fullScores(80)),
      snap(200, fullScores(90)),
      snap(300, {}), // measured nothing
    ]);
    const overall = container.querySelector('.trend__overall');
    expect(overall.querySelector('.trend__pct').textContent).toBe('N/A');
    // The older reading is shown as explicitly historical, not as current.
    expect(overall.textContent).toContain('last measured 90%');
  });

  it('a fully measured latest snapshot shows its percentage with no stale caption', async () => {
    const { container } = await renderWithHistory([
      snap(100, fullScores(80)),
      snap(200, fullScores(90)),
    ]);
    const overall = container.querySelector('.trend__overall');
    expect(overall.querySelector('.trend__pct').textContent).toBe('90%');
    expect(overall.querySelector('.trend__stale-note')).toBeNull();
  });
});

// ── "last measured" must never quote synthetic scaffolding (2026-07-21) ─────

describe('NavigatorDetail — "last measured" uses real history only', () => {
  const renderWithHistory = async (history, scores = fullScores(80)) => {
    dbMocks.getResultHistory.mockResolvedValue(history);
    const view = render(
      <NavigatorDetail
        rows={buildMatrixRows([{ navigatorId: 'n1', name: 'Pat Rowan', scores }], null)}
        name="Pat Rowan"
        navigatorId="n1"
        deptName="Pediatrics"
        dept="pediatrics"
        completions={[]}
        onPreviewModule={vi.fn()}
        onOpenNavigator={vi.fn()}
      />
    );
    await screen.findByText(/Progress over time/i);
    return view;
  };

  const snap = (ts, scores) => ({ takenAt: { seconds: ts }, scores });

  it('a single EMPTY real snapshot shows N/A and NO "last measured" caption', async () => {
    // Synthesis kicks in here, so the chart has illustrative points — but none
    // of them may be described as a measurement.
    const { container } = await renderWithHistory([snap(300, {})]);
    const overall = container.querySelector('.trend__overall');
    expect(overall.querySelector('.trend__pct').textContent).toBe('N/A');
    expect(overall.textContent).not.toContain('last measured');
    expect(overall.querySelector('.trend__stale-note')).toBeNull();
  });

  it('never quotes a synthetic value in a caption', async () => {
    const { container } = await renderWithHistory([snap(300, {})]);
    // The synthetic points exist and are flagged to the reader as illustrative…
    expect(container.textContent).toMatch(/[Ii]llustrative/);
    // …but nothing on the page calls them a measurement.
    expect(container.textContent).not.toContain('last measured');
  });

  it('still renders illustrative sparkline points when synthesis has enough of them', async () => {
    // Two synthetic points + a measured real snapshot gives the chart enough
    // measured values to draw, proving synthesis is not disabled by this fix.
    const { container } = await renderWithHistory([snap(300, fullScores(60))]);
    expect(container.querySelector('.trend__overall svg')).toBeTruthy();
    expect(container.textContent).toMatch(/[Ii]llustrative/);
  });

  it('an older REAL score followed by an empty snapshot captions the older real score', async () => {
    const { container } = await renderWithHistory([
      snap(100, fullScores(70)),
      snap(200, fullScores(90)),
      snap(300, {}),
    ]);
    const overall = container.querySelector('.trend__overall');
    expect(overall.querySelector('.trend__pct').textContent).toBe('N/A');
    expect(overall.textContent).toContain('last measured 90%');
  });

  it('a genuine historical 0 captions "last measured 0%"', async () => {
    const { container } = await renderWithHistory([
      snap(100, fullScores(50)),
      snap(200, fullScores(0)),
      snap(300, {}),
    ]);
    const overall = container.querySelector('.trend__overall');
    expect(overall.textContent).toContain('last measured 0%');
  });

  it('domain captions follow the same real-history rule', async () => {
    const withGap = { ...fullScores(80) };
    delete withGap[DOMAIN_IDS[0]];
    const { container } = await renderWithHistory([
      snap(100, fullScores(65)),
      snap(200, fullScores(85)),
      snap(300, withGap),
    ]);
    const row = [...container.querySelectorAll('.trend__domain-row')]
      .find((r) => r.textContent.includes(domainName(DOMAIN_IDS[0])));
    expect(row.querySelector('.trend__domain-pct').textContent).toBe('N/A');
    expect(row.textContent).toContain('last measured 85%');
  });

  it('domain captions are omitted when only synthetic data exists for that domain', async () => {
    const { container } = await renderWithHistory([snap(300, {})]);
    for (const row of container.querySelectorAll('.trend__domain-row')) {
      expect(row.textContent).not.toContain('last measured');
    }
  });

  it('a measured latest snapshot shows its percentage with no caption', async () => {
    const { container } = await renderWithHistory([
      snap(100, fullScores(70)),
      snap(200, fullScores(90)),
    ]);
    const overall = container.querySelector('.trend__overall');
    expect(overall.querySelector('.trend__pct').textContent).toBe('90%');
    expect(overall.querySelector('.trend__stale-note')).toBeNull();
  });
});
