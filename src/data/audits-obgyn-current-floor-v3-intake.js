// Curated current-floor OB/GYN Spot-the-Error cases: intake.
export default [
  {
    "id": "av3-obgyn-intake-1",
    "domainId": "intake",
    "workflowType": "annual_vs_gyn_ov",
    "ruleIds": ["annual_gyn_vs_gyn_ov"],
    "difficulty": "hard",
    "opening": "I need a visit for mild pelvic discomfort. I had a Pap a few months ago.",
    "detail": "My actual annual may have been more than a year ago.",
    "error": "Your last annual doesn't matter for this request; I can book whichever routine GYN visit type you prefer.",
    "modelExplanation": "The agent ignored the controlling Annual GYN status. Pap-only and other non-annual encounters do not make the annual current; routine visit selection must follow the actual in-department Annual GYN date.",
    "expectedCorrection": "Check the last completed in-department Annual GYN and use Annual GYN when it is over one year old, unless serious symptoms require escalation.",
    "requiredChartFacts": ["Last completed in-department Annual GYN was 16 months ago.", "Recent visit was Pap-only.", "Symptoms were described as non-emergency."]
  },
  {
    "id": "av3-obgyn-intake-2",
    "domainId": "intake",
    "workflowType": "annual_vs_gyn_ov",
    "ruleIds": ["annual_gyn_vs_gyn_ov"],
    "difficulty": "medium",
    "opening": "I want an appointment for irregular periods. I had my baby eight months ago.",
    "detail": "I thought the postpartum visit counted as my yearly checkup.",
    "error": "Your annual status doesn't matter here, so I will book a GYN Office Visit.",
    "modelExplanation": "The agent discarded the annual-status rule. A postpartum visit does not make the Annual GYN current for routine scheduling.",
    "expectedCorrection": "Use the actual in-department Annual GYN date; if it is over one year old, schedule Annual GYN and include the concern in the reason.",
    "requiredChartFacts": ["Postpartum visit occurred eight months ago.", "Last actual Annual GYN was 18 months ago.", "No serious symptoms were reported."]
  },
  {
    "id": "av3-obgyn-intake-3",
    "domainId": "intake",
    "workflowType": "known_vs_unknown_lmp",
    "ruleIds": ["confirmation_unknown_lmp"],
    "difficulty": "hard",
    "opening": "I had a positive home test, but my periods are so irregular that I really do not know the last one.",
    "detail": "I can guess a month, but I am not confident.",
    "error": "I'll schedule your New OB visit right away using the date you guessed.",
    "modelExplanation": "The agent treated an unreliable LMP as reliable and skipped Confirmation of Pregnancy.",
    "expectedCorrection": "Schedule a 15-minute provider Confirmation of Pregnancy and do not independently add a lab or sonogram.",
    "requiredChartFacts": ["Unknown or unreliable LMP.", "Positive home pregnancy test.", "No current Confirmation or New OB appointment."]
  },
  {
    "id": "av3-obgyn-intake-4",
    "domainId": "intake",
    "workflowType": "known_vs_unknown_lmp",
    "ruleIds": ["new_ob_known_lmp"],
    "difficulty": "hard",
    "opening": "I tested positive and know the exact first day of my last period.",
    "detail": "My cycles are regular, and the date is reliable.",
    "error": "Since the test was done at home, I must schedule a Confirmation of Pregnancy before any New OB visit.",
    "modelExplanation": "The agent forced Confirmation despite a reliable LMP. A home test alone does not block the normal New OB workflow.",
    "expectedCorrection": "Use the reliable LMP to target the 8–12-week New OB window and build the complete New OB pair.",
    "requiredChartFacts": ["Reliable LMP is documented.", "Patient is currently about six weeks.", "No conflicting clinical instruction exists."]
  },
  {
    "id": "av3-obgyn-intake-5",
    "domainId": "intake",
    "workflowType": "known_vs_unknown_lmp",
    "ruleIds": ["confirmation_unknown_lmp"],
    "difficulty": "medium",
    "opening": "I am calling back after the pregnancy test because I do not remember my last period.",
    "detail": "The nurse could not reach me yesterday.",
    "error": "I can send you for a sonogram on your own first, even though there is no order, and then we can decide the visit.",
    "modelExplanation": "The agent invented an unapproved scan instead of using the unknown-LMP Confirmation workflow.",
    "expectedCorrection": "Book the 15-minute provider Confirmation of Pregnancy; do not independently add lab or sonography.",
    "requiredChartFacts": ["Unknown LMP.", "No sonography order is visible.", "No patient-specific clinical instruction authorizes a scan."]
  }
];
