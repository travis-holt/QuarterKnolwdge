// Curated current-floor OB/GYN Spot-the-Error cases: documentation.
export default [
  {
    "id": "av3-obgyn-documentation-1",
    "domainId": "documentation",
    "workflowType": "existing_te_take_action",
    "ruleIds": ["existing_te_take_action"],
    "difficulty": "hard",
    "opening": "I am calling again about the same severe pain message.",
    "detail": "The TE is still open, and the pain is worse.",
    "error": "I'll open a second new TE for the same pain and leave the first one as it is.",
    "modelExplanation": "The agent duplicated a same-issue TE.",
    "expectedCorrection": "Use Take Action on the existing TE with the worsening facts, update priority as appropriate, and use the urgent communication workflow.",
    "requiredChartFacts": ["Open TE exists for the same symptom.", "Patient reports worsening symptoms."]
  },
  {
    "id": "av3-obgyn-documentation-2",
    "domainId": "documentation",
    "workflowType": "missing_rto_order",
    "ruleIds": ["missing_sonography_order"],
    "difficulty": "hard",
    "opening": "I was told to return for another ultrasound.",
    "detail": "I cannot find the order in my portal.",
    "error": "There is no documented order, but I'll schedule the ultrasound anyway and note that you requested it.",
    "modelExplanation": "The agent documented patient recollection as if it were an order.",
    "expectedCorrection": "Record the requested study and missing documentation in a clarification TE to OB Portal; schedule only after a documented order or approval.",
    "requiredChartFacts": ["No sonography order is visible in Medical Summary, the last note, or TEs."]
  },
  {
    "id": "av3-obgyn-documentation-3",
    "domainId": "documentation",
    "workflowType": "ob_verified_status",
    "ruleIds": ["iud_insertion_plus_sono"],
    "difficulty": "medium",
    "opening": "My IUD insertion and scan are booked one after the other.",
    "detail": "The scan is the second appointment.",
    "error": "I'll leave OB Verified off the second appointment because the times already show they are connected.",
    "modelExplanation": "The agent omitted a required status from the second appointment.",
    "expectedCorrection": "Keep the provider-first pair and mark the second GYN Sono appointment OB Verified.",
    "requiredChartFacts": ["IUD insertion provider visit is first.", "GYN Sono is immediately afterward.", "No no-sonogram provider exception applies."]
  },
  {
    "id": "av3-obgyn-documentation-4",
    "domainId": "documentation",
    "workflowType": "refill_details",
    "ruleIds": ["refill"],
    "difficulty": "hard",
    "opening": "I need a refill of the medication my OB prescribed.",
    "detail": "I can tell you the medication name, but I recently changed pharmacies.",
    "error": "No need to ask which pharmacy you use; I'll send the refill request through.",
    "modelExplanation": "The agent omitted an actionable refill detail.",
    "expectedCorrection": "Confirm medication, preferred pharmacy, and prescribing provider, then create or update the refill TE without promising approval or timing.",
    "requiredChartFacts": ["Medication refill request.", "Preferred pharmacy has changed.", "Prescribing provider is visible in e-prescription logs."]
  },
  {
    "id": "av3-obgyn-documentation-5",
    "domainId": "documentation",
    "workflowType": "refill_details",
    "ruleIds": ["refill"],
    "difficulty": "hard",
    "opening": "I need the same prescription refilled again.",
    "detail": "I am not sure which provider originally prescribed it.",
    "error": "No need to check the prescribing provider; medication and pharmacy are enough.",
    "modelExplanation": "The agent skipped the required e-prescription-log and prescriber check.",
    "expectedCorrection": "Review e-prescription logs, identify the prescribing provider, confirm medication and pharmacy, and use the current refill route.",
    "requiredChartFacts": ["Medication and pharmacy are known.", "Prescribing provider has not yet been identified."]
  }
];
