// Curated current-floor OB/GYN Spot-the-Error cases: classification.
export default [
  {
    "id": "av3-obgyn-classification-1",
    "domainId": "classification",
    "workflowType": "annual_vs_gyn_ov",
    "ruleIds": ["annual_gyn_vs_gyn_ov"],
    "difficulty": "hard",
    "opening": "I have mild discharge without pain or fever. Another practice completed my annual six months ago.",
    "detail": "Their record is attached, but my last completed Annual GYN in your department was 22 months ago.",
    "error": "The outside annual counts as current, so this should be a GYN Office Visit.",
    "followUp": "The outside office sent the note, but I have not had an annual with your team recently.",
    "modelExplanation": "The agent counted an outside annual as current for this department's routine scheduling rule.",
    "expectedCorrection": "Use the last completed in-department Annual GYN; when it is over one year old, schedule Annual GYN and include the concern.",
    "requiredChartFacts": ["Outside-practice annual was six months ago.", "Last in-department Annual GYN was 22 months ago.", "Concern was not described as serious."]
  },
  {
    "id": "av3-obgyn-classification-2",
    "domainId": "classification",
    "workflowType": "known_vs_unknown_lmp",
    "ruleIds": ["confirmation_unknown_lmp"],
    "difficulty": "hard",
    "opening": "I got a positive test after two separate weeks of spotting, and my tracking app picked the earlier date.",
    "detail": "Neither bleed was normal for me, so I do not trust the LMP estimate even though the app shows seven weeks.",
    "error": "I'll use the unreliable LMP to schedule New OB from the app date.",
    "followUp": "The app is only estimating; I cannot say which bleeding episode was a real period.",
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
    "opening": "At my last OB visit, I remember the provider mentioning another growth scan around this week.",
    "detail": "The chart shows a prior growth scan, but there is no new RTO instruction or sonography order.",
    "error": "There is no documented order, but I'll schedule the growth sonogram from your recollection.",
    "followUp": "I may have misunderstood whether the provider said it was definite or only a possibility.",
    "modelExplanation": "The agent let patient recollection replace the controlling chart order.",
    "expectedCorrection": "Check Medical Summary, the last note, and related TEs; if the order remains missing, send a clarification TE to OB Portal.",
    "requiredChartFacts": ["No RTO or growth-scan order is visible in Medical Summary, the last note, or TEs.", "Patient recalls the provider discussing a possible future growth scan."]
  },
  {
    "id": "av3-obgyn-classification-4",
    "domainId": "classification",
    "workflowType": "lab_boundary",
    "ruleIds": ["lab_boundary"],
    "difficulty": "hard",
    "opening": "I missed yesterday's glucose test because I was sick, and the active order still appears in my portal.",
    "detail": "The original lab appointment is marked missed, and no clinical message gives a replacement time.",
    "error": "Since the order remains active, I will schedule your GTT lab for tomorrow myself.",
    "followUp": "I can come tomorrow, but nobody from the clinical team has given me a new time.",
    "modelExplanation": "The agent independently scheduled OB/GYN lab work. Current-floor navigators route lab appointment and missed-lab questions to OB Portal.",
    "expectedCorrection": "Send or update a TE to OB Portal with the specific missed-lab request; do not schedule the lab.",
    "requiredChartFacts": ["Patient missed an OB/GYN lab appointment.", "A lab order is visible.", "No live instruction authorizes navigator lab scheduling."]
  },
  {
    "id": "av3-obgyn-classification-5",
    "domainId": "classification",
    "workflowType": "known_vs_unknown_lmp",
    "ruleIds": ["new_ob_known_lmp"],
    "difficulty": "hard",
    "opening": "I have two positive home tests, regular cycles, and the exact first day of my last period.",
    "detail": "That reliable date makes me five weeks today, with no warning note or special instruction in the chart.",
    "error": "A reliable LMP still means I must use Confirmation before scheduling New OB.",
    "followUp": "There is no uncertainty about the date; I was calling to plan the first complete visit.",
    "modelExplanation": "The agent reversed the reliable-LMP rule by requiring Confirmation.",
    "expectedCorrection": "Use the reliable LMP to schedule the complete New OB pair in the standard 8–12-week window.",
    "requiredChartFacts": ["Reliable LMP is documented.", "Home pregnancy test is positive.", "No out-of-window timing issue exists."]
  }
];
