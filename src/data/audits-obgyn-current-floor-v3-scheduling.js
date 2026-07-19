// Curated current-floor OB/GYN Spot-the-Error cases: scheduling.
export default [
  {
    "id": "av3-obgyn-scheduling-1",
    "domainId": "scheduling",
    "workflowType": "new_ob_pairing",
    "ruleIds": ["new_ob_pairing"],
    "difficulty": "hard",
    "opening": "My reliable LMP puts me at ten weeks, but I cannot stay for both parts of New OB on Tuesday.",
    "detail": "I can see the provider Tuesday and return Friday for the sonogram if the order does not matter.",
    "error": "For New OB, we can split the provider Tuesday and sonogram Friday.",
    "followUp": "Both visits would still happen this week, which is why I wondered whether splitting them was allowed.",
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
    "opening": "I am not postpartum and want an IUD insertion with a provider who follows the standard sonogram workflow.",
    "detail": "My Annual GYN is current, and the only matching scan time appears immediately before the provider opening.",
    "error": "I'll book the GYN sonogram first, then the IUD insertion visit afterward.",
    "followUp": "I can attend both times, but I was unsure whether the scan or insertion should happen first.",
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
    "opening": "My documented RTO is BPP with MD, but work conflicts with the BPP portion of tomorrow's pair.",
    "detail": "The provider visit can stay, and another BPP opening exists later that afternoon with a gap.",
    "error": "I can move just the BPP and leave the paired provider visit alone.",
    "followUp": "The chart lists them together, but keeping the provider time would be much easier for me.",
    "modelExplanation": "The agent split a required scan-plus-provider pair.",
    "expectedCorrection": "Offer a new valid pair and move or cancel both components together while preserving the required sequence.",
    "requiredChartFacts": ["BPP and provider visit are a required pair.", "Patient requested moving only one component."]
  },
  {
    "id": "av3-obgyn-scheduling-4",
    "domainId": "scheduling",
    "workflowType": "ob_verified_status",
    "ruleIds": ["new_ob_pairing"],
    "difficulty": "hard",
    "opening": "I received two New OB confirmations for the same morning and want to confirm they belong together.",
    "detail": "The sonogram is first and the provider is immediately afterward, but the second record lacks OB Verified.",
    "error": "Matching times are enough, so I'll skip OB Verified on the second appointment.",
    "followUp": "The notices look connected to me, although only the first one mentions the New OB sequence.",
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
    "opening": "I need New OB within the normal window; the sonogram is open at nine and the provider at eleven.",
    "detail": "They are on the same day and in the correct order, but there is a two-hour wait between them.",
    "error": "I'll keep the New OB sonogram and provider visit with a gap between them.",
    "followUp": "I can wait if necessary, but I thought the two appointments were supposed to connect directly.",
    "modelExplanation": "The agent created a New OB pair with a waiting gap.",
    "expectedCorrection": "Find a same-day immediately back-to-back sonogram-then-provider pair, or escalate when no valid pair exists.",
    "requiredChartFacts": ["New OB workflow applies.", "The proposed appointments have a two-hour gap."]
  }
];
