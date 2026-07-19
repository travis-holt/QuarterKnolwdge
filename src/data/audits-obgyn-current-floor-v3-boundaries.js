// Curated current-floor OB/GYN Spot-the-Error cases: boundaries.
export default [
  {
    "id": "av3-obgyn-boundaries-1",
    "domainId": "boundaries",
    "workflowType": "urgent_requires_approval",
    "ruleIds": ["urgent_high_priority", "nurse_approved_ob_urgent"],
    "difficulty": "hard",
    "opening": "I am having contractions and think something may be wrong.",
    "detail": "There is an OB Urgent opening soon.",
    "error": "I can book you into the OB Urgent slot now before getting clinical approval.",
    "modelExplanation": "The agent crossed the clinical-authorization boundary.",
    "expectedCorrection": "Escalate with High Priority TE and urgent-channel communication, then follow written clinical direction before scheduling.",
    "requiredChartFacts": ["Serious symptoms were reported.", "No nurse/provider approval exists."]
  },
  {
    "id": "av3-obgyn-boundaries-2",
    "domainId": "boundaries",
    "workflowType": "lab_boundary",
    "ruleIds": ["lab_boundary"],
    "difficulty": "hard",
    "opening": "My portal shows last week's blood result. Does it look normal?",
    "detail": "I am worried because one number is highlighted.",
    "error": "The result looks normal to me, so you do not need a nurse callback.",
    "modelExplanation": "The agent interpreted and reassured about a lab result.",
    "expectedCorrection": "Do not interpret the result; send or update a TE to OB Portal so clinical staff address it.",
    "requiredChartFacts": ["Patient requested interpretation of an OB/GYN lab result.", "No clinical staff member has reviewed it with the patient."]
  },
  {
    "id": "av3-obgyn-boundaries-3",
    "domainId": "boundaries",
    "workflowType": "mfm_owner",
    "ruleIds": ["mfm_routing"],
    "difficulty": "hard",
    "opening": "An outside doctor told me to schedule with MFM.",
    "detail": "I do not have a referral from one of your Women's Health providers.",
    "error": "I'll route this through the standard OB scheduling team and have them create the MFM appointment.",
    "modelExplanation": "The agent ignored the MFM referral and ownership boundary.",
    "expectedCorrection": "Explain that the referral must come from a Women's Health provider in the department and route the inquiry directly to Rebecca Wood.",
    "requiredChartFacts": ["No in-department Women's Health referral/order exists.", "Request is for a new MFM appointment."]
  },
  {
    "id": "av3-obgyn-boundaries-4",
    "domainId": "boundaries",
    "workflowType": "urgent_requires_approval",
    "ruleIds": ["urgent_high_priority", "nurse_approved_ob_urgent"],
    "difficulty": "medium",
    "opening": "I have severe non-pregnant pelvic pain and can barely stand.",
    "detail": "I saw a GYN Urgent slot open today.",
    "error": "An available GYN Urgent slot means I can schedule it without provider approval.",
    "modelExplanation": "The agent treated availability as approval for a clinically controlled appointment type.",
    "expectedCorrection": "Use High Priority OB Portal and urgent-channel escalation; schedule GYN Urgent only after nurse/provider approval.",
    "requiredChartFacts": ["Severe non-pregnant pelvic pain was reported.", "No written approval exists."]
  },
  {
    "id": "av3-obgyn-boundaries-5",
    "domainId": "boundaries",
    "workflowType": "lab_boundary",
    "ruleIds": ["lab_boundary"],
    "difficulty": "medium",
    "opening": "I missed my GCT and want another appointment.",
    "detail": "The order is still active.",
    "error": "Since the order is active, I can reschedule the lab directly for you.",
    "modelExplanation": "The agent assumed an active order authorizes navigator lab scheduling.",
    "expectedCorrection": "Route the missed-lab appointment request to OB Portal and do not schedule it independently.",
    "requiredChartFacts": ["Patient missed an OB/GYN lab appointment.", "An active order exists."]
  }
];
