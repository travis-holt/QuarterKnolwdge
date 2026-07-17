import { DOMAINS } from './questions.js';
import { COMPETENCIES } from './competencies.js';

// Shared Call QA rubric metadata. Server grading and client-side QA-only domain
// summaries both import this file so the criterion tags live in exactly one place.

export const QA_RUBRIC = [
  {
    id: 'opening', name: 'Opening', criteria: [
      { id: 'open-greet', points: 4, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Opened with a pleasant, professional greeting.' },
      { id: 'open-name', points: 3, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Stated their own first name during the greeting.' },
      { id: 'open-org', points: 3, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Identified the organization (Aizer Health) during the greeting.' },
    ],
  },
  {
    id: 'verification', name: 'Verification', criteria: [
      { id: 'verify-three', points: 6, core: true, domainIds: ['intake', 'boundaries'], competencyIds: ['compliance', 'riskManagement'],
        text: 'Collected three (3) identifiers - first name, last name, and DOB (or home address / phone number) - before discussing any account or chart specifics.' },
      { id: 'verify-before-access', points: 4, core: true, domainIds: ['intake', 'boundaries'], competencyIds: ['compliance', 'riskManagement'],
        text: 'Completed identity verification BEFORE sharing or confirming any account, appointment, or chart detail.' },
    ],
  },
  {
    id: 'callControl', name: 'Call Control', criteria: [
      { id: 'control-narrate', points: 5, core: true, domainIds: ['routing', 'documentation'], competencyIds: ['communication', 'problemResolution'],
        text: 'Narrated system actions or explained waits before them ("I\'m pulling up the schedule now..."), and explained why before any hold.' },
      { id: 'control-guide', points: 5, core: true, domainIds: ['classification'], competencyIds: ['communication', 'problemResolution'],
        text: 'Kept the call moving toward a resolution with purposeful questions - did not drift, stall, or leave the caller directing the call.' },
    ],
  },
  {
    id: 'docReason', name: 'Documentation Reason', criteria: [
      { id: 'doc-reason', points: 6, core: false, domainIds: ['documentation', 'classification'], competencyIds: ['sopApplication', 'communication'],
        text: 'Stated or confirmed an accurate, specific visit/documentation reason matching SOP conventions (e.g., "Shots PE UTD", "GS" for Good Samaritan newborns).' },
      { id: 'doc-te', points: 4, core: false, domainIds: ['routing', 'documentation'], competencyIds: ['escalation', 'sopApplication'],
        text: 'Communicated and/or completed the correct message/routing next step when the scenario called for one. Natural patient-facing language such as "send the request," "send a message," "route this," or "put in a note" counts when the intended destination/workflow is correct; exact "TE" or "Telephone Encounter" wording is not required.' },
    ],
  },
  {
    id: 'communication', name: 'Communication', criteria: [
      { id: 'comm-plain', points: 5, core: true, domainIds: ['intake'], competencyIds: ['communication'],
        text: 'Used simple, jargon-free language the caller could follow.' },
      { id: 'comm-professional', points: 5, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Was courteous and professional in every turn.' },
      { id: 'comm-empathy', points: 5, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Responded warmly and empathetically where the caller expressed worry, frustration, or urgency.' },
    ],
  },
  {
    id: 'activeListening', name: 'Active Listening', criteria: [
      { id: 'listen-ack', points: 5, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Explicitly acknowledged the caller\'s concern ("I understand...", "I hear you...").' },
      { id: 'listen-gather', points: 5, core: true, domainIds: ['intake', 'classification'], competencyIds: ['criticalThinking', 'communication'],
        text: 'Gathered the needed information before answering - no assumptions or premature answers.' },
    ],
  },
  {
    id: 'knowledge', name: 'Knowledge', criteria: [
      { id: 'know-rule', points: 9, core: true, domainIds: ['classification', 'routing', 'boundaries'], competencyIds: ['sopKnowledge', 'sopApplication', 'riskManagement'],
        text: 'Applied the correct SOP rule for this scenario based on the caller\'s actual request and department context. Do not require unrelated SOP checks, exact policy wording, or caller-facing confirmation of system-visible facts unless the scenario makes them the governing issue.' },
      { id: 'know-details', points: 6, core: false, domainIds: ['classification', 'routing', 'scheduling'], competencyIds: ['sopKnowledge', 'sopApplication', 'compliance'],
        text: 'Every concrete detail given (facility, address, provider, process step) was accurate per the SOP - nothing invented.' },
    ],
  },
  {
    id: 'scheduling', name: 'Appointment Scheduling', criteria: [
      { id: 'sched-flow', points: 8, core: false, domainIds: ['scheduling'], competencyIds: ['sopApplication', 'problemResolution'],
        text: 'Reached the correct scheduling outcome - right provider, visit type, and location for the request.' },
      { id: 'sched-recap', points: 7, core: false, domainIds: ['scheduling', 'documentation'], competencyIds: ['communication', 'sopApplication'],
        text: 'Recapped the appointment date, time, and place, and gave arrival instructions.' },
    ],
  },
  {
    id: 'closing', name: 'Closing', criteria: [
      { id: 'close-survey', points: 3, core: true, domainIds: ['documentation'], competencyIds: ['communication', 'customerHandling'],
        text: 'Prompted the caller to stay on the line for the survey before the call ended.' },
      { id: 'close-anything-thanks', points: 2, core: true, domainIds: ['intake'], competencyIds: ['communication', 'customerHandling'],
        text: 'Closed the call courteously - offered further help and/or exchanged thanks and a goodbye. A natural, mutual close counts; exact scripted wording is not required.' },
    ],
  },
];

export const QA_AUTO_FAILS = [
  { id: 'af-hipaa', domainIds: ['boundaries', 'intake'], competencyIds: ['compliance', 'riskManagement'],
    text: 'Disclosed Protected Health Information or discussed account/chart details WITHOUT first completing 3-point identity verification.' },
  { id: 'af-scope', domainIds: ['boundaries'], competencyIds: ['compliance', 'escalation', 'riskManagement'],
    text: 'Read lab/imaging results to the caller or gave clinical/medication advice, instead of transferring to nursing.' },
  { id: 'af-conduct', domainIds: ['boundaries'], competencyIds: ['communication', 'customerHandling'],
    text: 'Used profanity or sarcasm toward the caller.' },
];

export const QA_PASS_THRESHOLD = 85;
export const VERDICTS = new Set(['MET', 'NOT_MET', 'NA']);

// Every negative/positive judgment must declare its BASIS: EVIDENCE = the model
// observed the behavior and quotes it; ABSENCE = the behavior simply did not
// happen (nothing to quote). This lets the pipeline distinguish "the navigator
// did the wrong thing (here is the line)" from "the navigator never did it".
export const BASES = new Set(['EVIDENCE', 'ABSENCE']);

// Rubric version — bump whenever the criteria set, their points, category
// weights, or auto-fail definitions change. Recorded on every stored QA result
// (qa.gradingMetadata.rubricVersion) so a supervisor can tell which rubric graded
// a historical attempt.
export const QA_RUBRIC_VERSION = 'qa-rubric-v2';

export function rubricCriteria(rubric = QA_RUBRIC) {
  return rubric.flatMap((cat) =>
    cat.criteria.map((c) => ({ ...c, categoryId: cat.id, categoryName: cat.name })));
}

export const QA_DOMAIN_IDS = new Set(DOMAINS.map((d) => d.id));
export const QA_COMPETENCY_IDS = new Set(COMPETENCIES.map((c) => c.id));
