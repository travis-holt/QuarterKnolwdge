// Curated current-floor OB/GYN Spot-the-Error cases: scheduling.
export default [
  {
    "id": "av3-obgyn-scheduling-1",
    "domainId": "scheduling",
    "workflowType": "new_ob_pairing",
    "ruleIds": ["new_ob_pairing"],
    "difficulty": "hard",
    "opening": "I need my first pregnancy visit and the dates you offered are confusing.",
    "detail": "I can come for the doctor on Tuesday and the ultrasound on Friday.",
    "error": "That works; we'll put the provider first and the sonogram on a separate day.",
    "modelExplanation": "The agent broke the New OB pair and reversed its sequence.",
    "expectedCorrection": "Book a same-day back-to-back 30-minute sonogram first and 30-minute provider visit second, with the second appointment OB Verified.",
    "requiredChartFacts": ["Reliable LMP supports New OB.", "Patient needs the complete New OB pair."]
  },
  {
    "id": "av3-obgyn-scheduling-2",
    "domainId": "scheduling",
    "workflowType": "iud_plus_gyn_sono",
    "ruleIds": ["iud_insertion_plus_sono"],
    "difficulty": "hard",
    "opening": "I want an IUD inserted and was told there may be an ultrasound.",
    "detail": "I am not postpartum.",
    "error": "I'll book the GYN sonogram first, then the IUD insertion visit afterward.",
    "modelExplanation": "The agent reversed the required IUD workflow sequence.",
    "expectedCorrection": "Use the correct routine provider visit based on Annual GYN status, then book GYN Sono immediately afterward unless the documented provider exception applies.",
    "requiredChartFacts": ["IUD insertion is outside postpartum.", "No provider exception is documented."]
  },
  {
    "id": "av3-obgyn-scheduling-3",
    "domainId": "scheduling",
    "workflowType": "paired_reschedule",
    "ruleIds": ["paired_appointment_reschedule"],
    "difficulty": "hard",
    "opening": "I need to move my BPP but want to keep the doctor visit.",
    "detail": "The two appointments are currently back-to-back.",
    "error": "I can move just the sonogram and leave the provider visit alone.",
    "modelExplanation": "The agent split a required scan-plus-provider pair.",
    "expectedCorrection": "Offer a new valid pair and move or cancel both components together while preserving the required sequence.",
    "requiredChartFacts": ["BPP and provider visit are a required pair.", "Patient requested moving only one component."]
  },
  {
    "id": "av3-obgyn-scheduling-4",
    "domainId": "scheduling",
    "workflowType": "ob_verified_status",
    "ruleIds": ["new_ob_pairing"],
    "difficulty": "medium",
    "opening": "I received two appointment notices for my New OB visit.",
    "detail": "One is the scan and one is the provider right after it.",
    "error": "You can skip OB Verified on the second appointment; it is not needed.",
    "modelExplanation": "The agent omitted the required status on the second New OB appointment.",
    "expectedCorrection": "Keep the valid pair and mark the second appointment OB Verified.",
    "requiredChartFacts": ["New OB sonogram and provider visit are booked back-to-back.", "The provider visit is the second appointment."]
  },
  {
    "id": "av3-obgyn-scheduling-5",
    "domainId": "scheduling",
    "workflowType": "new_ob_pairing",
    "ruleIds": ["new_ob_pairing"],
    "difficulty": "hard",
    "opening": "I can do the ultrasound at nine, but the next doctor opening is eleven.",
    "detail": "I cannot stay in the office for two hours.",
    "error": "I'll keep the sonogram at nine and the provider at eleven with the waiting gap.",
    "modelExplanation": "The agent created a New OB pair with a waiting gap.",
    "expectedCorrection": "Find a same-day immediately back-to-back sonogram-then-provider pair, or escalate when no valid pair exists.",
    "requiredChartFacts": ["New OB workflow applies.", "The proposed appointments have a two-hour gap."]
  }
];
