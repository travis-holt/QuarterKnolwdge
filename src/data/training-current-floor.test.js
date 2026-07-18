import { describe, expect, it } from 'vitest';
import { TRAINING_MODULES } from './training.js';

const simulations = TRAINING_MODULES.flatMap((module) =>
  (module.simulations ?? []).map((simulation) => ({ module, simulation })),
);

describe('recovered training current-floor authority', () => {
  it('uses the owner-confirmed OB/GYN destinations and excludes legacy PSS OB', () => {
    const catalog = JSON.stringify(TRAINING_MODULES);

    expect(catalog).not.toMatch(/\bPSS OB\b/i);
    expect(catalog).toMatch(/OB Portal/);
    expect(catalog).toMatch(/Rebecca Wood/);
    expect(catalog).toMatch(/Waiting List Portal/);
  });

  it('never teaches a future-day Pediatrics same-day sick booking as correct', () => {
    const futureDayBooking = /book[^.]{0,80}tomorrow|tomorrow[^.]{0,80}book/i;

    for (const { simulation } of simulations.filter(
      ({ simulation }) => simulation.label === 'Pediatrics',
    )) {
      for (const node of Object.values(simulation.nodes)) {
        if (node.choices) {
          for (const choice of node.choices.filter((candidate) => candidate.tone === 'good')) {
            expect(choice.text).not.toMatch(futureDayBooking);
          }
        } else if (node.ending.verdict === 'strong') {
          expect(`${node.ending.summary} ${node.ending.lesson}`).not.toMatch(futureDayBooking);
        }
      }
    }
  });

  it('keeps every Labor and Delivery direction on an explicitly incorrect path', () => {
    for (const { simulation } of simulations.filter(
      ({ simulation }) => simulation.label === 'OB-GYN',
    )) {
      for (const node of Object.values(simulation.nodes)) {
        if (!node.choices) continue;

        for (const choice of node.choices) {
          if (/labor\s*&?\s*delivery|\bL&D\b/i.test(choice.text)) {
            expect(choice.tone).toBe('bad');
          }
        }
      }
    }
  });
});
