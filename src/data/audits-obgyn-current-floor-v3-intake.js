// Curated current-floor OB/GYN Spot-the-Error cases: intake.
export default [
  {
    "id": "av3-obgyn-intake-1",
    "domainId": "intake",
    "workflowType": "annual_vs_gyn_ov",
    "ruleIds": ["annual_gyn_vs_gyn_ov"],
    "difficulty": "hard",
    "opening": "I have mild pelvic pressure. I had a Pap four months ago and a postpartum visit eight months ago.",
    "detail": "Both visits are listed, but my last Annual GYN with your office was 16 months ago.",
    "error": "The Pap alone counts as current, so this fits a GYN Office Visit.",
    "followUp": "That Pap visit was only for the test; the provider did not perform my annual.",
    "modelExplanation": "The agent ignored the controlling Annual GYN status. Pap-only and other non-annual encounters do not make the annual current; routine visit selection must follow the actual in-department Annual GYN date.",
    "expectedCorrection": "Check the last completed in-department Annual GYN and use Annual GYN when it is over one year old, unless serious symptoms require escalation.",
    "requiredChartFacts": ["Last completed in-department Annual GYN was 16 months ago.", "Recent visit was Pap-only.", "Symptoms were described as non-emergency."]
  },
  {
    "id": "av3-obgyn-intake-2",
    "domainId": "intake",
    "workflowType": "annual_vs_gyn_ov",
    "ruleIds": ["annual_gyn_vs_gyn_ov"],
    "difficulty": "hard",
    "opening": "My periods became irregular after delivery, and I would like a routine visit to discuss them.",
    "detail": "The chart shows postpartum eight months ago, but my last actual Annual GYN was 18 months ago.",
    "error": "The postpartum visit counts as current, so I'll use a GYN Office Visit.",
    "followUp": "I was not sure because that appointment focused only on recovery after delivery.",
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
    "opening": "I had a positive home test after stopping birth control, but I have spotted on and off for weeks.",
    "detail": "The date in my app is only a guess; none of the bleeding felt like a normal period.",
    "error": "I'll use the unreliable LMP to schedule New OB instead of Confirmation.",
    "followUp": "Will that guessed date decide which ultrasound and provider times you choose for me?",
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
    "opening": "I tested positive at home and know the exact first day of my last period; my cycles are regular.",
    "detail": "The date places me at six weeks, and the chart has no conflicting instruction for this pregnancy.",
    "error": "With a reliable LMP, I must use Confirmation because the test was at home.",
    "followUp": "I thought knowing the exact date might let us plan the first full pregnancy visit.",
    "modelExplanation": "The agent forced Confirmation despite a reliable LMP. A home test alone does not block the normal New OB workflow.",
    "expectedCorrection": "Use the reliable LMP to target the 8–12-week New OB window and build the complete New OB pair.",
    "requiredChartFacts": ["Reliable LMP is documented.", "Patient is currently about six weeks.", "No conflicting clinical instruction exists."]
  },
  {
    "id": "av3-obgyn-intake-5",
    "domainId": "intake",
    "workflowType": "known_vs_unknown_lmp",
    "ruleIds": ["confirmation_unknown_lmp"],
    "difficulty": "hard",
    "opening": "I am returning a nurse call after a positive test, but I have not had a clear period since breastfeeding.",
    "detail": "The callback TE says to contact me, but it gives no gestational age or patient-specific scheduling instruction.",
    "error": "An unknown LMP lets me schedule New OB directly instead of Confirmation.",
    "followUp": "The nurse never told me how far along I might be or which visit I needed.",
    "modelExplanation": "The agent skipped Confirmation and directly constructed New OB despite an unknown LMP.",
    "expectedCorrection": "Book the 15-minute provider Confirmation of Pregnancy; do not independently add lab or sonography.",
    "requiredChartFacts": ["Unknown LMP.", "No reliable gestational age is documented.", "No patient-specific clinical instruction authorizes direct New OB scheduling."]
  }
];
