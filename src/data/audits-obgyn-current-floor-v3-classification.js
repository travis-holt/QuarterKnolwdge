// Curated current-floor OB/GYN Spot-the-Error cases: classification.
export default [
  {
    "id": "av3-obgyn-classification-1",
    "domainId": "classification",
    "workflowType": "annual_vs_gyn_ov",
    "ruleIds": ["annual_gyn_vs_gyn_ov"],
    "difficulty": "hard",
    "opening": "I need a routine visit for some mild discharge. I had an annual at another practice six months ago.",
    "detail": "I have not had an Annual GYN with your department in almost two years.",
    "error": "The outside annual counts as current here, so I will book a GYN Office Visit.",
    "modelExplanation": "The agent counted an outside annual as current for this department's routine scheduling rule.",
    "expectedCorrection": "Use the last completed in-department Annual GYN; when it is over one year old, schedule Annual GYN and include the concern.",
    "requiredChartFacts": ["Outside-practice annual was six months ago.", "Last in-department Annual GYN was 22 months ago.", "Concern was not described as serious."]
  },
  {
    "id": "av3-obgyn-classification-2",
    "domainId": "classification",
    "workflowType": "known_vs_unknown_lmp",
    "ruleIds": ["confirmation_unknown_lmp"],
    "difficulty": "medium",
    "opening": "I got a positive test, but I had spotting twice and cannot tell which date was a real period.",
    "detail": "I really do not trust the date I first gave.",
    "error": "Your unreliable LMP is enough for me to schedule a New OB pair now.",
    "modelExplanation": "The agent used an unreliable LMP to construct New OB timing.",
    "expectedCorrection": "Use Confirmation of Pregnancy first when LMP is unknown or unreliable.",
    "requiredChartFacts": ["LMP is unreliable because of irregular bleeding.", "No reliable gestational age is documented."]
  },
  {
    "id": "av3-obgyn-classification-3",
    "domainId": "classification",
    "workflowType": "missing_rto_order",
    "ruleIds": ["rto_documentation"],
    "difficulty": "hard",
    "opening": "The doctor said I need a growth scan when I come back.",
    "detail": "I do not see it in my portal, but I remember hearing it.",
    "error": "There is no documented order here, but I'll schedule the growth sonogram anyway.",
    "modelExplanation": "The agent let patient recollection replace the controlling chart order.",
    "expectedCorrection": "Check Medical Summary, the last note, and related TEs; if the order remains missing, send a clarification TE to OB Portal.",
    "requiredChartFacts": ["No RTO or growth-scan order is visible in Medical Summary, the last note, or TEs."]
  },
  {
    "id": "av3-obgyn-classification-4",
    "domainId": "classification",
    "workflowType": "lab_boundary",
    "ruleIds": ["lab_boundary"],
    "difficulty": "hard",
    "opening": "I missed my glucose test yesterday. Can you reschedule it?",
    "detail": "The order is still showing in my portal.",
    "error": "I will schedule your GTT lab for tomorrow myself.",
    "modelExplanation": "The agent independently scheduled OB/GYN lab work. Current-floor navigators route lab appointment and missed-lab questions to OB Portal.",
    "expectedCorrection": "Send or update a TE to OB Portal with the specific missed-lab request; do not schedule the lab.",
    "requiredChartFacts": ["Patient missed an OB/GYN lab appointment.", "A lab order is visible.", "No live instruction authorizes navigator lab scheduling."]
  },
  {
    "id": "av3-obgyn-classification-5",
    "domainId": "classification",
    "workflowType": "known_vs_unknown_lmp",
    "ruleIds": ["new_ob_known_lmp"],
    "difficulty": "medium",
    "opening": "I have a positive test and know my exact LMP.",
    "detail": "I am about five weeks today.",
    "error": "Your reliable LMP still requires me to schedule Confirmation before New OB.",
    "modelExplanation": "The agent reversed the reliable-LMP rule by requiring Confirmation.",
    "expectedCorrection": "Use the reliable LMP to schedule the complete New OB pair in the standard 8–12-week window.",
    "requiredChartFacts": ["Reliable LMP is documented.", "Home pregnancy test is positive.", "No out-of-window timing issue exists."]
  }
];
