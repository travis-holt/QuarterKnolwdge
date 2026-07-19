// Curated current-floor OB/GYN Spot-the-Error cases: documentation.
export default [
  {
    "id": "av3-obgyn-documentation-1",
    "domainId": "documentation",
    "workflowType": "existing_te_take_action",
    "ruleIds": ["existing_te_take_action"],
    "difficulty": "hard",
    "opening": "I am calling again about the severe pain TE from this morning because the pain is now constant.",
    "detail": "The original TE remains open in OB Portal with the earlier symptoms and no documented callback.",
    "error": "I'll open another TE for the worsening pain and leave the first one unchanged.",
    "followUp": "It is the same pain, just worse; I do not want the new details separated from the first message.",
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
    "opening": "My after-visit summary says the provider may consider another ultrasound if the discomfort continues.",
    "detail": "The discomfort continues, but the chart has no ultrasound order, RTO instruction, or clinical approval to schedule.",
    "error": "There is no order, but I'll schedule the requested ultrasound and document your symptoms.",
    "followUp": "The note only says the provider may consider it; it does not give me an appointment timeframe.",
    "modelExplanation": "The agent documented patient recollection as if it were an order.",
    "expectedCorrection": "Record the requested study and missing documentation in a clarification TE to OB Portal; schedule only after a documented order or approval.",
    "requiredChartFacts": ["No sonography order is visible in Medical Summary, the last note, or TEs.", "The after-visit summary says only that ultrasound may be considered if symptoms continue."]
  },
  {
    "id": "av3-obgyn-documentation-3",
    "domainId": "documentation",
    "workflowType": "ob_verified_status",
    "ruleIds": ["iud_insertion_plus_sono"],
    "difficulty": "hard",
    "opening": "My IUD insertion and GYN Sono are back-to-back with the provider visit first, as instructed.",
    "detail": "The provider is not the no-sonogram exception, but the second appointment has no OB Verified status.",
    "error": "I'll omit OB Verified because the matching times already show the appointments are connected.",
    "followUp": "The sequence looks right, but I cannot tell whether the second record is marked as part of the pair.",
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
    "opening": "I need an OB medication refilled; the medication and prescribing provider appear in my prescription history.",
    "detail": "The listed pharmacy is my old one, and I have not yet given you the new pharmacy information.",
    "error": "No need to ask which pharmacy you use; I'll send the refill request through.",
    "followUp": "The old pharmacy closed, so the request would need to go somewhere different this time.",
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
    "opening": "I need the same prescription again, and I know the medication and current pharmacy.",
    "detail": "Several Women's Health providers appear in my recent history, so I cannot identify who prescribed this medication.",
    "error": "No need to check the prescribing provider; medication and pharmacy are enough.",
    "followUp": "I do not want the request routed to the wrong person just because I cannot remember the name.",
    "modelExplanation": "The agent skipped the required e-prescription-log and prescriber check.",
    "expectedCorrection": "Review e-prescription logs, identify the prescribing provider, confirm medication and pharmacy, and use the current refill route.",
    "requiredChartFacts": ["Medication and pharmacy are known.", "Prescribing provider has not yet been identified."]
  }
];
