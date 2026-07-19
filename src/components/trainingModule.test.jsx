// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// TrainingModule — rendering of the rich content blocks (scripts, call
// examples, model docs, mistakes, quick-ref, drill), the drill interaction, and
// the DEPARTMENT SCOPING of the whole page.
//
// The department selector is the single source of truth for the entire module:
// lessons, points, scripts, examples, model docs, mistakes, quick-reference
// rows, drills, the call simulation and takeaways are all filtered to
// "shared + selected department". Pure data in, no Firebase/db involved.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import TrainingModule from './TrainingModule.jsx';
import { moduleForDomain, scopeForDept } from '../data/training.js';

const baseProps = {
  rows: [],
  domainId: 'routing',
  onBack: vi.fn(),
  onOpenNavigator: vi.fn(),
};

// The simulation / drills actually visible for a module + department.
const simFor = (domainId, dept) => scopeForDept(moduleForDomain(domainId).simulations, dept)[0];
const drillsFor = (domainId, dept) => scopeForDept(moduleForDomain(domainId).drill, dept);

const pageText = () => document.body.textContent ?? '';
const deptGroup = () => screen.getByRole('group', { name: 'Choose department' });
const pickDept = (label) => fireEvent.click(within(deptGroup()).getByRole('button', { name: label }));
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
  // With Pediatrics selected, routing shows the Pediatrics Concerta call.
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

// ── Department scoping (the PR #34 leak this hotfix closes) ──────────────────

describe('TrainingModule department scoping', () => {
  it('offers one page-level department control with both departments', () => {
    render(<TrainingModule {...baseProps} />);
    const group = deptGroup();
    expect(within(group).getByRole('button', { name: 'Pediatrics' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'OB/GYN' })).toBeTruthy();
    // There is no second, simulation-local department toggle any more.
    expect(screen.queryByRole('group', { name: 'Choose department scenario' })).toBeNull();
  });

  it('seeds the selected department from the app\'s active department', () => {
    render(<TrainingModule {...baseProps} domainId="classification" department="obgyn" />);
    expect(within(deptGroup()).getByRole('button', { name: 'OB/GYN' }).getAttribute('aria-pressed')).toBe('true');
    expect(pageText()).not.toContain('My daughter\'s strep test came back');
  });

  it('re-seeds when the app\'s active department changes', () => {
    const { rerender } = render(
      <TrainingModule {...baseProps} domainId="classification" department="pediatrics" />,
    );
    expect(pageText()).toContain('My daughter\'s strep test came back');
    rerender(<TrainingModule {...baseProps} domainId="classification" department="obgyn" />);
    expect(pageText()).not.toContain('My daughter\'s strep test came back');
    expect(pageText()).toContain('moving much less');
  });

  it('OB/GYN mode never renders the Pediatrics strep/amoxicillin content', () => {
    render(<TrainingModule {...baseProps} domainId="classification" />);
    // Pediatrics (default) shows it...
    expect(pageText()).toContain('My daughter\'s strep test came back');

    pickDept('OB/GYN');
    // ...OB/GYN must not, in the drill OR the call simulation.
    expect(pageText()).not.toContain('My daughter\'s strep test came back');
    expect(pageText().toLowerCase()).not.toContain('amoxicillin');
    expect(pageText().toLowerCase()).not.toContain('strep');
  });

  it('Pediatrics mode never renders the OB/GYN decreased-fetal-movement content', () => {
    render(<TrainingModule {...baseProps} domainId="classification" department="obgyn" />);
    expect(pageText()).toContain('moving much less');

    pickDept('Pediatrics');
    expect(pageText()).not.toContain('the baby has been moving much less');
    expect(pageText().toLowerCase()).not.toContain('fetal movement');
  });

  it('OB/GYN mode hides Pediatrics-only providers, routes and workflows', () => {
    render(<TrainingModule {...baseProps} domainId="routing" />);
    // Pediatrics shows its own routing table...
    for (const term of ['Sally Carilli', 'Anisa Azeez', 'Marisa Kraft', 'PEDS Encounters', 'Concerta']) {
      expect(pageText(), `${term} missing from Pediatrics routing`).toContain(term);
    }

    pickDept('OB/GYN');
    for (const term of ['Sally Carilli', 'Anisa Azeez', 'Marisa Kraft', 'PEDS Encounters', 'Concerta']) {
      expect(pageText(), `${term} leaked into OB/GYN routing`).not.toContain(term);
    }
  });

  it('Pediatrics mode hides OB/GYN-only providers, routes and workflows', () => {
    render(<TrainingModule {...baseProps} domainId="routing" department="obgyn" />);
    for (const term of ['OB Portal', 'Rebecca Wood', 'Dr. Bank', 'Waiting List Portal', 'OB Urgent Calls']) {
      expect(pageText(), `${term} missing from OB/GYN routing`).toContain(term);
    }

    pickDept('Pediatrics');
    for (const term of ['OB Portal', 'Rebecca Wood', 'Dr. Bank', 'Waiting List Portal', 'OB Urgent Calls', 'Labor & Delivery']) {
      expect(pageText(), `${term} leaked into Pediatrics routing`).not.toContain(term);
    }
  });

  it('scopes every block — lesson, mistake, quick-ref row, drill, takeaway and simulation', () => {
    render(<TrainingModule {...baseProps} domainId="scheduling" />);
    // Pediatrics scheduling: the Fidelis early-PE rules, no New OB pairing.
    expect(pageText()).toContain('Fidelis');
    expect(pageText()).not.toContain('New OB');
    expect(pageText()).not.toContain('OB Verified');
    expect(pageText()).not.toContain('Confirmation of Pregnancy');
    expect(screen.getByText(simFor('scheduling', 'pediatrics').title)).toBeTruthy();

    pickDept('OB/GYN');
    // OB/GYN scheduling: New OB pairing, no Fidelis/camp-form pediatrics rules.
    expect(pageText()).toContain('New OB');
    expect(pageText()).toContain('OB Verified');
    expect(pageText()).not.toContain('Fidelis');
    expect(screen.getByText(simFor('scheduling', 'obgyn').title)).toBeTruthy();
  });

  it('switching departments resets the simulation history', () => {
    render(<TrainingModule {...baseProps} domainId="routing" />);
    const pedsSim = simFor('routing', 'pediatrics');
    const start = pedsSim.nodes[pedsSim.start];
    // Commit a turn so there is history to clear.
    fireEvent.click(within(responseGroup()).getAllByRole('button')[0]);
    expect(screen.getAllByText(start.caller).length).toBeGreaterThan(0);

    pickDept('OB/GYN');
    const obSim = simFor('routing', 'obgyn');
    // The OB/GYN call starts fresh — the Pediatrics turn is gone entirely.
    expect(screen.getByText(obSim.title)).toBeTruthy();
    expect(screen.getByText(obSim.nodes[obSim.start].caller)).toBeTruthy();
    expect(screen.queryByText(start.caller)).toBeNull();
    expect(within(responseGroup()).getAllByRole('button'))
      .toHaveLength(obSim.nodes[obSim.start].choices.length);
  });

  it('switching departments resets drill answers', () => {
    render(<TrainingModule {...baseProps} domainId="routing" />);
    const first = screen.getByRole('group', { name: 'Drill scenario 1' });
    fireEvent.click(within(first).getAllByRole('button')[0]);
    within(first).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(true));

    pickDept('OB/GYN');
    const obDrill = screen.getByRole('group', { name: 'Drill scenario 1' });
    within(obDrill).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(false));

    // Coming back is a fresh drill too — no stale answer survives the switch.
    pickDept('Pediatrics');
    const backAgain = screen.getByRole('group', { name: 'Drill scenario 1' });
    within(backAgain).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(false));
  });

  it('keeps the chosen department while browsing, and still resets module state', () => {
    const { rerender } = render(<TrainingModule {...baseProps} domainId="routing" />);
    pickDept('OB/GYN');
    fireEvent.click(within(responseGroup()).getAllByRole('button')[0]);

    rerender(<TrainingModule {...baseProps} domainId="documentation" />);
    // Department choice persists (the prop did not change)...
    expect(within(deptGroup()).getByRole('button', { name: 'OB/GYN' }).getAttribute('aria-pressed')).toBe('true');
    // ...but the new module opens on its own OB/GYN call, with no stale turn.
    const docSim = simFor('documentation', 'obgyn');
    expect(screen.getByText(docSim.title)).toBeTruthy();
    expect(screen.getByText(docSim.nodes[docSim.start].caller)).toBeTruthy();
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

    // Rationale for the picked (wrong) and the correct option are both revealed.
    expect(screen.getByText((t) => t.includes(drill.options[wrongIdx].why))).toBeTruthy();
    expect(screen.getByText((t) => t.includes(correctOpt.why))).toBeTruthy();
    expect(screen.getByText('Not this time — the highlighted option is the SOP path.')).toBeTruthy();

    // All options of that question are disabled after answering.
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
    // Answered → locked.
    within(first).getAllByRole('button').forEach((b) => expect(b.disabled).toBe(true));

    rerender(<TrainingModule {...baseProps} domainId="boundaries" />);
    const fresh = screen.getByRole('group', { name: 'Drill scenario 1' });
    // The new module's drill is unanswered — every option is clickable again.
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

  it('keeps the cohort hidden for navigators in every department', () => {
    const rows = [{ name: 'Dana Cohen', scores: { routing: 20 }, levels: { routing: 'learning' } }];
    render(
      <TrainingModule
        {...baseProps}
        rows={rows}
        showCohort={false}
        completionKind="module"
        onComplete={vi.fn()}
      />,
    );
    expect(screen.queryByText('Auto-assigned to')).toBeNull();
    pickDept('OB/GYN');
    expect(screen.queryByText('Auto-assigned to')).toBeNull();
    expect(pageText()).not.toContain('Dana Cohen');
  });

  it('shows the cohort panel for supervisors, in both departments', () => {
    render(<TrainingModule {...baseProps} />);
    expect(screen.getByText('Auto-assigned to')).toBeTruthy();
    pickDept('OB/GYN');
    expect(screen.getByText('Auto-assigned to')).toBeTruthy();
  });

  it('lets a supervisor open a cohort navigator from the module', () => {
    const onOpenNavigator = vi.fn();
    const rows = [{ name: 'Dana Cohen', scores: { routing: 20 }, levels: { routing: 'learning' } }];
    render(<TrainingModule {...baseProps} rows={rows} onOpenNavigator={onOpenNavigator} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dana Cohen' }));
    expect(onOpenNavigator).toHaveBeenCalledWith('Dana Cohen');
  });

  it('a navigator marking the module complete calls onComplete with the kind', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(
      <TrainingModule
        {...baseProps}
        showCohort={false}
        completionKind="module"
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark module complete' }));
    // The action is async; wait for the save call to fire with the step kind.
    // (`completed` is a parent-controlled prop, so the label only flips once the
    // parent re-renders with completed=true — see the completed-prop case below.)
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith('module'));
    expect(screen.queryByRole('alert')).toBeNull();
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
    // The error surfaces and the button returns to a retry-able state.
    expect(await screen.findByText('Network down')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark module complete' })).toBeTruthy();
  });

  it('a completion save error survives a department switch on the same module', async () => {
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
    pickDept('OB/GYN');
    // The completion control is department-independent — the error is still shown.
    expect(screen.getByText('Network down')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark module complete' })).toBeTruthy();
  });
});
