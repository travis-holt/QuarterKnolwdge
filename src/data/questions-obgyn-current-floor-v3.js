// Curated OB/GYN MCQ bank grounded in the owner-confirmed Women's Health
// Patient Navigator SOP v1.0, effective 2026-07-17.
//
// This bank deliberately replaces the stale OB/GYN half of the older operating-
// model v2 bank. It tests chart-first reasoning, paired scheduling, routing,
// scope boundaries, documentation, and escalation with realistic near-misses.
//
// Do not change source/version fields casually. They are used by the supervisor
// review UI and the marker-gated Firestore migration.
import {
  OBGYN_RULE_SET_VERSION,
  OBGYN_SOP_VERSION,
  OBGYN_SOURCE_AUTHORITY,
} from './obgynWorkflowRules.js';

export const OBGYN_CURRENT_FLOOR_BANK_VERSION =
  'obgyn-current-floor-assessment-bank-v3-answer-balance-2026-07-19';

const rawQuestions = [
  {
    "id": "qv3-obgyn-intake-1",
    "domainId": "intake",
    "competencies": [
      "criticalThinking",
      "sopApplication",
      "riskManagement"
    ],
    "scenario": "A patient says she needs a \"checkup.\" The chart shows an active pregnancy, a recent OB visit, and Medical Summary: \"RTO 3 weeks BPP w/MD.\" Her last Annual GYN was 15 months ago. What should control your next step?",
    "options": [
      {
        "id": "a",
        "text": "Book an Annual GYN because her annual is overdue and she used the word checkup.",
        "points": 20,
        "rationale": "The overdue annual is real, but the current pregnancy and documented RTO control this request."
      },
      {
        "id": "b",
        "text": "Ask only what she means by checkup and schedule from her answer without reviewing the chart further.",
        "points": 35,
        "rationale": "Clarifying helps, but the chart already contains the controlling next-step instruction."
      },
      {
        "id": "c",
        "text": "Follow the documented RTO: build the BPP-provider pair, using OB Portal only if clarification is needed.",
        "points": 100,
        "rationale": "Correct: chart documentation outranks the caller's broad label. The documented BPP with MD controls the scheduling components."
      },
      {
        "id": "d",
        "text": "Schedule a routine provider-only OB visit because RTO always means an MD visit without a scan.",
        "points": 0,
        "rationale": "This ignores the explicitly documented BPP component."
      }
    ],
    "correctOptionId": "c",
    "ruleIds": [
      "rto_documentation",
      "growth_bpp_plus_md"
    ],
    "workflowType": "growth_bpp_plus_md"
  },
  {
    "id": "qv3-obgyn-intake-2",
    "domainId": "intake",
    "competencies": [
      "criticalThinking",
      "sopKnowledge",
      "sopApplication"
    ],
    "scenario": "A patient says she is newly pregnant. Her chart contains a New OB visit from two years ago, but no current prenatal sequence. She gives a reliable current LMP that places her at 6 weeks today. What is the correct interpretation?",
    "options": [
      {
        "id": "a",
        "text": "Treat the old New OB visit as proof that the current pregnancy is already established and book a routine OB check.",
        "points": 0,
        "rationale": "An old pregnancy does not establish current OB care."
      },
      {
        "id": "b",
        "text": "Treat this as a new pregnancy and use the reliable LMP to build the New OB pair within the 8–12-week window.",
        "points": 100,
        "rationale": "Correct: old pregnancy history is context only. Current reliable LMP starts the current New OB workflow."
      },
      {
        "id": "c",
        "text": "Book Confirmation of Pregnancy solely because the positive test was done at home.",
        "points": 30,
        "rationale": "A home test alone does not require Confirmation when LMP is reliable and standard New OB timing can be built."
      },
      {
        "id": "d",
        "text": "Send a clinical TE and avoid scheduling until a nurse confirms that she is pregnant.",
        "points": 20,
        "rationale": "No clinical approval is needed for the standard reliable-LMP New OB workflow."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "new_ob_known_lmp",
      "new_ob_pairing"
    ],
    "workflowType": "known_vs_unknown_lmp"
  },
  {
    "id": "qv3-obgyn-intake-3",
    "domainId": "intake",
    "competencies": [
      "criticalThinking",
      "escalation",
      "sopApplication"
    ],
    "scenario": "A patient returns a missed nurse call after a Confirmation of Pregnancy visit. The note documents gestational age as 13 weeks 6 days and says the next step is prenatal care, but no exact appointment construction is recorded. What should you do?",
    "options": [
      {
        "id": "a",
        "text": "Force the standard 8–12-week New OB pair into the next open slots because Confirmation has already been completed.",
        "points": 25,
        "rationale": "Confirmation documentation often supports direct New OB booking, but this timing is clearly outside the usual window and the exact construction is not documented."
      },
      {
        "id": "b",
        "text": "Book another 15-minute Confirmation visit so the provider can repeat the same assessment.",
        "points": 10,
        "rationale": "The Confirmation has already been completed; repeating it does not resolve the out-of-window scheduling question."
      },
      {
        "id": "c",
        "text": "Send a TE to OB Portal for approval and exact instructions before building the appointment, then follow the documented construction.",
        "points": 100,
        "rationale": "Correct: clearly out-of-window timing requires clinical approval rather than forcing the normal New OB schedule."
      },
      {
        "id": "d",
        "text": "Book a routine provider-only OB visit and omit sonography because she is already past 12 weeks.",
        "points": 0,
        "rationale": "The navigator cannot invent a different prenatal construction from gestational age alone."
      }
    ],
    "correctOptionId": "c",
    "ruleIds": [
      "confirmation_unknown_lmp",
      "new_ob_outside_window_approval"
    ],
    "workflowType": "new_ob_outside_window_approval"
  },
  {
    "id": "qv3-obgyn-intake-4",
    "domainId": "intake",
    "competencies": [
      "criticalThinking",
      "communication",
      "escalation"
    ],
    "scenario": "A patient at about 31 weeks wants to transfer prenatal care. She says she emailed records yesterday and asks you to confirm that the practice has accepted her. You cannot access the shared email inbox. What is the best response?",
    "options": [
      {
        "id": "a",
        "text": "Tell her transfers after 31 weeks are automatically declined.",
        "points": 0,
        "rationale": "The current workflow uses clinical review, not a rigid navigator-enforced cutoff."
      },
      {
        "id": "b",
        "text": "Promise acceptance because she says the records were sent, then book a New OB pair.",
        "points": 0,
        "rationale": "Sending records does not establish receipt or acceptance, and transfers are not automatically built as standard New OB pairs."
      },
      {
        "id": "c",
        "text": "Document the transfer details, ask OB Portal to confirm receipt and review acceptance, and make no promise of acceptance.",
        "points": 100,
        "rationale": "Correct: gather the transfer facts, use the clinical review path, and avoid promising acceptance."
      },
      {
        "id": "d",
        "text": "Ask her to resend the records repeatedly until you can personally find them, without creating a TE.",
        "points": 35,
        "rationale": "Resending may be useful later, but email receipt requires clinical-team confirmation and the transfer still needs review."
      }
    ],
    "correctOptionId": "c",
    "ruleIds": [
      "transfer_ob"
    ],
    "workflowType": "transfer_ob"
  },
  {
    "id": "qv3-obgyn-classification-1",
    "domainId": "classification",
    "competencies": [
      "sopKnowledge",
      "sopApplication",
      "criticalThinking"
    ],
    "scenario": "A non-pregnant patient reports non-emergency irregular periods. Her chart shows a Pap-only visit four months ago, a postpartum visit eight months ago, and her last completed in-department Annual GYN was 16 months ago. Which routine visit type is correct?",
    "options": [
      {
        "id": "a",
        "text": "GYN Office Visit, because the Pap and postpartum visit together make her annual current.",
        "points": 20,
        "rationale": "Neither a Pap-only encounter nor postpartum visit makes the Annual GYN current for this rule."
      },
      {
        "id": "b",
        "text": "Annual GYN, with irregular periods included in the reason.",
        "points": 100,
        "rationale": "Correct: the last actual in-department Annual GYN is over one year old, so routine scheduling uses Annual GYN."
      },
      {
        "id": "c",
        "text": "GYN Urgent, because irregular bleeding is always urgent.",
        "points": 0,
        "rationale": "Urgent appointment types require clinical approval; non-emergency irregular periods follow routine annual-status logic."
      },
      {
        "id": "d",
        "text": "No appointment; send every non-pregnant GYN concern to OB Portal.",
        "points": 30,
        "rationale": "Routine GYN scheduling is handled directly when an appropriate slot exists."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "annual_gyn_vs_gyn_ov"
    ],
    "workflowType": "annual_vs_gyn_ov"
  },
  {
    "id": "qv3-obgyn-classification-2",
    "domainId": "classification",
    "competencies": [
      "criticalThinking",
      "sopKnowledge",
      "riskManagement"
    ],
    "scenario": "A patient has a positive home pregnancy test. She can name a date she thinks was her last period, but says her cycles are very irregular and she is not confident the date is accurate. What is the correct workflow?",
    "options": [
      {
        "id": "a",
        "text": "Treat the date as reliable and book the New OB pair for 8–12 weeks.",
        "points": 30,
        "rationale": "The timing depends on a reliable LMP; this patient has explicitly said the date is uncertain."
      },
      {
        "id": "b",
        "text": "Schedule a 15-minute provider Confirmation of Pregnancy and do not independently add a lab or sonogram.",
        "points": 100,
        "rationale": "Correct: unknown or unreliable LMP uses Confirmation first."
      },
      {
        "id": "c",
        "text": "Ask her to estimate the date more carefully and use whichever date she chooses.",
        "points": 10,
        "rationale": "The navigator should not manufacture reliable gestational timing from an uncertain estimate."
      },
      {
        "id": "d",
        "text": "Send her directly for pregnancy bloodwork before any provider visit.",
        "points": 0,
        "rationale": "The current navigator workflow does not independently add lab work."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "confirmation_unknown_lmp"
    ],
    "workflowType": "known_vs_unknown_lmp"
  },
  {
    "id": "qv3-obgyn-classification-3",
    "domainId": "classification",
    "competencies": [
      "criticalThinking",
      "riskManagement",
      "escalation"
    ],
    "scenario": "A patient at 34 weeks reports markedly decreased fetal movement since last night. In the same call, she asks for a prenatal-vitamin refill. How should the two requests be handled?",
    "options": [
      {
        "id": "a",
        "text": "Put both requests into one High Priority TE so the clinical team sees everything together.",
        "points": 45,
        "rationale": "The serious symptom needs urgent escalation, but the unrelated refill should not be mixed into the same issue."
      },
      {
        "id": "b",
        "text": "Process the refill first because it is straightforward, then send a routine symptom TE.",
        "points": 0,
        "rationale": "The serious symptom takes priority and requires more than a routine TE."
      },
      {
        "id": "c",
        "text": "Send High Priority TE to OB Portal and use urgent Intermedia channel; put the refill in a separate TE.",
        "points": 100,
        "rationale": "Correct: prioritize the serious symptom and preserve clean issue ownership by separating the unrelated refill."
      },
      {
        "id": "d",
        "text": "Tell her to perform a kick count and call back later, then process the refill.",
        "points": 0,
        "rationale": "That is clinical direction and delays the current-floor urgent escalation."
      }
    ],
    "correctOptionId": "c",
    "ruleIds": [
      "urgent_high_priority",
      "urgent_intermedia_escalation",
      "refill",
      "existing_te_take_action"
    ],
    "workflowType": "urgent_intermedia_escalation"
  },
  {
    "id": "qv3-obgyn-classification-4",
    "domainId": "classification",
    "competencies": [
      "riskManagement",
      "escalation",
      "compliance"
    ],
    "scenario": "A patient says she miscarried over the weekend. The chart still shows a sonogram and OB visit next week. What is the navigator's correct classification and first action?",
    "options": [
      {
        "id": "a",
        "text": "Treat it as a cancellation request and remove both future appointments immediately.",
        "points": 0,
        "rationale": "The navigator must not independently change the pregnancy schedule after a reported loss."
      },
      {
        "id": "b",
        "text": "Escalate through a High Priority OB Portal TE and the urgent channel before changing the chart or appointments.",
        "points": 100,
        "rationale": "Correct: pregnancy loss requires urgent clinical review and the schedule remains unchanged until directed."
      },
      {
        "id": "c",
        "text": "Convert the future OB visit to a GYN follow-up without asking the clinical team.",
        "points": 15,
        "rationale": "The navigator cannot decide the follow-up visit type."
      },
      {
        "id": "d",
        "text": "Ask whether she is certain it was a miscarriage and decide whether escalation is needed.",
        "points": 0,
        "rationale": "Determining pregnancy loss is clinical judgment outside navigator scope."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "pregnancy_loss"
    ],
    "workflowType": "pregnancy_loss"
  },
  {
    "id": "qv3-obgyn-routing-1",
    "domainId": "routing",
    "competencies": [
      "criticalThinking",
      "sopApplication",
      "problemResolution"
    ],
    "scenario": "A patient calls back about the same refill that already has an open TE. During the call she also says she missed a glucose-test appointment and wants it rescheduled. What is the cleanest workflow?",
    "options": [
      {
        "id": "a",
        "text": "Create one new TE that combines the refill follow-up and missed lab request.",
        "points": 20,
        "rationale": "This duplicates the refill issue and mixes two unrelated workflows."
      },
      {
        "id": "b",
        "text": "Take Action on the refill TE, and send the missed-lab request separately to OB Portal without scheduling it.",
        "points": 100,
        "rationale": "Correct: same issue updates the existing TE, while the unrelated lab request gets its own routed TE."
      },
      {
        "id": "c",
        "text": "Create a second refill TE and directly reschedule the lab from the order in the chart.",
        "points": 0,
        "rationale": "Both actions violate the current workflow: duplicate same-issue TE and navigator lab scheduling."
      },
      {
        "id": "d",
        "text": "Use Take Action on the refill TE and add the lab request there as another sentence.",
        "points": 35,
        "rationale": "The refill update belongs there; the lab issue does not."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "existing_te_take_action",
      "lab_boundary"
    ],
    "workflowType": "existing_te_take_action"
  },
  {
    "id": "qv3-obgyn-routing-2",
    "domainId": "routing",
    "competencies": [
      "riskManagement",
      "customerHandling",
      "escalation"
    ],
    "scenario": "A patient says, \"I only see Dr. Bank,\" but she is now reporting severe heavy bleeding. What is the best response?",
    "options": [
      {
        "id": "a",
        "text": "Send only a Waiting List Portal TE because provider preference controls the request.",
        "points": 0,
        "rationale": "A serious symptom cannot wait on provider preference or future availability."
      },
      {
        "id": "b",
        "text": "Directly schedule Dr. Bank in the first slot you can find because the symptom sounds serious.",
        "points": 0,
        "rationale": "Navigators do not directly schedule Dr. Bank and do not self-authorize urgent appointments."
      },
      {
        "id": "c",
        "text": "Escalate the bleeding through a High Priority OB Portal TE and urgent channel; keep the Dr. Bank wait-list request separate.",
        "points": 100,
        "rationale": "Correct: serious-symptom escalation takes priority; preference does not delay care."
      },
      {
        "id": "d",
        "text": "Tell her to go to Labor and Delivery and close the call.",
        "points": 20,
        "rationale": "The current navigator workflow is urgent clinical escalation, not independent L&D direction."
      }
    ],
    "correctOptionId": "c",
    "ruleIds": [
      "dr_bank_waitlist",
      "urgent_high_priority",
      "urgent_intermedia_escalation"
    ],
    "workflowType": "dr_bank_waitlist"
  },
  {
    "id": "qv3-obgyn-routing-3",
    "domainId": "routing",
    "competencies": [
      "sopKnowledge",
      "criticalThinking",
      "sopApplication"
    ],
    "scenario": "A pregnant patient says she was told to get an anatomy scan with Dr. Rosenberg. The chart shows a routine Anatomy order and no MFM referral or MFM appointment. Which path is correct?",
    "options": [
      {
        "id": "a",
        "text": "Route the request to Rebecca Wood because Dr. Rosenberg's name makes every scan an MFM visit.",
        "points": 20,
        "rationale": "Routine Anatomy uses Dr. Rosenberg on the scan record but remains ordinary OB scheduling."
      },
      {
        "id": "b",
        "text": "Build the routine Anatomy scan with Dr. Rosenberg plus the required separate OB provider visit.",
        "points": 100,
        "rationale": "Correct: the scan-provider field does not convert routine Anatomy into MFM care."
      },
      {
        "id": "c",
        "text": "Schedule the Anatomy scan alone because the order names only the scan.",
        "points": 30,
        "rationale": "The routine workflow includes the separate provider visit unless documentation clearly says otherwise."
      },
      {
        "id": "d",
        "text": "Tell her no appointment can be made until an MFM referral is created.",
        "points": 0,
        "rationale": "A routine Anatomy order does not require an MFM referral."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "anatomy_plus_md",
      "mfm_routing"
    ],
    "workflowType": "anatomy_plus_md"
  },
  {
    "id": "qv3-obgyn-routing-4",
    "domainId": "routing",
    "competencies": [
      "criticalThinking",
      "escalation",
      "riskManagement"
    ],
    "scenario": "A patient says, \"The provider told me I need another growth ultrasound,\" but Medical Summary, the last note, and related TEs show no scan order. What do you do?",
    "options": [
      {
        "id": "a",
        "text": "Schedule the growth scan because the patient's recollection is enough to prevent delay.",
        "points": 0,
        "rationale": "Patient wording is not a documented order."
      },
      {
        "id": "b",
        "text": "Schedule a routine provider visit only and let the provider add the scan later.",
        "points": 30,
        "rationale": "This invents a replacement workflow instead of clarifying the requested scan."
      },
      {
        "id": "c",
        "text": "Send OB Portal a clarification TE and schedule only after the missing sonogram order or approval is documented.",
        "points": 100,
        "rationale": "Correct: the chart must support the scan, and uncertainty is routed rather than guessed."
      },
      {
        "id": "d",
        "text": "Create the scan order yourself and build the appointment.",
        "points": 0,
        "rationale": "Navigators cannot self-order sonography."
      }
    ],
    "correctOptionId": "c",
    "ruleIds": [
      "missing_sonography_order"
    ],
    "workflowType": "missing_rto_order"
  },
  {
    "id": "qv3-obgyn-scheduling-1",
    "domainId": "scheduling",
    "competencies": [
      "sopKnowledge",
      "sopApplication",
      "riskManagement"
    ],
    "scenario": "A reliable-LMP patient needs her New OB appointment. You find a 30-minute sonography block at 9:00, a provider New OB slot at 9:30, but the provider line is already triple booked at 9:30. What is the correct action?",
    "options": [
      {
        "id": "a",
        "text": "Book both because the times are back-to-back and the patient needs the visit.",
        "points": 35,
        "rationale": "Back-to-back timing is necessary, but an improperly triple-booked provider line is not a valid pair."
      },
      {
        "id": "b",
        "text": "Book the sonogram at 9:00 and place the provider visit later that afternoon.",
        "points": 10,
        "rationale": "The pair cannot be separated by a waiting gap."
      },
      {
        "id": "c",
        "text": "Find another valid back-to-back sonogram-provider pair on an appropriate line, then mark the second appointment OB Verified.",
        "points": 100,
        "rationale": "Correct: all construction rules must be satisfied, not only the times."
      },
      {
        "id": "d",
        "text": "Book the provider first at 9:00 and sonogram at 9:30 to avoid the triple booking.",
        "points": 0,
        "rationale": "New OB requires sonogram first, provider second."
      }
    ],
    "correctOptionId": "c",
    "ruleIds": [
      "new_ob_pairing"
    ],
    "workflowType": "new_ob_pairing"
  },
  {
    "id": "qv3-obgyn-scheduling-2",
    "domainId": "scheduling",
    "competencies": [
      "criticalThinking",
      "problemResolution",
      "sopApplication"
    ],
    "scenario": "Medical Summary says, \"RTO 2 weeks BPP w/MD.\" No same-provider pair is available in that window, but another OB provider can see the patient immediately after an available BPP slot. What is the best option?",
    "options": [
      {
        "id": "a",
        "text": "Book the BPP only and leave the MD visit where it was.",
        "points": 0,
        "rationale": "A required pair cannot be split."
      },
      {
        "id": "b",
        "text": "Build the back-to-back BPP-provider pair with the other appropriate OB provider, preserving the documented window.",
        "points": 100,
        "rationale": "Correct: the workflow permits another appropriate OB provider when it creates a valid pair."
      },
      {
        "id": "c",
        "text": "Book a provider-only visit and tell the patient to arrange the BPP later.",
        "points": 0,
        "rationale": "This drops the documented scan component."
      },
      {
        "id": "d",
        "text": "Overbook the requested provider without written approval.",
        "points": 30,
        "rationale": "An overbook needs traceable approval; it is unnecessary when a valid pair exists."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "rto_documentation",
      "growth_bpp_plus_md",
      "paired_appointment_reschedule"
    ],
    "workflowType": "growth_bpp_plus_md"
  },
  {
    "id": "qv3-obgyn-scheduling-3",
    "domainId": "scheduling",
    "competencies": [
      "sopKnowledge",
      "sopApplication",
      "communication"
    ],
    "scenario": "A patient calls at 10 weeks postpartum. She knows exactly which IUD she wants inserted at the postpartum visit, and the visit will be with Dr. Scott Stanislawski. Which construction is correct?",
    "options": [
      {
        "id": "a",
        "text": "Reject postpartum scheduling because it is later than the usual 6–8-week window.",
        "points": 0,
        "rationale": "A postpartum visit may still be booked at about ten weeks."
      },
      {
        "id": "b",
        "text": "Book the 15-minute postpartum IUD visit and document delivery details; omit the usual post-insertion sonogram for this provider.",
        "points": 100,
        "rationale": "Correct: the later postpartum timing is acceptable, and Dr. Stanislawski is the no-post-insertion-sonogram exception."
      },
      {
        "id": "c",
        "text": "Book a GYN Sono before the postpartum visit so the IUD can be inserted safely.",
        "points": 0,
        "rationale": "The provider visit comes first, and this provider does not require the post-insertion sonogram."
      },
      {
        "id": "d",
        "text": "Book a routine Annual GYN instead because IUD insertion cannot occur during postpartum.",
        "points": 20,
        "rationale": "The insertion may occur during the postpartum visit when the patient knows which IUD she wants."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "postpartum",
      "postpartum_iud"
    ],
    "workflowType": "postpartum_iud"
  },
  {
    "id": "qv3-obgyn-scheduling-4",
    "domainId": "scheduling",
    "competencies": [
      "criticalThinking",
      "sopKnowledge",
      "sopApplication"
    ],
    "scenario": "A non-postpartum patient requests IUD insertion with Dr. Frieda Klein. Her last actual in-department Annual GYN was 18 months ago. Which appointment build is correct?",
    "options": [
      {
        "id": "a",
        "text": "Book a 15-minute OB-schedule visit followed by GYN Sono.",
        "points": 0,
        "rationale": "Dr. Klein remains 30 minutes and does not use the OB schedule."
      },
      {
        "id": "b",
        "text": "Book a 30-minute Annual GYN followed by GYN Sono, marking the second appointment OB Verified.",
        "points": 100,
        "rationale": "Correct: annual is not current, Dr. Klein uses the 30-minute GYN workflow, and the provider-first pair ends with OB Verified."
      },
      {
        "id": "c",
        "text": "Book a GYN Office Visit because the purpose is IUD insertion, followed by no sonogram.",
        "points": 20,
        "rationale": "Annual status still controls the routine visit type, and Dr. Klein is not the no-sonogram exception."
      },
      {
        "id": "d",
        "text": "Book the GYN Sono first, then the provider insertion visit.",
        "points": 0,
        "rationale": "The insertion provider visit comes before the GYN sonogram."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "annual_gyn_vs_gyn_ov",
      "iud_insertion_plus_sono"
    ],
    "workflowType": "iud_plus_gyn_sono"
  },
  {
    "id": "qv3-obgyn-boundaries-1",
    "domainId": "boundaries",
    "competencies": [
      "riskManagement",
      "escalation",
      "compliance"
    ],
    "scenario": "A pregnant patient reports significant bleeding. An OB Urgent slot is visibly open in 40 minutes, but there is no nurse or provider approval in the chart, TE, or Teams. What should you do?",
    "options": [
      {
        "id": "a",
        "text": "Book the open urgent slot because availability is implied authorization.",
        "points": 0,
        "rationale": "An open slot is not clinical approval."
      },
      {
        "id": "b",
        "text": "Send a High Priority OB Portal TE and urgent-channel message, then await clinical direction before booking.",
        "points": 100,
        "rationale": "Correct: serious symptoms use the urgent escalation path; clinical staff decide the appointment."
      },
      {
        "id": "c",
        "text": "Tell the patient the bleeding is probably safe to wait 40 minutes, then book it.",
        "points": 0,
        "rationale": "That combines clinical reassurance with unauthorized scheduling."
      },
      {
        "id": "d",
        "text": "Direct her to Labor and Delivery without involving the clinical team.",
        "points": 20,
        "rationale": "The current navigator workflow does not independently direct L&D care."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "urgent_high_priority",
      "urgent_intermedia_escalation"
    ],
    "workflowType": "urgent_requires_approval"
  },
  {
    "id": "qv3-obgyn-boundaries-2",
    "domainId": "boundaries",
    "competencies": [
      "criticalThinking",
      "riskManagement",
      "sopApplication"
    ],
    "scenario": "A nurse gives written approval for an OB Urgent visit at 2:00 and says the patient also needs an OB URGENT SONO, but does not state whether the sonogram is before or after the provider. What is the safest action?",
    "options": [
      {
        "id": "a",
        "text": "Book the approved 15-minute OB Urgent and choose sonogram first because scans usually come first.",
        "points": 40,
        "rationale": "The urgent visit is approved, but the sonogram sequence cannot be invented."
      },
      {
        "id": "b",
        "text": "Follow the written OB Urgent approval, but clarify the sonogram sequence before completing the pair.",
        "points": 100,
        "rationale": "Correct: honor the written approval while clarifying the missing clinically directed sequence."
      },
      {
        "id": "c",
        "text": "Skip the sonogram and book only the provider because the sequence is unclear.",
        "points": 20,
        "rationale": "This drops a specifically approved component."
      },
      {
        "id": "d",
        "text": "Do not book anything, even the explicitly approved urgent visit.",
        "points": 30,
        "rationale": "The approval authorizes the urgent visit; only the incomplete sonography instruction needs clarification."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "nurse_approved_ob_urgent"
    ],
    "workflowType": "urgent_requires_approval"
  },
  {
    "id": "qv3-obgyn-boundaries-3",
    "domainId": "boundaries",
    "competencies": [
      "compliance",
      "sopApplication",
      "communication"
    ],
    "scenario": "A patient sees an active lab order in her portal and asks you to book the lab for tomorrow. She also asks whether the result from last week was normal. What can the navigator do?",
    "options": [
      {
        "id": "a",
        "text": "Book the lab because the order already exists, but decline to discuss the result.",
        "points": 30,
        "rationale": "Current-floor navigators do not schedule OB/GYN labs even when an order is visible."
      },
      {
        "id": "b",
        "text": "Tell her the prior result looks normal and send a TE only for the new appointment.",
        "points": 0,
        "rationale": "Interpreting a result is outside scope, and the lab appointment is also routed."
      },
      {
        "id": "c",
        "text": "Send both lab questions to OB Portal in a TE, without booking or interpreting anything.",
        "points": 100,
        "rationale": "Correct: all OB/GYN lab appointment, order, missed-lab, and result questions go to OB Portal."
      },
      {
        "id": "d",
        "text": "Transfer her to any available scheduler because labs are routine.",
        "points": 10,
        "rationale": "The current rule routes lab matters to the clinical portal, not direct navigator scheduling."
      }
    ],
    "correctOptionId": "c",
    "ruleIds": [
      "lab_boundary"
    ],
    "workflowType": "lab_boundary"
  },
  {
    "id": "qv3-obgyn-boundaries-4",
    "domainId": "boundaries",
    "competencies": [
      "compliance",
      "escalation",
      "customerHandling"
    ],
    "scenario": "An outside office calls asking you to schedule a new MFM appointment for its patient. No referral or order from a Women's Health provider in your department is visible. What is the correct boundary?",
    "options": [
      {
        "id": "a",
        "text": "Schedule the MFM visit because the request came from another clinician.",
        "points": 15,
        "rationale": "Outside-provider status does not replace the required in-department referral workflow."
      },
      {
        "id": "b",
        "text": "Require an in-department Women's Health referral and route the MFM inquiry to Rebecca Wood; do not schedule.",
        "points": 100,
        "rationale": "Correct: MFM has a dedicated owner and a referral boundary."
      },
      {
        "id": "c",
        "text": "Route it through general OB scheduling and let that team decide.",
        "points": 20,
        "rationale": "MFM requests do not use general OB scheduling."
      },
      {
        "id": "d",
        "text": "Create a routine Anatomy scan because that is usually why patients need MFM.",
        "points": 0,
        "rationale": "Routine Anatomy and MFM are different workflows."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "mfm_routing"
    ],
    "workflowType": "mfm_owner"
  },
  {
    "id": "qv3-obgyn-documentation-1",
    "domainId": "documentation",
    "competencies": [
      "communication",
      "riskManagement",
      "sopApplication"
    ],
    "scenario": "A patient calls back with worsening severe pelvic pain about an open TE for the same issue. Which documentation is strongest?",
    "options": [
      {
        "id": "a",
        "text": "Create a duplicate TE with Reason \"URGENT!!!\" and leave the original open.",
        "points": 0,
        "rationale": "This duplicates the same issue and substitutes typed emphasis for system priority."
      },
      {
        "id": "b",
        "text": "Take Action: add worsening facts to OB Portal TE, mark High Priority, and alert urgent channel.",
        "points": 100,
        "rationale": "Correct: update the same issue, use the system priority and urgent communication workflow, and document without diagnosing."
      },
      {
        "id": "c",
        "text": "Add a general chart note saying the patient called again and wait.",
        "points": 10,
        "rationale": "A general note neither updates the working TE nor triggers urgent communication."
      },
      {
        "id": "d",
        "text": "Change the reason to a diagnosis you think explains the pain.",
        "points": 0,
        "rationale": "Navigators document reported symptoms, not diagnoses."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "existing_te_take_action",
      "urgent_high_priority",
      "urgent_intermedia_escalation"
    ],
    "workflowType": "existing_te_take_action"
  },
  {
    "id": "qv3-obgyn-documentation-2",
    "domainId": "documentation",
    "competencies": [
      "sopApplication",
      "communication",
      "problemResolution"
    ],
    "scenario": "A patient calls about the same refill already documented in an open TE. The e-prescription log confirms the medication and prescribing provider, but she has changed pharmacies. What should you record?",
    "options": [
      {
        "id": "a",
        "text": "Create a fresh refill TE so the new pharmacy does not get missed.",
        "points": 25,
        "rationale": "The issue is still the same refill; a new TE creates duplicate work."
      },
      {
        "id": "b",
        "text": "Take Action on the refill TE, adding the new pharmacy and callback details without promising approval or timing.",
        "points": 100,
        "rationale": "Correct: update the existing request with the changed actionable detail."
      },
      {
        "id": "c",
        "text": "Tell her the prescription will be sent to the new pharmacy today and close the TE.",
        "points": 0,
        "rationale": "The navigator cannot promise approval or timing."
      },
      {
        "id": "d",
        "text": "Change only the pharmacy in demographics and do not update the refill TE.",
        "points": 30,
        "rationale": "The clinical work item must contain the current pharmacy so the team can act."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "refill",
      "existing_te_take_action"
    ],
    "workflowType": "refill_details"
  },
  {
    "id": "qv3-obgyn-documentation-3",
    "domainId": "documentation",
    "competencies": [
      "communication",
      "problemResolution",
      "riskManagement"
    ],
    "scenario": "A patient says she will arrive 18 minutes late for a New OB pair at 10:00 and 10:30. What should the navigator send?",
    "options": [
      {
        "id": "a",
        "text": "A message stating only that the patient is running late.",
        "points": 30,
        "rationale": "The office needs enough information to locate the patient and assess both linked appointments."
      },
      {
        "id": "b",
        "text": "Send Intermedia the account number, both appointment times, and expected lateness; await the office's decision.",
        "points": 100,
        "rationale": "Correct: provide the required operational facts and leave the see/reschedule decision to the office."
      },
      {
        "id": "c",
        "text": "Cancel the 10:00 sonogram and keep the 10:30 provider visit.",
        "points": 0,
        "rationale": "A New OB pair cannot be broken, and the navigator does not independently decide the outcome."
      },
      {
        "id": "d",
        "text": "Tell the patient she will definitely still be seen because she called ahead.",
        "points": 0,
        "rationale": "Calling ahead does not authorize the navigator to promise the office's decision."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "late_arrival",
      "paired_appointment_reschedule"
    ],
    "workflowType": "late_arrival"
  },
  {
    "id": "qv3-obgyn-documentation-4",
    "domainId": "documentation",
    "competencies": [
      "sopKnowledge",
      "communication",
      "sopApplication"
    ],
    "scenario": "A patient schedules a postpartum visit and wants to discuss IUD options but has not chosen a device. Which reason and appointment construction are complete?",
    "options": [
      {
        "id": "a",
        "text": "Reason: \"Postpartum.\" Add a GYN Sono after the visit in case she chooses an IUD.",
        "points": 30,
        "rationale": "The reason is incomplete, and discussion-only does not require a sonogram."
      },
      {
        "id": "b",
        "text": "Book the 15-minute postpartum visit and document the delivery details plus IUD discussion; do not add a sonogram.",
        "points": 100,
        "rationale": "Correct: complete postpartum documentation plus the discussion-only exception."
      },
      {
        "id": "c",
        "text": "Book an Annual GYN and put only 'IUD' in the reason.",
        "points": 10,
        "rationale": "This is a postpartum workflow and the reason must include delivery details."
      },
      {
        "id": "d",
        "text": "Book GYN Sono first so the provider can discuss the results during postpartum.",
        "points": 0,
        "rationale": "No sonogram is indicated for discussion-only, and provider-first is the relevant insertion sequence."
      }
    ],
    "correctOptionId": "b",
    "ruleIds": [
      "postpartum"
    ],
    "workflowType": "postpartum"
  }
];

export const OBGYN_CURRENT_FLOOR_QUESTIONS = Object.freeze(
  rawQuestions.map((question) => Object.freeze({
    ...question,
    department: 'obgyn',
    sourceSopVersion: OBGYN_SOP_VERSION,
    sourceRuleVersion: OBGYN_RULE_SET_VERSION,
    sourceAuthority: OBGYN_SOURCE_AUTHORITY,
  }))
);
