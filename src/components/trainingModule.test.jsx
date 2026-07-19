// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// TrainingModule — rendering of the rich content blocks (scripts, call
// examples, model docs, mistakes, quick-ref, drill) and the drill interaction.
// Pure data in, no Firebase/db involved.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import TrainingModule from './TrainingModule.jsx';
import { moduleForDomain } from '../data/training.js';

const baseProps = {
  rows: [],
  domainId: 'routing',
  onBack: vi.fn(),
  onOpenNavigator: vi.fn(),
};

describe('TrainingModule content blocks', () => {
  it('renders lessons, mistakes, quick-ref, drill, and takeaways for a module', () => {
    render(<TrainingModule {...baseProps} />);
    const mod = moduleForDomain('routing');
    expect(screen.getByRole('heading', { name: mod.title })).toBeTruthy();
    expect(screen.getByText(mod.lessons[0].title)).toBeTruthy();
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

  it('renders the model document block where a lesson ships one', () => {
    render(<TrainingModule {...baseProps} domainId="documentation" />);
    const mod = moduleForDomain('documentation');
    const docLesson = mod.lessons.find((l) => l.doc);
    expect(screen.getByText(docLesson.doc.label)).toBeTruthy();
    expect(screen.getByText(docLesson.doc.lines[0])).toBeTruthy();
  });

  it('shows nothing for an unknown domain except the empty state', () => {
    render(<TrainingModule {...baseProps} domainId="nope" />);
    expect(screen.getByText('No training module for this domain yet.')).toBeTruthy();
  });
});

describe('TrainingModule call simulation', () => {
  // Routing's first (default) simulation is the Pediatrics Concerta call.
  const sim = () => moduleForDomain('routing').simulations[0];
  const responseGroup = () => screen.getByRole('group', { name: 'Choose your response' });

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

  it('switching to another module resets an in-progress call (keyed by domain)', () => {
    const { rerender } = render(<TrainingModule {...baseProps} domainId="routing" />);
    const start = sim().nodes[sim().start];
    const badIdx = start.choices.findIndex((c) => sim().nodes[c.next].ending);
    fireEvent.click(within(responseGroup()).getAllByRole('button')[badIdx]);
    expect(screen.getByText('Weak call')).toBeTruthy();

    rerender(<TrainingModule {...baseProps} domainId="boundaries" />);
    const boundaries = moduleForDomain('boundaries').simulations[0];
    // The new module opens fresh at its own start node, not the prior ending.
    expect(screen.getByText(boundaries.nodes[boundaries.start].caller)).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Choose your response' })).toBeTruthy();
    expect(screen.queryByText('Weak call')).toBeNull();
  });

  it('shows a department toggle and switches simulations, resetting the call', () => {
    render(<TrainingModule {...baseProps} domainId="routing" />);
    const mod = moduleForDomain('routing');
    expect(mod.simulations.length).toBeGreaterThan(1);

    const toggle = screen.getByRole('group', { name: 'Choose department scenario' });
    const pedsSim = mod.simulations[0];
    const obSim = mod.simulations[1];

    // Default = first (Pediatrics) simulation.
    expect(screen.getByText(pedsSim.title)).toBeTruthy();
    // Make a move so there's in-progress state to reset.
    fireEvent.click(within(responseGroup()).getAllByRole('button')[0]);

    // Switch to the OB-GYN scenario.
    fireEvent.click(within(toggle).getByRole('button', { name: obSim.label }));
    expect(screen.getByText(obSim.title)).toBeTruthy();
    expect(screen.getByText(obSim.nodes[obSim.start].caller)).toBeTruthy();
    // The prior call's committed turn is gone (fresh start).
    expect(within(responseGroup()).getAllByRole('button')).toHaveLength(obSim.nodes[obSim.start].choices.length);
  });

  it('the department toggle exposes a button per simulation label', () => {
    render(<TrainingModule {...baseProps} domainId="classification" />);
    const mod = moduleForDomain('classification');
    const toggle = screen.getByRole('group', { name: 'Choose department scenario' });
    for (const s of mod.simulations) {
      expect(within(toggle).getByRole('button', { name: s.label })).toBeTruthy();
    }
  });
});

describe('TrainingModule drill interaction', () => {
  it('reveals rationale and verdict after picking a wrong option, then locks the question', () => {
    render(<TrainingModule {...baseProps} />);
    const mod = moduleForDomain('routing');
    const drill = mod.drill[0];
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
    const mod = moduleForDomain('routing');
    const correctIdx = mod.drill[0].options.findIndex((o) => o.correct);

    const group = screen.getByRole('group', { name: 'Drill scenario 1' });
    fireEvent.click(within(group).getAllByRole('button')[correctIdx]);
    expect(screen.getByText('That’s the call a strong navigator makes.')).toBeTruthy();
  });

  it('answering one drill question does not lock the others', () => {
    render(<TrainingModule {...baseProps} />);
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

  it('shows the cohort panel for supervisors', () => {
    render(<TrainingModule {...baseProps} />);
    expect(screen.getByText('Auto-assigned to')).toBeTruthy();
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
});
