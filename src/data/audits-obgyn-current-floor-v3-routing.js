// Curated current-floor OB/GYN Spot-the-Error cases: routing.
export default [
  {
    "id": "av3-obgyn-routing-1",
    "domainId": "routing",
    "workflowType": "existing_te_take_action",
    "ruleIds": ["existing_te_take_action"],
    "difficulty": "hard",
    "opening": "I am calling again about the same refill request from two days ago.",
    "detail": "I still have not received a callback.",
    "error": "I see the open TE, but I'll create a new one so somebody notices.",
    "modelExplanation": "The agent duplicated an open same-issue TE instead of updating it.",
    "expectedCorrection": "Use Take Action on the existing refill TE with the callback and new information; raise priority only when warranted.",
    "requiredChartFacts": ["An open TE exists for the same refill.", "No separate new issue was reported."]
  },
  {
    "id": "av3-obgyn-routing-2",
    "domainId": "routing",
    "workflowType": "dr_bank_waitlist",
    "ruleIds": ["dr_bank_waitlist"],
    "difficulty": "medium",
    "opening": "I only want Dr. Bank for my annual.",
    "detail": "I know there may be a wait, but I want the next opening.",
    "error": "I'll schedule Dr. Bank directly for your annual right now.",
    "modelExplanation": "The agent directly booked a provider who uses the waiting-list workflow.",
    "expectedCorrection": "Explain the waiting list and send or update the Waiting List Portal TE; do not promise an opening.",
    "requiredChartFacts": ["Request is for Dr. Bank Annual GYN.", "No patient-specific direct-booking instruction exists."]
  },
  {
    "id": "av3-obgyn-routing-3",
    "domainId": "routing",
    "workflowType": "mfm_owner",
    "ruleIds": ["mfm_routing"],
    "difficulty": "hard",
    "opening": "I need to move my MFM appointment next week.",
    "detail": "I am already established with MFM.",
    "error": "I'll send the MFM request through the regular OB scheduling workflow.",
    "modelExplanation": "The agent routed an established MFM request through general OB scheduling.",
    "expectedCorrection": "Route the reschedule request directly to Rebecca Wood and do not independently change the MFM appointment.",
    "requiredChartFacts": ["Patient is established with MFM.", "Request is to reschedule an existing MFM appointment."]
  },
  {
    "id": "av3-obgyn-routing-4",
    "domainId": "routing",
    "workflowType": "urgent_requires_approval",
    "ruleIds": ["urgent_high_priority", "nurse_approved_ob_urgent"],
    "difficulty": "hard",
    "opening": "I am pregnant and having severe pelvic pain.",
    "detail": "I noticed an urgent slot online, so can you put me there?",
    "error": "The open slot is authorization, so I'll book OB Urgent without nurse approval.",
    "modelExplanation": "The agent treated slot availability as clinical authorization.",
    "expectedCorrection": "Create or update a High Priority TE to OB Portal, use the urgent channel, and book an urgent appointment only after written nurse/provider approval.",
    "requiredChartFacts": ["Serious pregnancy-related pain was reported.", "No written nurse/provider approval exists.", "An OB Urgent slot is open."]
  },
  {
    "id": "av3-obgyn-routing-5",
    "domainId": "routing",
    "workflowType": "urgent_intermedia_escalation",
    "ruleIds": ["urgent_intermedia_escalation"],
    "difficulty": "hard",
    "opening": "My bleeding has become much heavier since I called this morning.",
    "detail": "There is already a TE, but the symptoms are worse now.",
    "error": "Skip the urgent channel; updating the TE is enough.",
    "modelExplanation": "The agent omitted the required urgent communication step for worsening serious symptoms.",
    "expectedCorrection": "Use Take Action on the existing TE, mark High Priority as needed, and message the Women's Health OB Urgent Calls Intermedia channel.",
    "requiredChartFacts": ["Serious bleeding worsened.", "An existing TE is open.", "Urgent-channel escalation is required in addition to the TE."]
  }
];
