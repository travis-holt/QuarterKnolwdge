// Curated current-floor OB/GYN Spot-the-Error cases: routing.
export default [
  {
    "id": "av3-obgyn-routing-1",
    "domainId": "routing",
    "workflowType": "existing_te_take_action",
    "ruleIds": ["existing_te_take_action"],
    "difficulty": "hard",
    "opening": "I am following up on a refill TE from two days ago because my pharmacy has now changed.",
    "detail": "The original request is still open with the correct medication and prescriber, but it lists my old pharmacy.",
    "error": "I see the open TE, but I'll create a new one with the pharmacy change.",
    "followUp": "I only need the pharmacy corrected; the medication request itself is exactly the same.",
    "modelExplanation": "The agent duplicated an open same-issue TE instead of updating it.",
    "expectedCorrection": "Use Take Action on the existing refill TE with the callback and new information; raise priority only when warranted.",
    "requiredChartFacts": ["An open TE exists for the same refill.", "No separate new issue was reported."]
  },
  {
    "id": "av3-obgyn-routing-2",
    "domainId": "routing",
    "workflowType": "dr_bank_waitlist",
    "ruleIds": ["dr_bank_waitlist"],
    "difficulty": "hard",
    "opening": "I only want Dr. Bank for my annual and to discuss fertility; I noticed a cancellation online.",
    "detail": "The chart has no direct-booking instruction, but I am willing to take that visible opening immediately.",
    "error": "That visible cancellation lets me schedule Dr. Bank directly instead of using the wait list.",
    "followUp": "I was previously told his annual and fertility appointments might use a separate request process.",
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
    "opening": "I am established with MFM and need to move next week's appointment because of another specialist visit.",
    "detail": "The MFM appointment is already on the chart, and there is no request to change my routine OB visits.",
    "error": "I'll send the MFM reschedule through the regular OB scheduling workflow.",
    "followUp": "I only need the MFM visit changed; my regular OB appointments should stay where they are.",
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
    "opening": "I am pregnant with severe pelvic pain, and I can see an OB Urgent opening forty minutes from now.",
    "detail": "A nurse approved an urgent visit for a different problem last month, but there is no approval for today's pain.",
    "error": "The old note authorizes me to book OB Urgent without new approval.",
    "followUp": "That nurse note was for my earlier visit, not for the pain I am reporting today.",
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
    "opening": "My bleeding is much heavier than when I called this morning, and I am now soaking through pads.",
    "detail": "The existing routine TE is still open; the new symptoms have not yet been added or escalated.",
    "error": "I'll update the TE to High Priority; we can skip the urgent Intermedia channel.",
    "followUp": "I am worried because the change happened quickly and nobody has called me back yet.",
    "modelExplanation": "The agent omitted the required urgent communication step for worsening serious symptoms.",
    "expectedCorrection": "Use Take Action on the existing TE, mark High Priority as needed, and message the Women's Health OB Urgent Calls Intermedia channel.",
    "requiredChartFacts": ["Serious bleeding worsened.", "An existing TE is open.", "Urgent-channel escalation is required in addition to the TE."]
  }
];
