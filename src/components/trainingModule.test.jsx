// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// TrainingModule — rendering of the rich content blocks (scripts, call
// examples, model docs, mistakes, quick-ref, drill), the drill interaction, and
// CONTROLLED DEPARTMENT SCOPING.
//
// The `department` prop is the sole source of truth: the component keeps no
// local department state and offers no local switcher, so the rendered content,
// the cohort rows it was given, and the department a completion is recorded
// under can never diverge. Pure data in, no Firebase/db involved.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import TrainingModule from './TrainingModule.jsx';
import { moduleForDomain, scopeForDept } from '../data/training.js';

// Every render is explicitly department-controlled — there is no default.
const baseProps = {
  rows: [],
  domainId: 'routing',
  department: 'pediatrics',
  onBack: vi.fn(),
  onOpenNavigator: vi.fn(),
};

// The simulation / drills actually visible for a module + department.
const simFor = (domainId, dept) => scopeForDept(moduleForDomain(domainId).simulations, dept)[0];
const drillsFor = (domainId, dept) => scopeForDept(moduleForDomain(domainId).drill, dept);

const pageText = () => document.body.textContent ?? '';
const responseGroup = () => screen.getByRole('group', { name: 'Choose your response' });

describe('TrainingModule content blocks', () => {
  it('renders lessons, mistakes, quick-ref, drill, and takeaways for a module', () => {
    render(<TrainingModule {...baseProps} />);
    const mod = moduleForDomain('routing');
    expect(screen.getByRole('heading', { name: mod.title })).toBeTruthy();
    expect(screen.getByText('Where calls go wrong')).toBeTruthy();
    expect(screen.getByText(mod.quickRef.title)).toBeTruthy();
    expect(screen.getByText('Live call simulation')).toBeTruthy();
    expect(screen.getByText('Quick decision checks')).toBeTruthy();
    expect(screen.getByText('Key takeaways')).toBeTruthy();
  });

  it('renders say/not script pairs and the annotated call example', () => {
    render(<TrainingModule {...baseProps} domainId="boundaries" />);
    expect(screen.getAllByText('Say').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not').length).toBeGreaterThan(0);
    expect(screen.getAllByText('From a real call pattern').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Navigator').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Caller').length).toBeGreaterThan(0);
  });

  it('renders the model document block for the department that ships one', () => {
    // The documentation model TE is the OB Portal serious-symptom note.
    render(<TrainingModule {...baseProps} domainId="documentation" department="obgyn" />);
    const docLesson = moduleForDomain('documentation').lessons.find((l) => l.doc);
    expect(screen.getByText(docLesson.doc.label)).toBeTruthy();
    expect(screen.getByText(docLesson.doc.lines[0])).toBeTruthy();
  });

  it('shows nothing for an unknown domain except the empty state', () => {
    render(<TrainingModule {...baseProps} domainId="nope" />);
    expect(screen.getByText('No training module for this domain yet.')).toBeTruthy();
  });
});

describe('TrainingModule call simulation', () => {
  // With Pediatrics controlled, routing shows the Pediatrics Concerta call.
  const sim = () => simFor('routing', 'pediatrics');

  it('opens on the start node with the caller line and one button per choice', () => {
    render(<TrainingModule {...baseProps} />);
    const start = sim().nodes[sim().start];
    expect(screen.getByText('Live call simulation')).toBeTruthy();
    expect(screen.getByText(sim().title)).toBeTruthy();
    expect(screen.getByText(start.caller)).toBeTruthy();
    expect(within(responseGroup()).getAllByRole('button')).toHaveLength(start.choices.length);
  });

  it('a first-turn misstep ends the call immediately with feedback and a weak debrief', () => {
    render(<TrainingModule {...baseProps} />);
    const start = sim().nodes[sim().start];
    const badIdx = start.choices.findIndex((c) => sim().nodes[c.next].ending);
    const badChoice = start.choices[badIdx];
    const ending = sim().nodes[badChoice.next].ending;

    fireEvent.click(within(responseGroup()).getAllByRole('button')[badIdx]);

    expect(screen.getByText(badChoice.feedback)).toBeTruthy();
    expect(screen.getByText(ending.title)).toBeTruthy();
    expect(screen.getByText(ending.summary)).toBeTruthy();
    expect(screen.getByText('Weak call')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take the call again' })).toBeTruthy();
    // The call is over — no more response choices are offered.
    expect(screen.queryByRole('group', { name: 'Choose your response' })).toBeNull();
  });

  it('walking the all-good path reaches the strong ending', () => {
    render(<TrainingModule {...baseProps} />);
    let node = sim().nodes[sim().start];
    while (node.choices) {
      const goodIdx = node.choices.findIndex((c) => c.tone === 'good');
      fireEvent.click(within(responseGroup()).getAllByRole('button')[goodIdx]);
      node = sim().nodes[node.choices[goodIdx].next];
    }
    expect(node.ending.verdict).toBe('strong');
    expect(screen.getByText('Strong call')).toBeTruthy();
    expect(screen.getByText(node.ending.title)).toBeTruthy();
  });

  it('"Take the call again" resets the simulation to the start node', () => {
    render(<TrainingModule {...baseProps} />);
    const start = sim().nodes[sim().start];
    const badIdx = start.choices.findIndex((c) => sim().nodes[c.next].ending);
    fireEvent.click(within(responseGroup()).getAllByRole('button')[badIdx]);

    fireEvent.click(screen.getByRole('button', { name: 'Take the call again' }));
    expect(within(responseGroup()).getAllByRole('button')).toHaveLength(start.choices.length);
    expect(screen.queryByText('Weak call')).toBeNull();
  });

  it('switching to another module resets an in-progress call', () => {
    const { rerender } = render(<TrainingModule {...baseProps} domainId="routing" />);
    const start = sim().nodes[sim().start];
    const badIdx = start.choices.findIndex((c) => sim().nodes[c.next].ending);
    fireEvent.click(within(responseGroup()).getAllByRole('button')[badIdx]);
    expect(screen.getByText('Weak call')).toBeTruthy();

    rerender(<TrainingModule {...baseProps} domainId="boundaries" />);
    const boundaries = simFor('boundaries', 'pediatrics');
    // The new module opens fresh at its own start node, not the prior ending.
    expect(screen.getByText(boundaries.nodes[boundaries.start].caller)).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Choose your response' })).toBeTruthy();
    expect(screen.queryByText('Weak call')).toBeNull();
  });
});

// ── Controlled department scoping (the PR #34 leak this hotfix closes) ───────

describe('TrainingModule controlled department scoping', () => {
  it('has NO local department selector — department is parent-controlled', () => {
    render(<TrainingModule {...baseProps} />);
    expect(screen.queryByRole('group', { name: 'Choose department' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Choose department scenario' })).toBeNull();
    // No control anywhere can change the rendered department from inside.
    expect(screen.queryByRole('button', { name: 'OB/GYN' })).toBeNull();
  });

  it('renders Pediatrics content when controlled to Pediatrics', () => {
    render(<TrainingModule {...baseProps} domainId="classification" department="pediatrics" />);
    expect(pageText()).toContain('My daughter\'s strep test came back');
    expect(pageText()).not.toContain('moving much less');
  });

  it('renders OB/GYN content when controlled to OB/GYN', () => {
    render(<TrainingModule {...baseProps} domainId="classification" department="obgyn" />);
    expect(pageText()).toContain('moving much less');
    expect(pageText()).not.toContain('My daughter\'s strep test came back');
  });

  it('follows the department prop when the parent changes it', () => {
    const { rerender } = render(
      <TrainingModule {...baseProps} domainId="classification" department="pediatrics" />,
    );
    expect(pageText()).toContain('My daughter\'s strep test came back');

    rerender(<TrainingModule {...baseProps} domainId="classification" department="obgyn" />);
    expect(pageText()).not.toContain('My daughter\'s strep test came back');
    expect(pageText().toLowerCase()).not.toContain('amoxicillin');
    expect(pageText().toLowerCase()).not.toContain('strep');
    expect(pageText()).toContain('moving much less');
  });

  it('OB/GYN never renders Pediatrics-only providers, routes or workflows', () => {
    const peds = ['Sally Carilli', 'Anisa Azeez', 'Marisa Kraft', 'PEDS Encounters', 'Concerta'];
    const { rerender } = render(<TrainingModule {...baseProps} domainId="routing" department="pediatrics" />);
    for (const term of peds) {
      expect(pageText(), `${term} missing from Pediatrics routing`).toContain(term);
    }
    rerender(<TrainingModule {...baseProps} domainId="routing" department="obgyn" />);
    for (const term of peds) {
      expect(pageText(), `${term} leaked into OB/GYN routing`).not.toContain(term);
    }
  });

  it('Pediatrics never renders OB/GYN-only providers, routes or workflows', () => {
    const ob = ['OB Portal', 'Rebecca Wood', 'Dr. Bank', 'Waiting List Portal', 'OB Urgent Calls'];
    const { rerender } = render(<TrainingModule {...baseProps} domainId="routing" department="obgyn" />);
    for (const term of ob) {
      expect(pageText(), `${term} missing from OB/GYN routing`).toContain(term);
    }
    rerender(<TrainingModule {...baseProps} domainId="routing" department="pediatrics" />);
    for (const term of [...ob, 'Labor & Delivery']) {
      expect(pageText(), `${term} leaked into Pediatrics routing`).not.toContain(term);
    }
  });

  it('scopes every block — lesson, mistake, quick-ref row, drill, takeaway and simulation', () => {
    const { rerender } = render(<TrainingModule {...baseProps} domainId="scheduling" department="pediatrics" />);
    // Pediatrics scheduling: the Fidelis early-PE rules, no New OB pairing.
    expect(pageText()).toContain('Fidelis');
    expect(pageText()).not.toContain('New OB');
    expect(pageText()).not.toContain('OB Verified');
    expect(pageText()).not.toContain('Confirmation of Pregnancy');
    expect(screen.getByText(simFor('scheduling', 'pediatrics').title)).toBeTruthy();

    rerender(<TrainingModule {...baseProps} domainId="scheduling" department="obgyn" />);
    expect(pageText()).toContain('New OB');
    expect(pageText()).toContain('OB Verified');
    expect(pageText()).not.toContain('Fidelis');
    expect(screen.getByText(simFor('scheduling', 'obgyn').title)).toBeTruthy();
  });

  it('a department prop change resets the simulation history', () => {
    const { rerender } = render(<TrainingModule {...baseProps} domainId="routing" department="pediatrics" />);
    const pedsSim = simFor('routing', 'pediatrics');
    const start = pedsSim.nodes[pedsSim.start];
    fireEvent.click(within(responseGroup()).getAllByRole('button')[0]);
    expect(screen.getAllByText(start.caller).length).toBeGreaterThan(0);

    rerender(<TrainingModule {...baseProps} domainId="routing" department="obgyn" />);
    const obSim = simFor('routing', 'obgyn');
    expect(screen.getByText(obSim.title)).toBeTruthy();
    expect(screen.getByText(obSim.nodes[obSim.start].caller)).toBeTruthy();
    expect(screen.queryByText(start.caller)).toBeNull();
    expect(within(responseGroup()).getAllByRole('button'))
      .toHaveLength(obSim.nodes[obSim.start].choices.length);
  });

  it('a department prop change resets drill answers', () => {
    const { rerender } = render(<TrainingModule {...baseProps} domainId="routing" department="pediatrics" />);
    const first = screen.getByRole('group', { name: 'Drill scenario 1' });
    fireEvent.click(within(first).getAllByRole('button')[0]);
    within(first).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(true));

    rerender(<TrainingModule {...baseProps} domainId="routing" department="obgyn" />);
    const obDrill = screen.getByRole('group', { name: 'Drill scenario 1' });
    within(obDrill).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(false));

    rerender(<TrainingModule {...baseProps} domainId="routing" department="pediatrics" />);
    const backAgain = screen.getByRole('group', { name: 'Drill scenario 1' });
    within(backAgain).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(false));
  });

  it('keeps exactly one call simulation mounted across department changes', () => {
    const { rerender, container } = render(
      <TrainingModule {...baseProps} domainId="classification" department="pediatrics" />,
    );
    expect(container.querySelectorAll('.tsim')).toHaveLength(1);
    rerender(<TrainingModule {...baseProps} domainId="classification" department="obgyn" />);
    expect(container.querySelectorAll('.tsim')).toHaveLength(1);
    rerender(<TrainingModule {...baseProps} domainId="classification" department="pediatrics" />);
    expect(container.querySelectorAll('.tsim')).toHaveLength(1);
  });
});

// ── Unsupported departments never fall back to Pediatrics ───────────────────

describe('TrainingModule unsupported departments', () => {
  const UNSUPPORTED = [['Adult Medicine', 'adult'], ['Behavioural Health', 'behavioral']];

  for (const [label, dept] of UNSUPPORTED) {
    it(`${label} shows an unavailable state with no Pediatrics fallback`, () => {
      render(<TrainingModule {...baseProps} domainId="routing" department={dept} />);
      expect(screen.getByText('Training content is not available for this department yet.')).toBeTruthy();

      // No content from EITHER supported department.
      for (const term of ['Sally Carilli', 'Concerta', 'PEDS Encounters', 'OB Portal', 'Rebecca Wood']) {
        expect(pageText(), `${term} rendered for ${label}`).not.toContain(term);
      }
      // No simulation, no drills, no takeaways, no quick-ref.
      expect(screen.queryByText('Live call simulation')).toBeNull();
      expect(screen.queryByText('Quick decision checks')).toBeNull();
      expect(screen.queryByText('Key takeaways')).toBeNull();
      expect(screen.queryByRole('group', { name: 'Choose your response' })).toBeNull();
      expect(screen.queryByRole('group', { name: 'Drill scenario 1' })).toBeNull();
    });

    it(`${label} shows no completion control and no cohort, but keeps Back`, () => {
      const onBack = vi.fn();
      const rows = [{ name: 'Dana Cohen', scores: { routing: 20 }, levels: { routing: 'learning' } }];
      render(
        <TrainingModule
          {...baseProps}
          rows={rows}
          domainId="routing"
          department={dept}
          showCohort={false}
          completionKind="module"
          onComplete={vi.fn()}
          onBack={onBack}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Mark module complete' })).toBeNull();
      expect(screen.queryByText('Auto-assigned to')).toBeNull();
      expect(pageText()).not.toContain('Dana Cohen');

      // Back still works.
      fireEvent.click(screen.getByRole('button', { name: '← Back to training' }));
      expect(onBack).toHaveBeenCalled();
    });
  }

  it('a missing department renders unavailable rather than defaulting to Pediatrics', () => {
    render(<TrainingModule {...baseProps} domainId="routing" department={undefined} />);
    expect(screen.getByText('Training content is not available for this department yet.')).toBeTruthy();
    expect(pageText()).not.toContain('Sally Carilli');
  });
});

describe('TrainingModule drill interaction', () => {
  it('reveals rationale and verdict after picking a wrong option, then locks the question', () => {
    render(<TrainingModule {...baseProps} />);
    const drill = drillsFor('routing', 'pediatrics')[0];
    const wrongIdx = drill.options.findIndex((o) => !o.correct);
    const correctOpt = drill.options.find((o) => o.correct);

    const group = screen.getByRole('group', { name: 'Drill scenario 1' });
    const buttons = within(group).getAllByRole('button');
    fireEvent.click(buttons[wrongIdx]);

    expect(screen.getByText((t) => t.includes(drill.options[wrongIdx].why))).toBeTruthy();
    expect(screen.getByText((t) => t.includes(correctOpt.why))).toBeTruthy();
    expect(screen.getByText('Not this time — the highlighted option is the SOP path.')).toBeTruthy();

    within(group).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(true));
  });

  it('shows the positive verdict when the correct option is picked', () => {
    render(<TrainingModule {...baseProps} />);
    const correctIdx = drillsFor('routing', 'pediatrics')[0].options.findIndex((o) => o.correct);

    const group = screen.getByRole('group', { name: 'Drill scenario 1' });
    fireEvent.click(within(group).getAllByRole('button')[correctIdx]);
    expect(screen.getByText('That’s the call a strong navigator makes.')).toBeTruthy();
  });

  it('answering one drill question does not lock the others', () => {
    // Boundaries/OB-GYN is a department view that ships more than one drill.
    render(<TrainingModule {...baseProps} domainId="boundaries" department="obgyn" />);
    expect(drillsFor('boundaries', 'obgyn').length).toBeGreaterThan(1);

    const first = screen.getByRole('group', { name: 'Drill scenario 1' });
    fireEvent.click(within(first).getAllByRole('button')[0]);

    const second = screen.getByRole('group', { name: 'Drill scenario 2' });
    within(second).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(false));
  });

  it('switching modules resets drill answers (fresh, unlocked options)', () => {
    const { rerender } = render(<TrainingModule {...baseProps} domainId="routing" />);
    const first = screen.getByRole('group', { name: 'Drill scenario 1' });
    fireEvent.click(within(first).getAllByRole('button')[0]);
    within(first).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(true));

    rerender(<TrainingModule {...baseProps} domainId="boundaries" />);
    const fresh = screen.getByRole('group', { name: 'Drill scenario 1' });
    within(fresh).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(false));
  });
});

describe('TrainingModule roles', () => {
  it('hides the cohort panel and shows the completion action for navigators', () => {
    render(
      <TrainingModule
        {...baseProps}
        showCohort={false}
        completionKind="module"
        onComplete={vi.fn()}
      />,
    );
    expect(screen.queryByText('Auto-assigned to')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark module complete' })).toBeTruthy();
  });

  it('keeps peer names hidden from navigators in both departments', () => {
    const rows = [{ name: 'Dana Cohen', scores: { routing: 20 }, levels: { routing: 'learning' } }];
    const { rerender } = render(
      <TrainingModule
        {...baseProps}
        rows={rows}
        department="pediatrics"
        showCohort={false}
        completionKind="module"
        onComplete={vi.fn()}
      />,
    );
    expect(screen.queryByText('Auto-assigned to')).toBeNull();
    expect(pageText()).not.toContain('Dana Cohen');

    rerender(
      <TrainingModule
        {...baseProps}
        rows={rows}
        department="obgyn"
        showCohort={false}
        completionKind="module"
        onComplete={vi.fn()}
      />,
    );
    expect(screen.queryByText('Auto-assigned to')).toBeNull();
    expect(pageText()).not.toContain('Dana Cohen');
  });

  it('shows the cohort panel for supervisors, in both departments', () => {
    const { rerender } = render(<TrainingModule {...baseProps} department="pediatrics" />);
    expect(screen.getByText('Auto-assigned to')).toBeTruthy();
    rerender(<TrainingModule {...baseProps} department="obgyn" />);
    expect(screen.getByText('Auto-assigned to')).toBeTruthy();
  });

  it('renders the cohort from the SAME rows it was given, alongside that department\'s content', () => {
    // Supervisor passes department-scoped rows; content and cohort must agree.
    const obRows = [{ name: 'Ob Only Navigator', scores: { routing: 20 }, levels: { routing: 'learning' } }];
    render(<TrainingModule {...baseProps} rows={obRows} domainId="routing" department="obgyn" />);
    expect(pageText()).toContain('Ob Only Navigator');
    expect(pageText()).toContain('OB Portal');      // OB/GYN content
    expect(pageText()).not.toContain('Sally Carilli'); // no Pediatrics content
  });

  it('lets a supervisor open a cohort navigator from the module', () => {
    const onOpenNavigator = vi.fn();
    const rows = [{ name: 'Dana Cohen', scores: { routing: 20 }, levels: { routing: 'learning' } }];
    render(<TrainingModule {...baseProps} rows={rows} onOpenNavigator={onOpenNavigator} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dana Cohen' }));
    expect(onOpenNavigator).toHaveBeenCalledWith('Dana Cohen');
  });
});

describe('TrainingModule completion integrity', () => {
  it('calls onComplete with the kind AND the rendered Pediatrics department', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(
      <TrainingModule
        {...baseProps}
        department="pediatrics"
        showCohort={false}
        completionKind="module"
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark module complete' }));
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith('module', 'pediatrics'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('calls onComplete with the rendered OB/GYN department', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(
      <TrainingModule
        {...baseProps}
        department="obgyn"
        showCohort={false}
        completionKind="coaching"
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark coaching reviewed' }));
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith('coaching', 'obgyn'));
  });

  it('renders the completed state when the parent marks the step done', () => {
    render(
      <TrainingModule
        {...baseProps}
        showCohort={false}
        completionKind="module"
        completed
        onComplete={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: '✓ Completed' });
    expect(btn.disabled).toBe(true);
  });

  it('keeps a failed completion save visible as an inline error', async () => {
    const onComplete = vi.fn().mockRejectedValue(new Error('Network down'));
    render(
      <TrainingModule
        {...baseProps}
        showCohort={false}
        completionKind="module"
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark module complete' }));
    expect(await screen.findByText('Network down')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark module complete' })).toBeTruthy();
  });

  it('surfaces a rejected department-mismatch completion and stays retryable', async () => {
    // Mirrors NavigatorApp's guard rejecting a drifted department.
    const onComplete = vi
      .fn()
      .mockRejectedValue(new Error('Training department changed. Reopen the module and try again.'));
    render(
      <TrainingModule
        {...baseProps}
        department="obgyn"
        showCohort={false}
        completionKind="module"
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark module complete' }));
    expect(await screen.findByText('Training department changed. Reopen the module and try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark module complete' })).toBeTruthy();
    expect(onComplete).toHaveBeenCalledWith('module', 'obgyn');
  });
});
