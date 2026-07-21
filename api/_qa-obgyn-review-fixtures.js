// ─────────────────────────────────────────────────────────────────────────────
// Non-production SYNTHETIC OB/GYN Call QA review fixtures.
//
// These eight authored calls demonstrate the OB/GYN rubric profile's behavior
// for a human reviewer, and are executed through the real pipeline by
// `api/obgynRubricProfile.test.js` so the documented behavior stays true.
//
// PRIVACY / PROVENANCE: every transcript here is invented rehearsal material.
// Nothing is derived from, exported from, or comparable to the private runtime
// scenario bank (`callQaScenariosPrivate`), no production data is referenced,
// and none of this is calibration evidence — it has no readiness authority.
//
// Each fixture carries:
//   transcript     — the synthetic call
//   graderIntent   — what a CORRECT grader returns (notMet / na / evidence)
//   expect         — the documented pipeline outcome the test asserts
//   demonstrates   — the reviewer-facing point of the fixture
// ─────────────────────────────────────────────────────────────────────────────

import { simulateAutoFails } from './_qa-grading-corpus.js';

export const OBGYN_REVIEW_FIXTURE_SOURCE = 'synthetic-rehearsal-only';
export const OBGYN_REVIEW_FIXTURE_AUTHORITY = 'none';

const nav = (text) => ({ role: 'navigator', text });
const pat = (text) => ({ role: 'patient', text });

// The two approved OB/GYN greetings, both offering assistance.
const GREET_HEALTH = nav('Good morning, thank you for calling Aizer Health, this is Dana. How can I help you today?');
const GREET_WOMENS = nav("Good afternoon, thank you for calling Aizer Women's Health, this is Priya. How can I help you today?");

const CLOSE_OFFER = nav('Is there anything else I can help you with today?');
const CLOSE_THANKS_ONLY = nav('Thank you. Have a good day, goodbye.');

export const OBGYN_REVIEW_FIXTURES = [
  // ── 1. Strong routine call ────────────────────────────────────────────────
  {
    id: 'obgyn-review-strong-routine-scheduling',
    department: 'obgyn',
    demonstrates:
      'Correct opening, identity VOLUNTEERED by the caller in one sentence, no emotional cue, '
      + 'no hold, and an explicit offer of further help. Empathy and narration are NA; closing earns all 5.',
    workflowType: 'annual_vs_gyn_ov',
    transcript: [
      GREET_HEALTH,
      pat('Hi, this is Maria Alvarez, date of birth March 2nd 1991. I would like to book my annual GYN visit.'),
      nav('Thank you Maria, I have your record open. Sure, I can help you schedule that annual visit.'),
      pat('Great, an afternoon would be best.'),
      nav('I can book you with Dr. Reyes on Tuesday the 14th at 2:15 in the afternoon at the Main Street office. Please arrive fifteen minutes early with your insurance card.'),
      pat('That works.'),
      nav('You are booked for an annual GYN visit, Tuesday the 14th at 2:15 at Main Street.'),
      CLOSE_OFFER,
      pat('No, that is everything. Thank you.'),
      nav('You are very welcome. Take care.'),
    ],
    graderIntent: {
      identityEvidence: [
        { field: 'firstName', value: "Maria", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
        { field: 'lastName', value: "Alvarez", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
        { field: 'dob', value: "March 2nd 1991", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
      ],
      na: ['comm-empathy', 'control-narrate', 'doc-te'],
      evidence: {
        'open-greet': 'thank you for calling Aizer Health, this is Dana. How can I help you today?',
        'open-name': 'this is Dana',
        'open-org': 'thank you for calling Aizer Health',
        // Identity was volunteered — the only quotable proof is a CALLER turn.
        'verify-three': 'this is Maria Alvarez, date of birth March 2nd 1991',
        'verify-before-access': 'this is Maria Alvarez, date of birth March 2nd 1991',
        'control-guide': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15',
        'doc-reason': 'You are booked for an annual GYN visit',
        'comm-plain': 'Please arrive fifteen minutes early with your insurance card',
        'comm-professional': 'You are very welcome. Take care.',
        'listen-ack': 'Sure, I can help you schedule that annual visit',
        'listen-gather': 'an afternoon would be best',
        'know-rule': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15',
        'know-details': 'at the Main Street office',
        'sched-flow': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15 in the afternoon at the Main Street office',
        'sched-recap': 'Tuesday the 14th at 2:15 at Main Street',
        'close-offer-help': 'Is there anything else I can help you with today?',
      },
    },
    expect: {
      pass: true,
      naCriteria: ['comm-empathy', 'control-narrate'],
      metCriteria: ['close-offer-help', 'verify-three', 'verify-before-access'],
      closingEarned: 5,
    },
  },

  // ── 2. Correct work, polite sign-off only ─────────────────────────────────
  {
    id: 'obgyn-review-thanks-goodbye-only',
    department: 'obgyn',
    demonstrates:
      'The work is correct but the call ends with "thank you, goodbye" and no offer of further '
      + 'help. The 5 closing points are correctly lost; nothing else changes.',
    workflowType: 'annual_vs_gyn_ov',
    transcript: [
      GREET_HEALTH,
      pat('Hi, this is Maria Alvarez, date of birth March 2nd 1991. I need my annual GYN visit.'),
      nav('Thank you Maria. Sure, I can help you schedule that annual visit.'),
      pat('Any afternoon is fine.'),
      nav('I can book you with Dr. Reyes on Tuesday the 14th at 2:15 in the afternoon at the Main Street office. Please arrive fifteen minutes early.'),
      pat('Perfect, thank you so much.'),
      nav('You are booked for an annual GYN visit, Tuesday the 14th at 2:15 at Main Street.'),
      CLOSE_THANKS_ONLY,
    ],
    graderIntent: {
      identityEvidence: [
        { field: 'firstName', value: "Maria", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
        { field: 'lastName', value: "Alvarez", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
        { field: 'dob', value: "March 2nd 1991", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
      ],
      na: ['comm-empathy', 'control-narrate', 'doc-te'],
      notMet: {
        'close-offer-help': 'The navigator ended with thanks and a goodbye but never offered further assistance.',
      },
      evidence: {
        'open-greet': 'thank you for calling Aizer Health, this is Dana. How can I help you today?',
        'open-name': 'this is Dana',
        'open-org': 'thank you for calling Aizer Health',
        'verify-three': 'this is Maria Alvarez, date of birth March 2nd 1991',
        'verify-before-access': 'this is Maria Alvarez, date of birth March 2nd 1991',
        'control-guide': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15',
        'doc-reason': 'You are booked for an annual GYN visit',
        'comm-plain': 'Please arrive fifteen minutes early',
        'comm-professional': 'Thank you. Have a good day, goodbye.',
        'listen-ack': 'Sure, I can help you schedule that annual visit',
        'listen-gather': 'Any afternoon is fine',
        'know-rule': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15',
        'know-details': 'at the Main Street office',
        'sched-flow': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15 in the afternoon at the Main Street office',
        'sched-recap': 'Tuesday the 14th at 2:15 at Main Street',
      },
    },
    expect: {
      notMetCriteria: ['close-offer-help'],
      closingEarned: 0,
    },
  },

  // ── 3. Worried caller handled well ────────────────────────────────────────
  {
    id: 'obgyn-review-worried-caller-empathy-met',
    department: 'obgyn',
    demonstrates:
      'The caller expresses worry, so empathy APPLIES and is met with natural wording (not a '
      + 'script). The urgent concern is escalated to the clinical team without the navigator '
      + 'triaging or directing the patient anywhere. Closing is valid.',
    workflowType: 'urgent_high_priority_intermedia',
    transcript: [
      GREET_WOMENS,
      pat('Hi, my name is Alina Novak, my date of birth is July 9th 1994. I am really scared, I have not felt the baby move much since last night.'),
      nav('I am so sorry you are dealing with that, Alina, I understand why that would be worrying. Let me get the details so our clinical team can reach you right away.'),
      pat('Okay. It started yesterday evening.'),
      nav('Thank you. How many weeks along are you, and have you had anything to eat or drink recently?'),
      pat('Thirty one weeks, and I had breakfast an hour ago.'),
      nav('Thank you. I am sending this to our OB clinical team as urgent right now so they can call you back quickly. I am not able to tell you what this means myself, they will advise you directly.'),
      pat('Thank you, that helps.'),
      CLOSE_OFFER,
      pat('No, just that. Thank you.'),
    ],
    graderIntent: {
      identityEvidence: [
        { field: 'firstName', value: "Alina", role: 'caller', turnIndex: 1, quote: "my name is Alina Novak, my date of birth is July 9th 1994" },
        { field: 'lastName', value: "Novak", role: 'caller', turnIndex: 1, quote: "my name is Alina Novak, my date of birth is July 9th 1994" },
        { field: 'dob', value: "July 9th 1994", role: 'caller', turnIndex: 1, quote: "my name is Alina Novak, my date of birth is July 9th 1994" },
      ],
      na: ['control-narrate', 'sched-flow', 'sched-recap'],
      evidence: {
        'open-greet': "thank you for calling Aizer Women's Health, this is Priya. How can I help you today?",
        'open-name': 'this is Priya',
        'open-org': "Aizer Women's Health",
        'verify-three': 'my name is Alina Novak, my date of birth is July 9th 1994',
        'verify-before-access': 'my name is Alina Novak, my date of birth is July 9th 1994',
        'control-guide': 'How many weeks along are you, and have you had anything to eat or drink recently?',
        'doc-reason': 'I am sending this to our OB clinical team as urgent right now',
        'doc-te': 'I am sending this to our OB clinical team as urgent right now so they can call you back quickly',
        'comm-plain': 'they will advise you directly',
        'comm-professional': 'Thank you. How many weeks along are you',
        'comm-empathy': 'I am so sorry you are dealing with that, Alina, I understand why that would be worrying',
        'listen-ack': 'Let me get the details so our clinical team can reach you right away',
        'listen-gather': 'How many weeks along are you, and have you had anything to eat or drink recently?',
        'know-rule': 'I am sending this to our OB clinical team as urgent right now so they can call you back quickly',
        'know-details': 'I am not able to tell you what this means myself',
        'close-offer-help': 'Is there anything else I can help you with today?',
      },
    },
    expect: {
      pass: true,
      metCriteria: ['comm-empathy', 'close-offer-help'],
      naCriteria: ['control-narrate'],
    },
  },

  // ── 4. Worried caller, no acknowledgment ──────────────────────────────────
  {
    id: 'obgyn-review-worried-caller-empathy-missed',
    department: 'obgyn',
    demonstrates:
      'Same worried caller and a technically correct workflow, but the navigator never '
      + 'acknowledges the concern. Empathy APPLIES and is correctly NOT_MET — the conditional '
      + 'rule does not mean empathy is optional when a cue exists.',
    workflowType: 'urgent_high_priority_intermedia',
    transcript: [
      GREET_WOMENS,
      pat('Hi, my name is Alina Novak, my date of birth is July 9th 1994. I am really scared, I have not felt the baby move much since last night.'),
      nav('How many weeks along are you?'),
      pat('Thirty one weeks.'),
      nav('And when did you last eat or drink?'),
      pat('About an hour ago.'),
      nav('I am sending this to our OB clinical team as urgent right now so they can call you back quickly.'),
      pat('Okay.'),
      CLOSE_OFFER,
    ],
    graderIntent: {
      identityEvidence: [
        { field: 'firstName', value: "Alina", role: 'caller', turnIndex: 1, quote: "my name is Alina Novak, my date of birth is July 9th 1994" },
        { field: 'lastName', value: "Novak", role: 'caller', turnIndex: 1, quote: "my name is Alina Novak, my date of birth is July 9th 1994" },
        { field: 'dob', value: "July 9th 1994", role: 'caller', turnIndex: 1, quote: "my name is Alina Novak, my date of birth is July 9th 1994" },
      ],
      na: ['control-narrate', 'sched-flow', 'sched-recap'],
      notMet: {
        'comm-empathy': 'The caller said she was scared about reduced fetal movement and the navigator gave no acknowledgment of that concern at any point.',
      },
      evidence: {
        'open-greet': "thank you for calling Aizer Women's Health, this is Priya. How can I help you today?",
        'open-name': 'this is Priya',
        'open-org': "Aizer Women's Health",
        'verify-three': 'my name is Alina Novak, my date of birth is July 9th 1994',
        'verify-before-access': 'my name is Alina Novak, my date of birth is July 9th 1994',
        'control-guide': 'And when did you last eat or drink?',
        'doc-reason': 'I am sending this to our OB clinical team as urgent right now',
        'doc-te': 'I am sending this to our OB clinical team as urgent right now so they can call you back quickly',
        'comm-plain': 'How many weeks along are you?',
        'comm-professional': 'And when did you last eat or drink?',
        'listen-ack': 'How many weeks along are you?',
        'listen-gather': 'And when did you last eat or drink?',
        'know-rule': 'I am sending this to our OB clinical team as urgent right now so they can call you back quickly',
        'know-details': 'I am sending this to our OB clinical team as urgent right now',
        'close-offer-help': 'Is there anything else I can help you with today?',
      },
    },
    expect: {
      notMetCriteria: ['comm-empathy'],
    },
  },

  // ── 5. Phone number instead of DOB ────────────────────────────────────────
  {
    id: 'obgyn-review-phone-instead-of-dob',
    department: 'obgyn',
    demonstrates:
      'Full name plus a phone number is INCOMPLETE verification for OB/GYN — a phone number '
      + 'never substitutes for date of birth, so verify-three is correctly NOT_MET. NOTE for '
      + 'reviewers: verification is only 10 of 100 points, so the NUMERIC score can still land '
      + 'above the pass mark. Both verification criteria are safety-critical, so the review '
      + 'layer refuses to call this a confident pass and routes it to a supervisor. That split '
      + '(numeric pass, non-final recommendation) is the designed behavior, not a gap.',
    workflowType: 'annual_vs_gyn_ov',
    transcript: [
      GREET_HEALTH,
      pat('Hi, I need to move my appointment.'),
      nav('I can help with that. May I have your first and last name please?'),
      pat('Maria Alvarez.'),
      nav('Thank you. And the best phone number for you?'),
      pat('It is five five five, zero one nine nine.'),
      nav('Thank you Maria. Sure, I can help you reschedule that visit.'),
      pat('I would like something later in the month.'),
      nav('I can offer Tuesday the 28th at 3:30 in the afternoon at the Main Street office.'),
      pat('That works, thank you.'),
      CLOSE_OFFER,
    ],
    graderIntent: {
      identityEvidence: [
        { field: 'firstName', value: "Maria", role: 'caller', turnIndex: 3, quote: "Maria Alvarez" },
        { field: 'lastName', value: "Alvarez", role: 'caller', turnIndex: 3, quote: "Maria Alvarez" },
        { field: 'dob', value: "five five five, zero one nine nine", role: 'caller', turnIndex: 5, quote: "It is five five five, zero one nine nine" },
      ],
      na: ['comm-empathy', 'control-narrate', 'doc-te'],
      notMet: {
        'verify-three': 'The navigator collected first name, last name, and a phone number. A phone number does not substitute for date of birth, so the three required identifiers were never completed.',
        'verify-before-access': 'Appointment availability was offered without a completed date of birth check.',
      },
      evidence: {
        'open-greet': 'thank you for calling Aizer Health, this is Dana. How can I help you today?',
        'open-name': 'this is Dana',
        'open-org': 'thank you for calling Aizer Health',
        'control-guide': 'I can offer Tuesday the 28th at 3:30',
        'doc-reason': 'Sure, I can help you reschedule that visit',
        'comm-plain': 'May I have your first and last name please?',
        'comm-professional': 'Thank you Maria',
        'listen-ack': 'Sure, I can help you reschedule that visit',
        'listen-gather': 'And the best phone number for you?',
        'know-rule': 'I can offer Tuesday the 28th at 3:30 in the afternoon at the Main Street office',
        'know-details': 'at the Main Street office',
        'sched-flow': 'I can offer Tuesday the 28th at 3:30 in the afternoon at the Main Street office',
        'sched-recap': 'Tuesday the 28th at 3:30 in the afternoon at the Main Street office',
        'close-offer-help': 'Is there anything else I can help you with today?',
      },
    },
    expect: {
      notMetCriteria: ['verify-three', 'verify-before-access'],
      recommendation: 'needs_review',
      reviewFlags: ['safety-criterion-missed'],
    },
  },

  // ── 6. Disclosure before verification ─────────────────────────────────────
  {
    id: 'obgyn-review-disclosure-before-dob',
    department: 'obgyn',
    demonstrates:
      'The navigator confirms a protected appointment detail FIRST and collects the date of '
      + 'birth afterwards. The later identifiers cannot retroactively satisfy '
      + 'verify-before-access, and the HIPAA auto-fail is available on the disclosing line.',
    workflowType: 'annual_vs_gyn_ov',
    transcript: [
      GREET_HEALTH,
      pat('Hi, it is Maria Alvarez. When is my next visit?'),
      nav('Your appointment is Tuesday the 14th at 2:15 with Dr. Reyes at Main Street.'),
      pat('Oh good.'),
      nav('Let me confirm your date of birth as well please.'),
      pat('March 2nd 1991.'),
      nav('Thank you Maria, that matches.'),
      CLOSE_OFFER,
    ],
    graderIntent: {
      identityEvidence: [
        { field: 'firstName', value: "Maria", role: 'caller', turnIndex: 1, quote: "it is Maria Alvarez" },
        { field: 'lastName', value: "Alvarez", role: 'caller', turnIndex: 1, quote: "it is Maria Alvarez" },
        { field: 'dob', value: "March 2nd 1991", role: 'caller', turnIndex: 5, quote: "March 2nd 1991" },
      ],
      na: ['comm-empathy', 'control-narrate', 'doc-te', 'sched-flow'],
      notMet: {
        'verify-before-access': 'The navigator confirmed the appointment date, time, provider, and location before collecting the date of birth.',
      },
      evidence: {
        'open-greet': 'thank you for calling Aizer Health, this is Dana. How can I help you today?',
        'open-name': 'this is Dana',
        'open-org': 'thank you for calling Aizer Health',
        // Collected, but only AFTER the disclosure.
        'verify-three': 'Let me confirm your date of birth as well please',
        'control-guide': 'Let me confirm your date of birth as well please',
        'doc-reason': 'Thank you Maria, that matches',
        'comm-plain': 'Thank you Maria, that matches',
        'comm-professional': 'Thank you Maria, that matches',
        'listen-ack': 'Let me confirm your date of birth as well please',
        'listen-gather': 'Let me confirm your date of birth as well please',
        'know-rule': 'Let me confirm your date of birth as well please',
        'know-details': 'with Dr. Reyes at Main Street',
        'sched-recap': 'Tuesday the 14th at 2:15 with Dr. Reyes at Main Street',
        'close-offer-help': 'Is there anything else I can help you with today?',
      },
      autoFails: [{
        id: 'af-hipaa',
        evidence: 'Your appointment is Tuesday the 14th at 2:15 with Dr. Reyes at Main Street.',
        note: 'Appointment details were confirmed before the three required identifiers were collected.',
      }],
    },
    expect: {
      notMetCriteria: ['verify-before-access'],
      autoFailed: true,
      pass: false,
      score: 0,
    },
  },

  // ── 7. Quick silent chart check ───────────────────────────────────────────
  {
    id: 'obgyn-review-quick-chart-check-narration-na',
    department: 'obgyn',
    demonstrates:
      'The navigator looks something up quickly with no hold and no meaningful wait. Narration '
      + 'is NA, not NOT_MET — a quick silent chart or schedule check is never a deduction, and '
      + 'dead air cannot be inferred from a text transcript.',
    workflowType: 'annual_vs_gyn_ov',
    transcript: [
      GREET_HEALTH,
      pat('Hi, this is Maria Alvarez, date of birth March 2nd 1991. Am I due for my annual?'),
      nav('Thank you Maria. Okay, let me check your chart. Yes, your annual is due this month, so I can go ahead and schedule it.'),
      pat('Yes please.'),
      nav('I can book you with Dr. Reyes on Tuesday the 14th at 2:15 in the afternoon at the Main Street office.'),
      pat('That is fine.'),
      nav('You are booked for an annual GYN visit, Tuesday the 14th at 2:15 at Main Street.'),
      CLOSE_OFFER,
    ],
    graderIntent: {
      identityEvidence: [
        { field: 'firstName', value: "Maria", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
        { field: 'lastName', value: "Alvarez", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
        { field: 'dob', value: "March 2nd 1991", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
      ],
      na: ['comm-empathy', 'control-narrate', 'doc-te'],
      evidence: {
        'open-greet': 'thank you for calling Aizer Health, this is Dana. How can I help you today?',
        'open-name': 'this is Dana',
        'open-org': 'thank you for calling Aizer Health',
        'verify-three': 'this is Maria Alvarez, date of birth March 2nd 1991',
        'verify-before-access': 'this is Maria Alvarez, date of birth March 2nd 1991',
        'control-guide': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15',
        'doc-reason': 'You are booked for an annual GYN visit',
        'comm-plain': 'your annual is due this month, so I can go ahead and schedule it',
        'comm-professional': 'Thank you Maria',
        'listen-ack': 'Okay, let me check your chart',
        'listen-gather': 'Okay, let me check your chart. Yes, your annual is due this month',
        'know-rule': 'your annual is due this month, so I can go ahead and schedule it',
        'know-details': 'at the Main Street office',
        'sched-flow': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15 in the afternoon at the Main Street office',
        'sched-recap': 'Tuesday the 14th at 2:15 at Main Street',
        'close-offer-help': 'Is there anything else I can help you with today?',
      },
    },
    expect: {
      pass: true,
      naCriteria: ['control-narrate', 'comm-empathy'],
    },
  },

  // ── 8. Explicit unexplained hold ──────────────────────────────────────────
  {
    id: 'obgyn-review-unexplained-hold',
    department: 'obgyn',
    demonstrates:
      'The navigator places the caller on an EXPLICIT hold without explaining it first. '
      + 'Narration APPLIES and is correctly NOT_MET — the conditional rule does not excuse a '
      + 'real, stated hold.',
    workflowType: 'annual_vs_gyn_ov',
    transcript: [
      GREET_HEALTH,
      pat('Hi, this is Maria Alvarez, date of birth March 2nd 1991. I need to book my annual.'),
      nav('Hold on.'),
      pat('...okay.'),
      nav('Back. I can book you with Dr. Reyes on Tuesday the 14th at 2:15 in the afternoon at the Main Street office.'),
      pat('That works.'),
      nav('You are booked for an annual GYN visit, Tuesday the 14th at 2:15 at Main Street.'),
      CLOSE_OFFER,
    ],
    graderIntent: {
      identityEvidence: [
        { field: 'firstName', value: "Maria", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
        { field: 'lastName', value: "Alvarez", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
        { field: 'dob', value: "March 2nd 1991", role: 'caller', turnIndex: 1, quote: "this is Maria Alvarez, date of birth March 2nd 1991" },
      ],
      na: ['comm-empathy', 'doc-te'],
      notMet: {
        'control-narrate': 'The navigator placed the caller on hold with "Hold on." and gave no explanation of the reason or expected wait before doing so.',
      },
      evidence: {
        'open-greet': 'thank you for calling Aizer Health, this is Dana. How can I help you today?',
        'open-name': 'this is Dana',
        'open-org': 'thank you for calling Aizer Health',
        'verify-three': 'this is Maria Alvarez, date of birth March 2nd 1991',
        'verify-before-access': 'this is Maria Alvarez, date of birth March 2nd 1991',
        'control-guide': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15',
        'doc-reason': 'You are booked for an annual GYN visit',
        'comm-plain': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15',
        'comm-professional': 'You are booked for an annual GYN visit',
        'listen-ack': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15',
        'listen-gather': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15',
        'know-rule': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15',
        'know-details': 'at the Main Street office',
        'sched-flow': 'I can book you with Dr. Reyes on Tuesday the 14th at 2:15 in the afternoon at the Main Street office',
        'sched-recap': 'Tuesday the 14th at 2:15 at Main Street',
        'close-offer-help': 'Is there anything else I can help you with today?',
      },
    },
    expect: {
      notMetCriteria: ['control-narrate'],
    },
  },
];

/**
 * Turn a fixture's `graderIntent` into a raw model response for the OB/GYN
 * profile: every criterion gets MET with its authored quote unless it is listed
 * as NA or NOT_MET.
 */
export function simulateObgynGrader(fixture, profile) {
  const { na = [], notMet = {}, evidence = {}, autoFails = [], identityEvidence = [] } = fixture.graderIntent;
  const identityIds = new Set(profile.identityVerificationCriteria ?? []);
  const criteria = profile.criteria.map((definition) => {
    // Identity criteria carry the STRUCTURED identifier claims; every other
    // criterion sends an empty array, exactly as the prompt contract requires.
    const identity = identityIds.has(definition.id) ? identityEvidence : [];
    if (na.includes(definition.id)) {
      return { id: definition.id, verdict: 'NA', basis: 'ABSENCE', evidence: '', note: 'Not applicable to this call.', identityEvidence: [] };
    }
    if (definition.id in notMet) {
      return { id: definition.id, verdict: 'NOT_MET', basis: 'ABSENCE', evidence: '', note: notMet[definition.id], identityEvidence: identity };
    }
    return {
      id: definition.id, verdict: 'MET', basis: 'EVIDENCE',
      evidence: evidence[definition.id] ?? '', note: '',
      identityEvidence: identity,
    };
  });
  // Every auto-fail id must be answered, triggered or not — the same contract
  // the real grader is validated against.
  return { criteria, autoFails: simulateAutoFails(autoFails, profile) };
}
