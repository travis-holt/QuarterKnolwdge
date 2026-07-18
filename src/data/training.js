// Runtime wrapper around the recovered rich training catalog.
//
// The abandoned PR 34 branch carried one positive-path Pediatrics wording bug:
// it offered tomorrow's same-day sick slot today. The current-floor rule is
// strict: same-day sick visits are booked only on the day itself. Keep the
// recovered catalog immutable as source material and apply the correction to
// the exported runtime copy here.

import { TRAINING_MODULES as RECOVERED_TRAINING_MODULES } from './training-rich-catalog.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export const TRAINING_MODULES = clone(RECOVERED_TRAINING_MODULES);

const intake = TRAINING_MODULES.find((module) => module.domainId === 'intake');
const pediatricsSimulation = intake?.simulations?.find((simulation) => simulation.label === 'Pediatrics');
const sameDayNode = pediatricsSimulation?.nodes?.n3;
const correctSameDayChoice = sameDayNode?.choices?.find((choice) => choice.tone === 'good');
const futureDayEnding = pediatricsSimulation?.nodes?.end_sameday?.ending;

if (!correctSameDayChoice || !futureDayEnding) {
  throw new Error('Recovered training catalog is missing the Pediatrics same-day simulation contract.');
}

correctSameDayChoice.text =
  "A sick visit only books for the day itself. I can find a slot today; if tomorrow works better, call us tomorrow for that day's same-day availability. Which would you prefer?";
correctSameDayChoice.feedback =
  'Same-day rule held, and you offered a real path without pre-booking a future-day sick slot.';
futureDayEnding.lesson =
  "Same-day sick = the day itself only. If tomorrow is better, the parent calls tomorrow for that day's same-day availability.";

export const moduleForDomain = (domainId) =>
  TRAINING_MODULES.find((module) => module.domainId === domainId) ?? null;
