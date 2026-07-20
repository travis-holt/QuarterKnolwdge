// ─────────────────────────────────────────────────────────────────────────────
// TRAINING CATALOG SHAPE TESTS — guard the contract every consumer relies on
// (scoring.js attaches modules; Training/MyTraining/NavigatorDetail render
// title/estMinutes; TrainingModule renders every content block).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  TRAINING_MODULES,
  moduleForDomain,
  scopeForDept,
  belongsToDept,
  itemDepartments,
  itemText,
  TRAINING_DEPARTMENTS,
} from './training.js';
import { DOMAINS } from './questions.js';

const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

describe('TRAINING_MODULES catalog', () => {
  it('covers every domain exactly once', () => {
    const ids = TRAINING_MODULES.map((m) => m.domainId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of DOMAINS) {
      expect(ids).toContain(d.id);
    }
  });

  it('every module has the base fields all consumers rely on', () => {
    for (const m of TRAINING_MODULES) {
      expect(nonEmpty(m.title)).toBe(true);
      expect(nonEmpty(m.blurb)).toBe(true);
      expect(typeof m.estMinutes).toBe('number');
      expect(m.estMinutes).toBeGreaterThan(0);
      expect(Array.isArray(m.lessons)).toBe(true);
      expect(m.lessons.length).toBeGreaterThan(0);
      expect(Array.isArray(m.keyTakeaways)).toBe(true);
      expect(m.keyTakeaways.length).toBeGreaterThan(0);
      m.keyTakeaways.forEach((t) => expect(nonEmpty(itemText(t))).toBe(true));
    }
  });

  it('every lesson has a title, points, and well-formed optional blocks', () => {
    for (const m of TRAINING_MODULES) {
      for (const lesson of m.lessons) {
        expect(nonEmpty(lesson.title)).toBe(true);
        expect(lesson.points.length).toBeGreaterThan(0);
        lesson.points.forEach((p) => expect(nonEmpty(itemText(p))).toBe(true));
        if (lesson.script) {
          lesson.script.forEach((s) => {
            expect(nonEmpty(s.say)).toBe(true);
            expect(nonEmpty(s.not)).toBe(true);
            expect(nonEmpty(s.why)).toBe(true);
          });
        }
        if (lesson.example) {
          expect(lesson.example.turns.length).toBeGreaterThan(0);
          lesson.example.turns.forEach((t) => {
            expect(['caller', 'nav']).toContain(t.speaker);
            expect(nonEmpty(t.text)).toBe(true);
          });
        }
        if (lesson.doc) {
          expect(nonEmpty(lesson.doc.label)).toBe(true);
          expect(lesson.doc.lines.length).toBeGreaterThan(0);
          lesson.doc.lines.forEach((l) => expect(nonEmpty(l)).toBe(true));
        }
      }
    }
  });

  it('every drill question has exactly one correct option, each with a why', () => {
    for (const m of TRAINING_MODULES) {
      expect(Array.isArray(m.drill)).toBe(true);
      expect(m.drill.length).toBeGreaterThan(0);
      for (const d of m.drill) {
        expect(nonEmpty(d.prompt)).toBe(true);
        expect(d.options.length).toBeGreaterThanOrEqual(2);
        const correct = d.options.filter((o) => o.correct === true);
        expect(correct.length).toBe(1);
        d.options.forEach((o) => {
          expect(nonEmpty(o.text)).toBe(true);
          expect(nonEmpty(o.why)).toBe(true);
        });
      }
    }
  });

  it('every module ships mistakes and a quick-reference card', () => {
    for (const m of TRAINING_MODULES) {
      expect(m.mistakes.length).toBeGreaterThan(0);
      m.mistakes.forEach((mk) => {
        expect(nonEmpty(mk.mistake)).toBe(true);
        expect(nonEmpty(mk.consequence)).toBe(true);
        expect(nonEmpty(mk.instead)).toBe(true);
      });
      expect(nonEmpty(m.quickRef.title)).toBe(true);
      expect(m.quickRef.rows.length).toBeGreaterThan(0);
      m.quickRef.rows.forEach((r) => {
        expect(nonEmpty(r.label)).toBe(true);
        expect(nonEmpty(r.value)).toBe(true);
      });
    }
  });
});

// ── Live call simulations (branching graphs) ─────────────────────────────────
const VERDICTS = ['strong', 'mixed', 'weak'];
const TONES = ['good', 'ok', 'bad'];

const allSims = () =>
  TRAINING_MODULES.flatMap((m) => (m.simulations ?? []).map((sim) => ({ m, sim })));

describe('call simulations', () => {
  it('every module has at least one simulation, each with a label and a valid start', () => {
    for (const m of TRAINING_MODULES) {
      expect(Array.isArray(m.simulations)).toBe(true);
      expect(m.simulations.length).toBeGreaterThanOrEqual(1);
      // Labels are unique within a module (they drive the department toggle).
      const labels = m.simulations.map((s) => s.label);
      expect(new Set(labels).size).toBe(labels.length);
      for (const sim of m.simulations) {
        expect(nonEmpty(sim.label)).toBe(true);
        expect(nonEmpty(sim.title)).toBe(true);
        expect(nonEmpty(sim.intro)).toBe(true);
        expect(nonEmpty(sim.callerName)).toBe(true);
        expect(sim.nodes[sim.start]).toBeTruthy();
        expect(sim.nodes[sim.start].choices).toBeTruthy(); // start is a choice node
      }
    }
  });

  it('every node is either a choice node or an ending node, never both/neither', () => {
    for (const { m, sim } of allSims()) {
      for (const [id, node] of Object.entries(sim.nodes)) {
        const isChoice = Array.isArray(node.choices);
        const isEnding = Boolean(node.ending);
        expect(isChoice !== isEnding, `node ${id} in ${m.domainId}/${sim.label} must be exactly one kind`).toBe(true);
        if (isChoice) {
          expect(nonEmpty(node.caller)).toBe(true);
          expect(node.choices.length).toBeGreaterThanOrEqual(2);
          node.choices.forEach((c) => {
            expect(nonEmpty(c.text)).toBe(true);
            expect(nonEmpty(c.feedback)).toBe(true);
            expect(TONES).toContain(c.tone);
            expect(sim.nodes[c.next], `choice in ${m.domainId}/${sim.label} points at missing node ${c.next}`).toBeTruthy();
          });
        } else {
          expect(VERDICTS).toContain(node.ending.verdict);
          expect(nonEmpty(node.ending.title)).toBe(true);
          expect(nonEmpty(node.ending.summary)).toBe(true);
          expect(nonEmpty(node.ending.lesson)).toBe(true);
        }
      }
    }
  });

  it('every node is reachable from start and every path terminates (acyclic)', () => {
    for (const { m, sim } of allSims()) {
      const { nodes, start } = sim;

      // Reachability: BFS from start reaches every declared node.
      const seen = new Set();
      const queue = [start];
      while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        const node = nodes[id];
        if (node.choices) node.choices.forEach((c) => queue.push(c.next));
      }
      expect(seen.size, `unreachable nodes in ${m.domainId}/${sim.label}`).toBe(Object.keys(nodes).length);

      // Termination: no cycles (a choice can never lead back to an ancestor).
      const visiting = new Set();
      const done = new Set();
      const noCycle = (id) => {
        if (done.has(id)) return true;
        if (visiting.has(id)) return false; // back-edge → cycle
        visiting.add(id);
        const node = nodes[id];
        if (node.choices && !node.choices.every((c) => noCycle(c.next))) return false;
        visiting.delete(id);
        done.add(id);
        return true;
      };
      expect(noCycle(start), `simulation ${m.domainId}/${sim.label} has a cycle`).toBe(true);
    }
  });

  it('every simulation offers at least one strong ending', () => {
    for (const { sim } of allSims()) {
      const endings = Object.values(sim.nodes).filter((n) => n.ending);
      expect(endings.length).toBeGreaterThanOrEqual(2);
      expect(endings.some((n) => n.ending.verdict === 'strong')).toBe(true);
    }
  });

  it('OB/GYN simulations never dispatch a patient to Labor & Delivery', () => {
    // The current-floor OB SOP is explicit: navigators do not triage or send
    // patients to L&D. Any "Labor & Delivery" text must be a MISSTEP choice or a
    // weak/mixed teaching ending — never a strong (correct) path.
    for (const { sim } of allSims().filter((x) => x.sim.label === 'OB-GYN')) {
      for (const node of Object.values(sim.nodes)) {
        if (node.choices) {
          node.choices.forEach((c) => {
            if (/labor\s*&?\s*delivery|\bL&D\b/i.test(c.text)) {
              expect(c.tone, 'an L&D dispatch must be a misstep, never a good choice').toBe('bad');
            }
          });
        } else if (/labor\s*&?\s*delivery|\bL&D\b/i.test(node.ending.summary + node.ending.lesson)) {
          expect(node.ending.verdict).not.toBe('strong');
        }
      }
    }
  });
});

// ── Current-floor source-authority guards ────────────────────────────────────
// The OB/GYN content is authored against the owner-confirmed current-floor
// Women's Health SOP (v1.0, 2026-07-17). These guards lock the destinations and
// escalation workflow that SOP mandates so a future content edit can't silently
// reintroduce a legacy rule (e.g. "PSS OB") or an out-of-scope instruction.
const catalogText = JSON.stringify(TRAINING_MODULES);
const pedsSims = () => allSims().filter((x) => x.sim.label === 'Pediatrics');
// Pre-booking a future-day "same-day" sick slot: "book … tomorrow" in either order.
const FUTURE_DAY_BOOKING = /book[^.]{0,80}tomorrow|tomorrow[^.]{0,80}book/i;

describe('current-floor source authority (OB/GYN)', () => {
  it('never uses the legacy PSS OB routing destination anywhere', () => {
    expect(catalogText).not.toMatch(/\bPSS\s*OB\b/i);
  });

  it('routes to the owner-confirmed OB destinations', () => {
    expect(catalogText).toContain('OB Portal'); // questions / triage / missing orders / labs / results
    expect(catalogText).toContain('Rebecca Wood'); // all MFM / high-risk
    expect(catalogText).toContain('Waiting List Portal'); // Dr. Bank annual / fertility
  });

  it('teaches the full serious-symptom escalation workflow', () => {
    // Gather → High Priority TE → OB Portal → the Women's Health OB Urgent Calls
    // Intermedia channel → follow the clinical team.
    expect(catalogText).toMatch(/High Priority/);
    expect(catalogText).toMatch(/OB Urgent Calls/); // the urgent Intermedia channel
    const routing = moduleForDomain('routing');
    const routingText = JSON.stringify(routing);
    expect(routingText).toContain('High Priority');
    expect(routingText).toContain('OB Portal');
    expect(routingText).toContain('OB Urgent Calls');
  });

  it('keeps New OB pairing and OB Verified guidance in scheduling', () => {
    const scheduling = JSON.stringify(moduleForDomain('scheduling'));
    expect(scheduling).toContain('New OB');
    expect(scheduling).toContain('OB Verified');
    expect(scheduling).toMatch(/back-to-back/i);
    expect(scheduling).toMatch(/Confirmation of Pregnancy/i); // unknown/unreliable LMP path
  });
});

describe('current-floor source authority (Pediatrics same-day sick)', () => {
  it('never teaches a future-day same-day-sick booking on a correct path', () => {
    for (const { m, sim } of pedsSims()) {
      for (const [id, node] of Object.entries(sim.nodes)) {
        if (node.choices) {
          node.choices
            .filter((c) => c.tone === 'good')
            .forEach((c) => {
              expect(
                FUTURE_DAY_BOOKING.test(c.text),
                `good choice in ${m.domainId}/${sim.label} node ${id} pre-books a future-day sick slot`,
              ).toBe(false);
            });
        } else if (node.ending.verdict === 'strong') {
          expect(FUTURE_DAY_BOOKING.test(`${node.ending.summary} ${node.ending.lesson}`)).toBe(false);
        }
      }
    }
  });

  it('the intake same-day node keeps the corrected "call tomorrow" wording', () => {
    const intake = moduleForDomain('intake');
    const peds = intake.simulations.find((s) => s.label === 'Pediatrics');
    const good = peds.nodes.n3.choices.find((c) => c.tone === 'good');
    expect(good.text).toMatch(/only books for the day itself/i);
    expect(good.text).toMatch(/call us tomorrow/i);
    expect(good.text).not.toMatch(/book it as a same-day visit tomorrow/i);
  });
});

// ── Routing precision: routine GYN scheduling is DIRECT, not OB Portal ────────
// The current-floor SOP handles routine GYN scheduling directly (Annual GYN UTD
// rule + provider template). OB Portal owns the clinical/uncertain lane. These
// guards stop the content from ever collapsing back to "almost everything → OB
// Portal," which mis-teaches navigators to route routine bookings clinically.
describe('current-floor source authority (OB/GYN routing precision)', () => {
  const routing = moduleForDomain('routing');
  const routingText = JSON.stringify(routing);

  it('teaches routine GYN scheduling as DIRECT (Annual UTD + template), not OB Portal', () => {
    expect(routingText).toMatch(/routine GYN scheduling/i);
    expect(routingText).toMatch(/Annual GYN/i);
    expect(routingText).toMatch(/template/i);
    // The quick-reference pins routine GYN scheduling to a direct booking, not OB Portal.
    const directRow = routing.quickRef.rows.find((r) => /routine GYN scheduling/i.test(r.label));
    expect(directRow).toBeTruthy();
    expect(directRow.value).toMatch(/direct/i);
    expect(directRow.value).toMatch(/not OB Portal/i);
  });

  it('never reduces OB/GYN routing to "almost everything → OB Portal"', () => {
    // The prior wording ("almost every clinical or uncertain call goes to OB
    // Portal", "OB: almost everything → OB Portal") over-routed routine work.
    expect(routingText).not.toMatch(/almost every/i);
    const catalog = JSON.stringify(TRAINING_MODULES);
    expect(catalog).not.toMatch(/everything\s*(?:→|goes to)\s*OB Portal/i);
    // OB Portal must still own the clinical/uncertain lane.
    expect(routingText).toMatch(/OB Portal/);
  });
});

// ── Serious symptom keeps unrelated requests on separate TEs ──────────────────
// A serious-symptom escalation (e.g. decreased fetal movement) must NOT teach
// folding an unrelated request (e.g. a prenatal-vitamin refill) into the same TE.
describe('current-floor source authority (serious symptom keeps requests separate)', () => {
  // Affirmative mixing only — the corrective "never fold …" wording is correct
  // and must NOT trip this guard, so match the defect phrasings directly.
  const REFILL_MIXING = /note the (?:vitamins|refill) too|add the refill to the same/i;

  it('no strong OB/GYN path folds an unrelated refill into the serious-symptom TE', () => {
    for (const { m, sim } of allSims().filter((x) => x.sim.label === 'OB-GYN')) {
      for (const [id, node] of Object.entries(sim.nodes)) {
        if (node.choices) {
          node.choices
            .filter((c) => c.tone === 'good')
            .forEach((c) => {
              expect(
                REFILL_MIXING.test(c.text),
                `good choice in ${m.domainId}/${sim.label} node ${id} mixes an unrelated refill into a serious-symptom TE`,
              ).toBe(false);
            });
        } else if (node.ending.verdict === 'strong') {
          expect(REFILL_MIXING.test(`${node.ending.summary} ${node.ending.lesson}`)).toBe(false);
        }
      }
    }
  });

  it('the decreased-fetal-movement strong path teaches a SEPARATE refill TE', () => {
    const sim = moduleForDomain('classification').simulations.find((s) => s.label === 'OB-GYN');
    // The good choice that reaches the strong ending commits to a separate refill TE.
    const commitsSeparate = Object.values(sim.nodes)
      .filter((n) => n.choices)
      .flatMap((n) => n.choices)
      .filter((c) => c.tone === 'good')
      .some((c) => /separate refill TE/i.test(c.text));
    expect(commitsSeparate).toBe(true);
    // The strong debrief reinforces "separate / its own" for the unrelated refill.
    const strong = Object.values(sim.nodes).find((n) => n.ending?.verdict === 'strong');
    expect(`${strong.ending.summary} ${strong.ending.lesson}`).toMatch(/separate|its own/i);
    expect(`${strong.ending.summary} ${strong.ending.lesson}`).toMatch(/refill/i);
  });
});

describe('moduleForDomain', () => {
  it('returns the module for a known domain and null otherwise', () => {
    expect(moduleForDomain('routing')?.domainId).toBe('routing');
    expect(moduleForDomain('nope')).toBeNull();
  });
});

// ── Department scoping ───────────────────────────────────────────────────────
// The Training page renders "shared + the selected department" and nothing else.
// These guards lock the scoping helper's contract and the catalog metadata it
// reads, so a future content edit can't leak one department's content into the
// other (the PR #34 regression: Pediatrics strep/amoxicillin content rendering
// while OB/GYN was selected).

describe('department scoping helper', () => {
  const shared = { text: 'shared item' };
  const sharedString = 'a plain shared string';
  const peds = { text: 'peds item', departments: ['pediatrics'] };
  const ob = { text: 'ob item', departments: ['obgyn'] };
  const both = { text: 'both item', departments: ['pediatrics', 'obgyn'] };

  it('itemDepartments reports declared scope, and null for shared items', () => {
    expect(itemDepartments(peds)).toEqual(['pediatrics']);
    expect(itemDepartments(shared)).toBeNull();
    expect(itemDepartments(sharedString)).toBeNull();
    expect(itemDepartments(undefined)).toBeNull();
  });

  it('belongsToDept includes shared + selected, excludes the other department', () => {
    expect(belongsToDept(shared, 'pediatrics')).toBe(true);
    expect(belongsToDept(shared, 'obgyn')).toBe(true);
    expect(belongsToDept(sharedString, 'obgyn')).toBe(true);
    expect(belongsToDept(peds, 'pediatrics')).toBe(true);
    expect(belongsToDept(peds, 'obgyn')).toBe(false);
    expect(belongsToDept(ob, 'obgyn')).toBe(true);
    expect(belongsToDept(ob, 'pediatrics')).toBe(false);
    expect(belongsToDept(both, 'pediatrics')).toBe(true);
    expect(belongsToDept(both, 'obgyn')).toBe(true);
  });

  it('scopeForDept keeps shared + selected-department items only', () => {
    const items = [sharedString, shared, peds, ob, both];
    expect(scopeForDept(items, 'pediatrics')).toEqual([sharedString, shared, peds, both]);
    expect(scopeForDept(items, 'obgyn')).toEqual([sharedString, shared, ob, both]);
  });

  it('scopeForDept handles missing/blank arrays safely', () => {
    expect(scopeForDept(undefined, 'pediatrics')).toEqual([]);
    expect(scopeForDept(null, 'obgyn')).toEqual([]);
    expect(scopeForDept([], 'pediatrics')).toEqual([]);
    expect(scopeForDept('not an array', 'pediatrics')).toEqual([]);
  });

  it('itemText reads plain strings and scoped { text } objects alike', () => {
    expect(itemText(sharedString)).toBe('a plain shared string');
    expect(itemText(peds)).toBe('peds item');
    expect(itemText(undefined)).toBe('');
  });
});

// Every scoped item in the catalog, with a readable path for failure messages.
const scopedItems = () => {
  const out = [];
  const push = (item, path) => out.push({ item, path });
  for (const m of TRAINING_MODULES) {
    m.lessons.forEach((lesson, li) => {
      const base = `${m.domainId}.lessons[${li}]`;
      push(lesson, base);
      (lesson.points ?? []).forEach((p, i) => push(p, `${base}.points[${i}]`));
      (lesson.script ?? []).forEach((s, i) => push(s, `${base}.script[${i}]`));
      if (lesson.example) push(lesson.example, `${base}.example`);
      if (lesson.doc) push(lesson.doc, `${base}.doc`);
    });
    (m.mistakes ?? []).forEach((x, i) => push(x, `${m.domainId}.mistakes[${i}]`));
    (m.quickRef?.rows ?? []).forEach((x, i) => push(x, `${m.domainId}.quickRef.rows[${i}]`));
    (m.drill ?? []).forEach((x, i) => push(x, `${m.domainId}.drill[${i}]`));
    (m.simulations ?? []).forEach((x, i) => push(x, `${m.domainId}.simulations[${i}]`));
    (m.keyTakeaways ?? []).forEach((x, i) => push(x, `${m.domainId}.keyTakeaways[${i}]`));
  }
  return out;
};

describe('training catalog department metadata', () => {
  it('exposes exactly the two stable department IDs', () => {
    expect(TRAINING_DEPARTMENTS).toEqual(['pediatrics', 'obgyn']);
  });

  it('every scoped item uses only valid, non-empty department IDs', () => {
    for (const { item, path } of scopedItems()) {
      const depts = itemDepartments(item);
      if (depts === null) continue; // shared
      expect(depts.length, `${path} declares an empty departments array`).toBeGreaterThan(0);
      for (const id of depts) {
        expect(TRAINING_DEPARTMENTS, `${path} declares unknown department "${id}"`).toContain(id);
      }
    }
  });

  it('never uses a display string (e.g. "OB-GYN") as a department ID', () => {
    for (const { item, path } of scopedItems()) {
      const depts = itemDepartments(item) ?? [];
      for (const id of depts) {
        expect(id, `${path} uses a display label instead of a stable ID`).toBe(id.toLowerCase());
        expect(['OB-GYN', 'OB/GYN', 'Pediatrics', 'Peds']).not.toContain(id);
      }
    }
  });

  it('every simulation declares exactly one department matching its label', () => {
    const LABEL_TO_ID = { Pediatrics: 'pediatrics', 'OB-GYN': 'obgyn' };
    for (const { m, sim } of allSims()) {
      expect(Array.isArray(sim.departments), `${m.domainId}/${sim.label} has no departments`).toBe(true);
      expect(sim.departments).toHaveLength(1);
      expect(sim.departments[0], `${m.domainId}/${sim.label} scope must match its label`)
        .toBe(LABEL_TO_ID[sim.label]);
    }
  });
});

describe('per-department usable content', () => {
  // The renderer drops a lesson whose every point belongs to the other
  // department, so "usable" means: a lesson with at least one visible point.
  const visibleLessons = (m, dept) =>
    scopeForDept(m.lessons, dept).filter((l) => scopeForDept(l.points, dept).length > 0);

  for (const dept of ['pediatrics', 'obgyn']) {
    it(`every domain has usable ${dept} content`, () => {
      for (const m of TRAINING_MODULES) {
        expect(visibleLessons(m, dept).length, `${m.domainId} has no ${dept} lesson`).toBeGreaterThan(0);
        expect(scopeForDept(m.simulations, dept).length, `${m.domainId} has no ${dept} simulation`).toBe(1);
        expect(scopeForDept(m.drill, dept).length, `${m.domainId} has no ${dept} drill`).toBeGreaterThan(0);
        expect(scopeForDept(m.mistakes, dept).length, `${m.domainId} has no ${dept} mistake`).toBeGreaterThan(0);
        expect(scopeForDept(m.quickRef?.rows, dept).length, `${m.domainId} has no ${dept} quick-ref row`).toBeGreaterThan(0);
        expect(scopeForDept(m.keyTakeaways, dept).length, `${m.domainId} has no ${dept} takeaway`).toBeGreaterThan(0);
      }
    });
  }
});

describe('department-specific content is explicitly scoped', () => {
  // Text visible for a department after filtering the whole module.
  const visibleText = (m, dept) => {
    const lessons = scopeForDept(m.lessons, dept).map((l) => ({
      points: scopeForDept(l.points, dept).map(itemText),
      script: scopeForDept(l.script, dept),
      example: l.example && belongsToDept(l.example, dept) ? l.example : null,
      doc: l.doc && belongsToDept(l.doc, dept) ? l.doc : null,
    }));
    return JSON.stringify({
      lessons,
      mistakes: scopeForDept(m.mistakes, dept),
      rows: scopeForDept(m.quickRef?.rows, dept),
      drill: scopeForDept(m.drill, dept),
      simulations: scopeForDept(m.simulations, dept),
      takeaways: scopeForDept(m.keyTakeaways, dept).map(itemText),
    });
  };

  const allVisible = (dept) => TRAINING_MODULES.map((m) => visibleText(m, dept)).join('\n');

  // Named routes, providers and workflows that belong to exactly one department.
  const PEDS_ONLY = [
    'Anisa Azeez', 'Marisa Kraft', 'Sally Carilli', 'PEDS Encounters',
    'Concerta', 'amoxicillin', 'strep', 'Fidelis', 'camp',
  ];
  const OBGYN_ONLY = [
    'OB Portal', 'Rebecca Wood', 'Dr. Bank', 'Waiting List Portal',
    'OB Urgent Calls', 'MFM', 'New OB', 'Confirmation of Pregnancy',
    'OB Verified', 'Labor & Delivery', 'fetal movement', 'miscarriage',
    'Annual GYN', 'anatomy scan', 'BPP',
  ];

  it('no Pediatrics-only route, provider or workflow appears in OB/GYN mode', () => {
    const obText = allVisible('obgyn');
    for (const term of PEDS_ONLY) {
      expect(obText.toLowerCase(), `"${term}" leaked into OB/GYN content`).not.toContain(term.toLowerCase());
    }
  });

  it('no OB/GYN-only route, provider or workflow appears in Pediatrics mode', () => {
    const pedsText = allVisible('pediatrics');
    for (const term of OBGYN_ONLY) {
      expect(pedsText.toLowerCase(), `"${term}" leaked into Pediatrics content`).not.toContain(term.toLowerCase());
    }
  });

  it('the confirmed regression content is scoped to its own department', () => {
    const classification = moduleForDomain('classification');
    // The Pediatrics strep/amoxicillin drill never renders for OB/GYN...
    expect(visibleText(classification, 'obgyn')).not.toMatch(/strep test came back/i);
    expect(visibleText(classification, 'pediatrics')).toMatch(/strep test came back/i);
    // ...and the OB/GYN decreased-fetal-movement drill never renders for Peds.
    expect(visibleText(classification, 'pediatrics')).not.toMatch(/moving much less/i);
    expect(visibleText(classification, 'obgyn')).toMatch(/moving much less/i);
  });
});
