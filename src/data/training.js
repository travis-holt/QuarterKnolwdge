// ─────────────────────────────────────────────────────────────────────────────
// TRAINING CATALOG — one module per knowledge domain.
//
// Content is grounded in the real department SOPs and operating model:
//   • Pediatrics — Aizer Health Pediatrics operational SOP
//   • OB/GYN     — Women's Health (OB/GYN) Patient Navigator SOP, current-floor
//                  v1.0 (effective 2026-07-17). Key OB truths encoded here:
//                  navigators are NON-clinical and never dispatch to Labor &
//                  Delivery or decide urgency themselves. Serious OB symptoms →
//                  gather info without triaging → High Priority Telephone
//                  Encounter (TE) to OB Portal → message the "Women's Health OB
//                  Urgent Calls" Intermedia channel → follow the clinical team.
//                  An unrelated request (e.g. a prenatal-vitamin refill) raised
//                  in the same call gets its OWN separate TE — never folded into
//                  the serious-symptom note.
//                  Routing splits two ways: ROUTINE GYN scheduling is handled
//                  DIRECTLY (Annual GYN "up to date" rule + correct provider
//                  template), NOT via OB Portal. OB Portal owns the CLINICAL /
//                  uncertain work: questions, triage, missing/unclear orders,
//                  labs, results, procedures, transfer review, and scheduling
//                  exceptions. Rebecca Wood (all MFM), Waiting List Portal
//                  (Dr. Bank annual/fertility — never schedule directly).
//                  Schedule from the CHART (Encounters, Medical
//                  Summary RTO, last note, open TEs), never from the patient's
//                  wording. New OB = a 30-min sonogram + 30-min provider visit,
//                  back-to-back, same day (one appointment; mark the 2nd "OB
//                  Verified"). An open OB/GYN Urgent slot is NOT authorization.
//   • Pediatrics — a same-day sick visit books ONLY on the day itself. A correct
//                  path may offer availability today; when tomorrow suits the
//                  parent better, the parent calls tomorrow for that day's
//                  same-day availability. Pre-booking a future-day "same-day"
//                  sick slot is never taught as correct.
//
// It teaches the decision, the exact phrasing, and the documentation — not
// SOP-wording recall. Advisory practice only: nothing here is scored or
// persisted; the assignment logic only reads `domainId`.
//
// Department scope: any content item may carry a `departments: [id]` array of
// stable department IDs ('pediatrics' | 'obgyn'). An item with NO `departments`
// field is genuinely shared and renders in every department. Points and
// takeaways are either a plain string (shared) or a `{ text, departments }`
// object (scoped). The renderer shows only "shared + the selected department"
// (see the scoping helpers at the bottom of this file); it NEVER infers a
// department from keywords. A whole lesson may be scoped when all of its content
// belongs to one department, so it drops out entirely for the other.
//
// Shape (fields beyond `lessons`/`keyTakeaways` are optional per module):
//   { domainId, title, blurb, estMinutes,
//     lessons: [{ title, departments?, points: (string | { text, departments })[],
//                 script?:  [{ say, not, why, departments? }],   // exact-phrasing pairs
//                 example?: { intro?, departments?, turns: [{ speaker: 'caller'|'nav',
//                                               text, note? }] },
//                 doc?:     { label, lines: string[], note?, departments? } }], // model doc
//     mistakes?: [{ mistake, consequence, instead, departments? }],
//     quickRef?: { title, rows: [{ label, value, departments? }] },
//     drill?:    [{ prompt, departments?, options: [{ text, correct?, why }] }],
//     simulations?: [{                                    // branching call sims
//       label, departments, title, intro, callerName, start,  // one dept each
//       nodes: { [id]: { caller, choices: [{ text, next,
//                          tone: 'good'|'ok'|'bad', feedback }] }
//                     | { ending: { verdict: 'strong'|'mixed'|'weak',
//                                   title, summary, lesson } } } }],
//     keyTakeaways: (string | { text, departments })[] }
//
// The assignment logic only needs `domainId`; everything else is presentation.
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING_MODULES = [
  // ── INTAKE ────────────────────────────────────────────────────────────────
  {
    domainId: 'intake',
    title: 'Call Opening & Identification',
    blurb: 'Department-adaptive lookup, proving you have the right chart, and reading it before you act.',
    estMinutes: 25,
    lessons: [
      {
        title: 'The lookup depends on who usually calls',
        points: [
          { text: 'Pediatrics: ask for the PARENT\'S phone number first — it pulls up the whole family at once, and parents routinely call about two or three children in one call.', departments: ['pediatrics'] },
          { text: 'Adult departments (OB/GYN, Behavioral Health, Internal Medicine): the patient usually calls for herself — verify date of birth first, then confirm first and last name per privacy policy, and confirm the correct account before discussing anything or opening a TE.', departments: ['obgyn'] },
          'Start of shift: check the department Teams / Intermedia updates for workflow, provider, template, or availability changes BEFORE going available. A rule that changed overnight is the easiest way to work a whole shift wrong.',
        ],
        script: [
          {
            say: '"Thank you for calling — can I have the phone number on the account? … And which of the children am I helping with today?"',
            not: '"Name and date of birth?" (to a Pediatrics parent)',
            why: 'The parent\'s number is the family key in Pediatrics. Asking for the child\'s details first slows the call and invites a same-name mix-up before the family account is even open.',
            departments: ['pediatrics'],
          },
        ],
      },
      {
        title: 'Read the chart before you make her re-tell the story',
        points: [
          'Two patients with the same name? Verify DOB — and address or phone if still ambiguous — BEFORE opening or discussing either chart. A wrong chart poisons everything downstream: the TE, the booking, the documentation.',
          { text: 'Pediatrics multi-child calls: work each child\'s request inside that child\'s own chart. Never batch siblings\' requests under whichever chart happens to be open.', departments: ['pediatrics'] },
          { text: 'OB/GYN especially: once the account is verified, check the chart (Encounters, Medical Summary, last note, open TEs) before asking the patient to explain everything — the chart often already says what she needs. Don\'t schedule from her wording alone.', departments: ['obgyn'] },
        ],
        example: {
          departments: ['pediatrics'],
          intro: 'A Pediatrics parent calls about two children. Watch where the navigator switches charts.',
          turns: [
            { speaker: 'caller', text: 'Hi, I need a refill for Moshe and my daughter Rivky has a fever since last night.' },
            { speaker: 'nav', text: 'I can help with both. Let me start with Moshe — can you confirm his date of birth for me?', note: 'Two requests, two charts. The navigator names which child they are working first.' },
            { speaker: 'nav', text: 'Thank you. Which medication is it, and which pharmacy do you use? … And is he completely out, or does he have some left?', note: 'Refill worked fully in Moshe\'s chart before touching Rivky\'s.' },
            { speaker: 'nav', text: 'That\'s sent to our clinical team. Now for Rivky — her date of birth? I\'ll get her a same-day sick visit and note the fever.', note: 'Explicit chart switch, re-verified, before the second request is touched.' },
          ],
        },
      },
    ],
    mistakes: [
      {
        mistake: 'Opening the chart that "looks right" and verifying while talking.',
        consequence: 'One same-name miss and you\'ve read one family\'s information to another — a privacy failure — and every TE you write lands in the wrong record.',
        instead: 'Verify DOB (and address/phone if needed) first. The chart opens after identity is proven, never before.',
      },
      {
        mistake: 'Making the patient recite her whole history before you\'ve looked at the chart.',
        consequence: 'You waste the call and miss what the record already tells you — the RTO, the open TE, the fact she\'s an active OB patient.',
        instead: 'Verify the account, glance at the chart, then ask only the questions the chart leaves open.',
        departments: ['obgyn'],
      },
    ],
    quickRef: {
      title: 'Lookup, by department',
      rows: [
        { label: 'Pediatrics', value: 'Parent\'s phone number first → family account → pick the child → confirm DOB', departments: ['pediatrics'] },
        { label: 'OB/GYN · BH · Internal Med', value: 'DOB first → confirm first + last name → confirm account before discussing anything', departments: ['obgyn'] },
        { label: 'Same-name collision', value: 'DOB, then address/phone — before opening either chart' },
        { label: 'OB/GYN, after verifying', value: 'Check Encounters / Medical Summary / last note / open TEs before asking her to re-explain', departments: ['obgyn'] },
        { label: 'Yellow "Y" on a Peds pull-up', value: 'Coverage active, but Aizer is NOT the PCP', departments: ['pediatrics'] },
        { label: 'Start of shift', value: 'Teams / Intermedia updates → then go available' },
      ],
    },
    drill: [
      {
        departments: ['pediatrics'],
        prompt: 'A caller asks about "Yitzy Gross." Two patients named Yitzy Gross come up, ages 4 and 6. The caller is in a hurry. What do you do?',
        options: [
          { text: 'Open the 4-year-old\'s chart — the caller sounds young, it\'s probably the younger child.', why: 'Guessing is how the wrong chart gets opened. Age of the caller\'s voice proves nothing.' },
          { text: 'Ask for the child\'s date of birth before opening either chart.', correct: true, why: 'Identity is proven before any chart opens. Ten seconds of verification beats a privacy incident and a mis-documented record.' },
          { text: 'Open both charts side by side and figure it out as the call goes.', why: 'Now you\'re one mis-click away from reading or writing in the wrong record — with both open, mistakes look identical to correct work.' },
        ],
      },
      {
        departments: ['obgyn'],
        prompt: 'A verified OB patient says "I need an appointment with women\'s health." What\'s the strongest first move?',
        options: [
          { text: 'Book a GYN office visit — that\'s the general women\'s health slot.', why: 'She may be an active OB patient with a return visit due. Booking a generic GYN visit without checking Encounters is the classic OB trap.' },
          { text: 'Check her chart — Encounters, Medical Summary, open TEs — then ask what kind of visit so her answer matches her real history.', correct: true, why: 'Read the chart first. "Appointment with women\'s health" is a label, not an order — the chart tells you whether she\'s OB, GYN, postpartum, or has an RTO due.' },
          { text: 'Ask her to explain everything going on so you can decide.', why: 'The chart often already explains it. Make her re-tell only what the record leaves open — don\'t start from a blank slate.' },
        ],
      },
    ],
    simulations: [
      {
        label: 'Pediatrics',
        departments: ['pediatrics'],
        title: 'The same-name trap',
        callerName: 'Parent',
        intro: 'A parent calls about a sick child — and two patients share the name. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'Hi, my son Yitzy Gross has had a fever since last night — can he be seen today?',
            choices: [
              { text: 'Let me pull him up — can you confirm his date of birth for me first?', next: 'n2', tone: 'good', feedback: 'Identity before the chart. With two Yitzy Grosses on file, this is the only safe first move.' },
              { text: 'Sure — let me open his chart. Okay, I see Yitzy. What are the symptoms?', next: 'end_wrongchart', tone: 'bad', feedback: 'You opened a chart on the name alone — but there are two Yitzy Grosses on file.' },
            ],
          },
          n2: {
            caller: 'It\'s 03/14/2018. Oh — and while I have you, my daughter needs a camp form filled out too.',
            choices: [
              { text: 'Let\'s get Yitzy\'s visit set first, then I\'ll switch to your daughter\'s chart for the form.', next: 'n3', tone: 'good', feedback: 'Two children, two charts — sequenced, not batched.' },
              { text: 'No problem — I\'ll note the form here so it\'s not forgotten.', next: 'end_batch', tone: 'bad', feedback: 'The daughter\'s form is now documented on Yitzy\'s chart.' },
            ],
          },
          n3: {
            caller: 'Great. Honestly today is really hard — can we come tomorrow morning instead?',
            choices: [
              { text: 'A sick visit only books for the day itself. I can find a slot today; if tomorrow works better, call us tomorrow for that day\'s same-day availability. Which would you prefer?', next: 'end_strong', tone: 'good', feedback: 'Same-day rule held, and you offered a real path without pre-booking a future-day sick slot.' },
              { text: 'Sure, I\'ll book the sick visit for tomorrow morning.', next: 'end_sameday', tone: 'bad', feedback: 'A same-day sick visit booked for a future day will be unwound.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'Right chart, clean call', summary: 'You verified DOB before opening anything, kept two children in two charts, and held the same-day rule while still giving the parent a workable option.', lesson: 'Identity first, one child per chart, and hold the visit-type rules with a path forward — that\'s the opening done right.' } },
          end_wrongchart: { ending: { verdict: 'weak', title: 'Wrong-chart risk', summary: 'You opened a chart on the name alone with two matches on file. One wrong click and you\'ve discussed one family\'s child under another\'s record — a privacy breach and a mis-documented visit.', lesson: 'Never open or discuss a chart until DOB (and address/phone if needed) proves identity.' } },
          end_batch: { ending: { verdict: 'mixed', title: 'Right child, wrong chart', summary: 'You handled Yitzy well, but the daughter\'s form landed on his chart. Clinical and clerical staff act on the chart, not on your memory of the call.', lesson: 'Each child\'s request lives in that child\'s chart. Finish one, switch, re-verify, then work the next.' } },
          end_sameday: { ending: { verdict: 'mixed', title: 'Good ID, wrong visit type', summary: 'Your identity work was clean, but a same-day sick visit booked for tomorrow is invalid by definition and will be unwound — the child still isn\'t on the schedule.', lesson: 'Same-day sick = the day itself only. If tomorrow is better, the parent calls tomorrow for that day\'s same-day availability.' } },
        },
      },
      {
        label: 'OB-GYN',
        departments: ['obgyn'],
        title: 'The chart tells the story',
        callerName: 'Patient',
        intro: 'A verified OB/GYN patient opens with a vague request. Read the chart before you book. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'Hi, I need to make an appointment with women\'s health.',
            choices: [
              { text: 'I can help — give me one moment to look at your chart so I match it to your history. … I see a recent New OB and prenatal visits. Are you calling about your pregnancy care?', next: 'n2', tone: 'good', feedback: 'You read Encounters first. Her chart shows she\'s an active OB patient — that changes everything.' },
              { text: 'Sure — I\'ll get you a GYN office visit. What day works?', next: 'end_generic', tone: 'bad', feedback: 'You booked a generic GYN visit without checking whether she\'s an active OB patient — the classic trap.' },
            ],
          },
          n2: {
            caller: 'Yes! The doctor said to come back, and I think there\'s an ultrasound too?',
            choices: [
              { text: 'Let me check your Medical Summary for the exact instruction rather than guess. … It says RTO 3 weeks, BPP with MD. So I\'ll build the scan and the doctor visit together.', next: 'n3', tone: 'good', feedback: 'The RTO is the order — you read it instead of scheduling from her wording.' },
              { text: 'I\'ll add an ultrasound and a doctor visit for you this week.', next: 'end_noorder', tone: 'bad', feedback: 'You added a scan from her words. A pregnancy sonogram needs a documented order.' },
            ],
          },
          n3: {
            caller: 'Can I just do the ultrasound and see the doctor another time?',
            choices: [
              { text: 'They work as one appointment — the provider needs the scan for the visit — so I\'ll keep them back-to-back and mark the second one OB Verified so you get one clear reminder.', next: 'end_strong', tone: 'good', feedback: 'BPP-with-MD is a paired appointment; you kept the pair intact.' },
              { text: 'Sure, I\'ll book the ultrasound now and the doctor visit whenever suits you.', next: 'end_split', tone: 'bad', feedback: 'You split a paired appointment — the scan and MD visit can\'t be separated.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'Chart-first, order-true', summary: 'You read Encounters and the Medical Summary before booking, recognized her as an active OB patient, followed the documented RTO (BPP with MD), and kept the paired appointment together with OB Verified on the second record.', lesson: 'Schedule from the chart, not the patient\'s words. The RTO is the order; paired appointments move as one.' } },
          end_generic: { ending: { verdict: 'weak', title: 'Booked blind', summary: 'You booked a general GYN visit for an active OB patient with a documented return visit due. "Appointment with women\'s health" is a label — the chart tells you what she actually needs.', lesson: 'Always check Encounters before booking. A vague label is never an appointment order.' } },
          end_noorder: { ending: { verdict: 'weak', title: 'A scan with no order', summary: 'You added a sonogram from the patient\'s statement. Patients can\'t self-order pregnancy scans — a scan needs a Medical Summary instruction, provider note, or TE, or a TE to OB Portal to clarify.', lesson: '"The doctor mentioned an ultrasound" is not an order. Verify it in the chart or send a TE to OB Portal.' } },
          end_split: { ending: { verdict: 'mixed', title: 'You split the pair', summary: 'The BPP sonogram and the MD visit function as one appointment — the provider needs the scan for the visit. They can\'t be separated across days or by a gap.', lesson: 'Paired appointments (New OB, BPP/Growth w/MD, IUD + GYN Sono) move and cancel together. Never keep one half.' } },
        },
      },
    ],
    keyTakeaways: [
      { text: 'Peds: ask for the parent\'s phone number first — it\'s the family key that opens every sibling at once.', departments: ['pediatrics'] },
      { text: 'Adult departments (OB/GYN): verify DOB first, then name, then confirm the account before discussing anything.', departments: ['obgyn'] },
      'Never open or discuss a chart until identity is confirmed.',
      { text: 'OB/GYN: read the chart before you book — the record, not the patient\'s wording, decides the visit.', departments: ['obgyn'] },
    ],
  },

  // ── CLASSIFICATION ────────────────────────────────────────────────────────
  {
    domainId: 'classification',
    title: 'Classifying the Call',
    blurb: 'The core thinking skill — naming which workflow a request belongs to, and catching the serious symptom under a routine one.',
    estMinutes: 30,
    lessons: [
      {
        title: 'Name the workflow before you act',
        points: [
          'Every request maps to a workflow: scheduling, symptom / clinical question, refill, labs, procedure, transfer, late arrival, or callback. If you can\'t name it, you can\'t route it.',
          'One call can carry several requests — a refill AND a clinical question are two workflows, each on its own path. Handle them separately or one of them silently disappears.',
          'Clinical questions are classified and ROUTED, never answered. "Is this normal?", "Should I be worried?", "Are my results okay?" — all clinical, all routed to the clinical team.',
        ],
        script: [
          {
            say: '"That\'s a question for our clinical team — I\'m sending it to them right now with your callback number."',
            not: '"That sounds pretty normal, but let me send it over anyway."',
            why: 'The first sentence classifies and routes. The second answers a clinical question first — a scope violation — and only then routes.',
          },
        ],
      },
      {
        title: 'Serious symptoms outrank everything — but you don\'t triage them',
        departments: ['obgyn'],
        points: [
          'A serious symptom — decreased fetal movement, heavy bleeding, severe pain, possible water breaking, possible miscarriage — takes priority over whatever the caller originally wanted. Classify it first; the routine part waits.',
          'You are NOT clinically trained. Do not decide whether a symptom is safe to wait, and do not send the patient anywhere (including Labor & Delivery) on your own judgment. Gather the facts without triaging.',
          'The serious-OB-symptom workflow: create/update a High Priority Telephone Encounter to OB Portal → message the "Women\'s Health OB Urgent Calls" Intermedia channel → follow the clinical team. They direct care; you don\'t create an urgent appointment yourself.',
          'A positive home pregnancy test with a reliable last period (LMP) is a SCHEDULING call (build the New OB pair) — not a clinical question. Unknown/unreliable LMP → schedule a Confirmation of Pregnancy visit.',
        ],
        example: {
          intro: 'A routine OB refill call turns serious. Watch the navigator escalate WITHOUT triaging.',
          turns: [
            { speaker: 'caller', text: 'I\'m calling about my prenatal vitamin refill… also, the baby\'s been moving a lot less since yesterday. I\'m 31 weeks.' },
            { speaker: 'nav', text: 'Thank you for telling me that — that\'s something our clinical team needs to know right away. Let me get a few details.', note: 'The refill is parked. The navigator takes the symptom seriously but does not judge how urgent it is.' },
            { speaker: 'nav', text: 'I\'m sending the decreased-movement concern as a High Priority TE to OB Portal and alerting the urgent channel now. After that\'s escalated, I\'ll create a separate refill TE for your prenatal vitamins.', note: 'Serious symptom first: High Priority TE to OB Portal + the urgent Intermedia channel, follow the clinical team. The unrelated vitamin refill gets its OWN separate TE — never folded into the serious-symptom note. No self-triage, no "go to L&D," no reassurance.' },
          ],
        },
      },
    ],
    mistakes: [
      {
        mistake: 'Answering the "small" clinical question because routing feels like overkill.',
        consequence: 'You\'ve made a clinical judgment without a license. If you\'re wrong, a patient waits at home because the navigator said it "sounds normal."',
        instead: 'Every clinical question — however small — is routed to the clinical team with a callback number.',
      },
      {
        mistake: 'Deciding a serious OB symptom is urgent and telling the patient to go to Labor & Delivery yourself.',
        consequence: 'That\'s clinical triage the navigator is not allowed to do. You may under- or over-react, and you\'ve stepped outside the role.',
        instead: 'Gather facts without triaging → High Priority TE to OB Portal → message the OB Urgent Calls channel → let the clinical team direct care.',
        departments: ['obgyn'],
      },
      {
        mistake: 'Working the caller\'s first request and missing the serious one buried mid-call.',
        consequence: 'The red flag ("less movement since yesterday") gets a routine note and a next-day callback — the opposite of what a serious symptom needs.',
        instead: 'Listen for serious symptoms the whole call. When one appears, re-classify on the spot: escalate first, routine after.',
        departments: ['obgyn'],
      },
    ],
    quickRef: {
      title: 'Classification cheat-sheet',
      rows: [
        { label: '"Is this normal?" / "Are my results okay?"', value: 'Clinical question → route to the clinical team. Never answered by a navigator.' },
        { label: 'Serious OB symptom (↓ movement · heavy bleeding · severe pain · possible loss / water breaking)', value: 'Gather facts (no triage) → High Priority TE to OB Portal → OB Urgent Calls channel → follow clinical team. Navigators never dispatch or self-triage.', departments: ['obgyn'] },
        { label: 'Positive test, reliable LMP', value: 'Scheduling — build the New OB pair (8–12 weeks)', departments: ['obgyn'] },
        { label: 'Positive test, unknown / unreliable LMP', value: 'Scheduling — Confirmation of Pregnancy visit (15 min)', departments: ['obgyn'] },
        { label: 'Refill + a clinical question', value: 'Two workflows: the refill on its path, the clinical question routed on its own' },
      ],
    },
    drill: [
      {
        departments: ['obgyn'],
        prompt: 'An OB patient at 31 weeks says the baby has been moving much less since yesterday. What\'s the correct action?',
        options: [
          { text: 'Tell her to go to Labor & Delivery now so she\'s checked right away.', why: 'Navigators are non-clinical and do not triage or dispatch. Deciding urgency and sending her to L&D is outside the role — even when it feels caring.' },
          { text: 'Gather the details without triaging, create a High Priority TE to OB Portal, and message the OB Urgent Calls channel so the clinical team directs care.', correct: true, why: 'That is the serious-symptom workflow exactly: escalate to the clinical team, who decide what happens — you don\'t create the urgent appointment or judge the urgency yourself.' },
          { text: 'Send a routine TE to the nurses so someone calls her back today.', why: 'A routine note under-reacts to a serious symptom. Decreased fetal movement needs High Priority AND the urgent channel, not the normal queue.' },
        ],
      },
      {
        departments: ['pediatrics'],
        prompt: '"My daughter\'s strep test came back — is she contagious? And can you refill her amoxicillin?" How many workflows is this?',
        options: [
          { text: 'One — it\'s all about the strep: send a single note mentioning everything.', why: 'A contagiousness question is CLINICAL; the refill is its own workflow with required fields. Merging them loses the refill details and mis-routes.' },
          { text: 'Two — a clinical question (contagious?) routed to the clinical team, and a refill worked on the refill path.', correct: true, why: '"Is she contagious?" is routed, never answered. The refill is its own workflow with medication, pharmacy, callback, and supply status.' },
          { text: 'Two — answer the contagiousness question and process the refill.', why: 'However common the knowledge feels, contagiousness for this child is a clinical judgment — routed, not answered.' },
        ],
      },
    ],
    simulations: [
      {
        label: 'OB-GYN',
        departments: ['obgyn'],
        title: 'The buried red flag',
        callerName: 'Patient',
        intro: 'A prenatal patient calls with a routine request — and a serious symptom slipped in. Escalate without triaging. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'I need to refill my prenatal vitamins — oh, and the baby\'s been moving a lot less since yesterday. I\'m 31 weeks.',
            choices: [
              { text: 'Thank you for telling me that — that\'s something our clinical team needs to know right away. Let me get a few details first.', next: 'n2', tone: 'good', feedback: 'The refill is parked. You take the symptom seriously without judging how urgent it is.' },
              { text: 'Let me get your vitamin refill sorted first, then we\'ll note the movement.', next: 'end_missed', tone: 'bad', feedback: 'You led with the refill. The serious symptom is the call now.' },
              { text: 'At 31 weeks with less movement, go to Labor & Delivery right now to get checked.', next: 'end_overstep', tone: 'bad', feedback: 'You decided the urgency and dispatched her yourself — that\'s clinical triage outside the navigator role.' },
            ],
          },
          n2: {
            caller: 'Should I be worried? Is the baby okay?',
            choices: [
              { text: 'I\'m not able to assess that myself — but I\'m flagging this to our clinical team as High Priority right now and alerting our urgent line so they reach you quickly.', next: 'n3', tone: 'good', feedback: 'You held the scope line and moved straight to the escalation workflow.' },
              { text: 'I\'m sure it\'s fine — babies often slow down near the end.', next: 'end_reassure', tone: 'bad', feedback: 'That\'s clinical reassurance you can\'t give — and it can talk her out of being seen.' },
            ],
          },
          n3: {
            caller: 'Okay… so what happens now?',
            choices: [
              { text: 'I\'m putting a High Priority telephone encounter to our OB team — "Decreased Fetal Movement," 31 weeks — and messaging our urgent calls channel. A nurse will call you. Once that\'s sent, I\'ll create a separate refill TE for your prenatal vitamins.', next: 'end_strong', tone: 'good', feedback: 'High Priority TE to OB Portal + the OB Urgent Calls channel — then a SEPARATE refill TE. The serious symptom and the unrelated refill never share one note. Textbook.' },
              { text: 'I\'ll send a regular message to the nurses about the movement and they\'ll get to it.', next: 'end_routineTE', tone: 'bad', feedback: 'A routine note under-reacts — a serious symptom needs High Priority and the urgent channel.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'Escalated, not triaged', summary: 'You caught the serious symptom under a routine request, gathered facts without judging urgency, sent a High Priority TE to OB Portal, alerted the OB Urgent Calls channel, and kept the unrelated vitamin refill on its own separate TE — leaving the clinical decision to the clinical team.', lesson: 'Serious symptoms: gather → High Priority TE to OB Portal → urgent channel → follow the clinical team. Never triage or dispatch — and never fold an unrelated refill into the serious-symptom TE; it gets its own.' } },
          end_missed: { ending: { verdict: 'weak', title: 'The red flag went unspoken', summary: 'You worked the refill first. Decreased fetal movement at 31 weeks is exactly the symptom the escalation workflow exists for — and it slipped behind vitamins.', lesson: 'Listen for serious symptoms the whole call. The moment one appears, it becomes the call.' } },
          end_overstep: { ending: { verdict: 'weak', title: 'You stepped outside the role', summary: 'Navigators are non-clinical and don\'t decide urgency or dispatch patients. Sending her to Labor & Delivery on your own judgment is triage you\'re not trained or authorized to do — you might under- or over-react.', lesson: 'Don\'t send patients to L&D yourself. Escalate to the clinical team via a High Priority TE + the urgent channel; they direct care.' } },
          end_reassure: { ending: { verdict: 'mixed', title: 'Reassurance you can\'t give', summary: 'You engaged the symptom but offered clinical reassurance ("babies slow down") that a navigator can\'t give — and it can undo the urgency the situation needs.', lesson: 'No navigator says whether a symptom is safe. Escalate and let the clinical team reassure or act.' } },
          end_routineTE: { ending: { verdict: 'mixed', title: 'Right idea, wrong priority', summary: 'You routed it to the clinical team but as a routine note. A serious symptom needs the High Priority checkbox AND a message on the OB Urgent Calls channel so it isn\'t sitting in the normal queue.', lesson: 'Serious symptom = High Priority TE + urgent channel, not the routine lane.' } },
        },
      },
      {
        label: 'Pediatrics',
        departments: ['pediatrics'],
        title: 'Two questions, two workflows',
        callerName: 'Parent',
        intro: 'A single call carries a clinical question and a refill. Keep them apart. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'My daughter\'s strep test came back — is she still contagious? And can you refill her amoxicillin?',
            choices: [
              { text: 'Two things there: the contagious question goes to our clinical team, and I\'ll take the refill separately. Let\'s start with the refill — which pharmacy do you use?', next: 'n2', tone: 'good', feedback: 'You named both workflows and split them cleanly.' },
              { text: 'Strep\'s usually contagious for the first day on antibiotics — and I\'ll send the refill over.', next: 'end_advice', tone: 'bad', feedback: 'You answered a clinical question. Contagiousness for this child is a clinical judgment — route it.' },
            ],
          },
          n2: {
            caller: 'CVS on Main. Also, is it normal she still has a fever on day two?',
            choices: [
              { text: 'That\'s another clinical question, so I\'ll include it for the nurse rather than answer it. They\'ll call you back.', next: 'n3', tone: 'good', feedback: 'Second clinical question caught and routed, not answered.' },
              { text: 'Day two with a fever is pretty typical, don\'t worry.', next: 'end_advice', tone: 'bad', feedback: 'Another clinical judgment. "Is this normal?" is never a navigator\'s to answer.' },
            ],
          },
          n3: {
            caller: 'Okay — so how does this all work?',
            choices: [
              { text: 'A refill request with your pharmacy and callback goes to our clinical queue, and a separate note carries your two questions for a nurse. Two paths, both covered.', next: 'end_strong', tone: 'good', feedback: 'Clean separation — the refill keeps its fields, the clinical questions get a callback.' },
              { text: 'I\'ll put it all in one message so everything\'s together.', next: 'end_merge', tone: 'bad', feedback: 'One blob loses the refill\'s required fields and buries the clinical questions.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'Two workflows, cleanly split', summary: 'You routed both clinical questions to the clinical team without answering them, and worked the refill on its own path with pharmacy and callback captured.', lesson: 'One call can hold several workflows. Name each, route clinical questions, and keep the refill\'s fields intact.' } },
          end_advice: { ending: { verdict: 'weak', title: 'You answered a clinical question', summary: 'Whether a child is contagious, or whether a day-two fever is "normal," is a clinical judgment. Answering it — even from common knowledge — steps outside the navigator scope.', lesson: 'Every clinical question is routed to the clinical team, never answered by a navigator.' } },
          end_merge: { ending: { verdict: 'mixed', title: 'Everything in one blob', summary: 'Merging the refill and the clinical questions into one message loses the refill\'s required fields (medication, pharmacy, callback) and buries the questions where the nurse may miss them.', lesson: 'Separate workflows get separate documentation — a refill TE and a clinical-question TE, not one mixed note.' } },
        },
      },
    ],
    keyTakeaways: [
      'Classify before you act — the workflow decides everything downstream.',
      'Serious symptoms outrank routine requests, but you never triage or dispatch — escalate to the clinical team.',
      'Multiple requests = multiple workflows; route every clinical question, never answer it.',
    ],
  },

  // ── ROUTING ───────────────────────────────────────────────────────────────
  {
    domainId: 'routing',
    title: 'Routing & Escalation Pathways',
    blurb: 'Sending each call to the one place that owns it — the right queue, the right person, the right priority.',
    estMinutes: 35,
    lessons: [
      {
        title: 'The routing table is the job',
        points: [
          { text: 'Pediatrics: medical questions, lab-result callbacks, and refills → PEDS Encounters queue. Referrals → Anisa Azeez (PE must be up to date). Shots, immunizations, and digital imaging → Marisa Kraft (TE only if PE is current). Controlled substances (Concerta, Adderall, Ritalin, Vyvanse, Focalin, Xanax…) → Sally Carilli, approved slots only.', departments: ['pediatrics'] },
          { text: 'OB/GYN splits two ways. ROUTINE GYN scheduling you handle DIRECTLY — you do NOT route it to OB Portal: apply the Annual GYN "up to date" rule and book on the correct provider template (Annual UTD → a GYN office visit; Annual not UTD → schedule the Annual GYN so the concern is seen).', departments: ['obgyn'] },
          { text: 'OB Portal owns the CLINICAL and uncertain work: clinical questions, triage, missing or unclear orders, labs, results, procedures, transfer review, pregnancy-related clinical questions, and scheduling EXCEPTIONS (no suitable slot, or you\'re unsure). Two named non-OB-Portal routes: all MFM / high-risk → Rebecca Wood directly; Dr. Bank annual or fertility → the Waiting List Portal (never schedule Dr. Bank directly).', departments: ['obgyn'] },
          { text: 'OB/GYN late arrival → an Intermedia message with the account number, appointment time, and expected lateness. The navigator does not decide whether the office will still see her.', departments: ['obgyn'] },
        ],
      },
      {
        title: 'Commit to the route — and never triage a serious symptom yourself',
        points: [
          'Tell the caller exactly what happens next — the destination, the mechanism, and the callback path. Vague routing ("someone will get back to you") is indistinguishable from no routing.',
          { text: 'Patient completely out of medication (Peds)? The refill TE is marked HIGH PRIORITY — the difference between today and "in a few days."', departments: ['pediatrics'] },
          { text: 'Serious OB symptoms — heavy bleeding, decreased fetal movement, severe pain, possible miscarriage, possible water breaking — go to the clinical team, NOT to Labor & Delivery on your say-so: gather facts, High Priority TE to OB Portal, message the "OB Urgent Calls" Intermedia channel, follow their direction.', departments: ['obgyn'] },
          { text: 'An open OB Urgent or GYN Urgent slot is NOT authorization. A navigator books it only after written nurse/provider approval — never because the slot is empty and the patient sounds urgent.', departments: ['obgyn'] },
        ],
        script: [
          {
            say: '"I\'m sending this to our clinical team right now as High Priority and alerting our urgent line — a nurse will call you back at this number."',
            not: '"I\'ll pass it along and someone should get back to you at some point."',
            why: 'The first states the destination, the mechanism, and the callback path. The second commits to nothing — and the caller calls back tomorrow, angrier.',
          },
          {
            say: '"I can add you to Dr. Bank\'s waiting list — she doesn\'t schedule directly — and I\'d also offer another provider so you\'re seen sooner. The bleeding is already with our clinical team as High Priority."',
            not: '"I\'ll get you on Dr. Bank\'s schedule this week."',
            why: 'Navigators never schedule Dr. Bank directly, and provider preference must never delay routing a serious symptom.',
            departments: ['obgyn'],
          },
        ],
      },
    ],
    mistakes: [
      {
        mistake: 'Deciding a serious OB symptom is urgent and sending the patient to Labor & Delivery yourself.',
        consequence: 'That\'s clinical triage a non-clinical navigator isn\'t allowed to do — you may misjudge it, and you\'ve left the role.',
        instead: 'High Priority TE to OB Portal + a message on the OB Urgent Calls channel. The clinical team decides what happens.',
        departments: ['obgyn'],
      },
      {
        mistake: 'Routing a Pediatrics controlled-substance follow-up like a normal refill.',
        consequence: 'The request bounces — controlled substances have their own owner (Sally Carilli) and their own approved slots. The family loses days.',
        instead: 'Recognize the medication names (Concerta, Adderall, Ritalin, Vyvanse, Focalin, Xanax…) and route to Sally Carilli from the start.',
        departments: ['pediatrics'],
      },
      {
        mistake: 'Scheduling Dr. Bank directly, or letting a provider preference delay clinical routing.',
        consequence: 'Dr. Bank isn\'t navigator-scheduled — the booking is invalid — and a serious symptom sat behind a scheduling preference.',
        instead: 'Dr. Bank annual/fertility → Waiting List Portal; route any clinical concern to OB Portal (High Priority if serious) regardless of provider preference.',
        departments: ['obgyn'],
      },
    ],
    quickRef: {
      title: 'Routing table — pin this',
      rows: [
        { label: 'Peds: medical Q / labs / refills', value: 'TE → PEDS Encounters queue (+ HIGH PRIORITY if completely out)', departments: ['pediatrics'] },
        { label: 'Peds: referrals', value: 'TE → Anisa Azeez — PE must be up to date', departments: ['pediatrics'] },
        { label: 'Peds: shots / imaging', value: 'TE → Marisa Kraft — only if PE is current', departments: ['pediatrics'] },
        { label: 'Peds: controlled substances', value: 'TE → Sally Carilli — approved slots only', departments: ['pediatrics'] },
        { label: 'OB: routine GYN scheduling', value: 'Schedule DIRECTLY — Annual GYN UTD rule + correct provider template. Not OB Portal.', departments: ['obgyn'] },
        { label: 'OB: clinical / unclear / labs / results / procedures / missing orders / transfer / scheduling exceptions', value: 'TE → OB Portal', departments: ['obgyn'] },
        { label: 'OB: all MFM / high-risk', value: 'TE → Rebecca Wood directly (never the regular OB schedule)', departments: ['obgyn'] },
        { label: 'OB: Dr. Bank annual / fertility', value: 'Waiting List Portal — never schedule Dr. Bank directly', departments: ['obgyn'] },
        { label: 'OB: late arrival', value: 'Intermedia message — account #, appointment time, expected lateness', departments: ['obgyn'] },
        { label: 'OB serious symptoms (bleeding · ↓ movement · severe pain · possible loss)', value: 'Gather → High Priority TE to OB Portal → OB Urgent Calls channel → follow clinical team. Never dispatch or book an urgent slot yourself.', departments: ['obgyn'] },
      ],
    },
    drill: [
      {
        departments: ['pediatrics'],
        prompt: 'A Pediatrics mother says her son takes Concerta and the prescription runs out this week; he has a follow-up due. Where does this go?',
        options: [
          { text: 'TE to the PEDS Encounters queue like any refill, marked high priority.', why: 'Concerta is a controlled substance — the normal refill path doesn\'t apply, and mis-routing it costs the family days.' },
          { text: 'TE to Sally Carilli — controlled-substance follow-ups go through her, in approved slots only.', correct: true, why: 'Controlled substances have a dedicated owner and dedicated slots. Recognizing the medication name is the whole game.' },
          { text: 'Book a regular office visit with any available provider so the follow-up happens fast.', why: 'Controlled-substance follow-ups are scheduled in specifically approved slots, not regular ones — a regular booking gets bounced.' },
        ],
      },
      {
        departments: ['obgyn'],
        prompt: 'An OB patient is 34 weeks and reports she\'s been bleeding heavily for the last hour. What do you do?',
        options: [
          { text: 'Tell her to go to Labor & Delivery right now so she\'s seen immediately.', why: 'Navigators don\'t triage or dispatch. Deciding urgency and sending her to L&D yourself is outside the role — even when it feels right.' },
          { text: 'Gather the facts without triaging, send a High Priority TE to OB Portal, and message the OB Urgent Calls channel so the clinical team directs care.', correct: true, why: 'That\'s the serious-symptom workflow: escalate to the clinical team, who decide the next step. You never create the urgent appointment or judge the urgency.' },
          { text: 'Book her into the open OB Urgent slot you can see on the schedule.', why: 'An open OB Urgent slot is not authorization — it\'s booked only after written nurse/provider approval, never because it\'s empty.' },
        ],
      },
    ],
    simulations: [
      {
        label: 'Pediatrics',
        departments: ['pediatrics'],
        title: 'A refill that isn\'t what it seems',
        callerName: 'Parent',
        intro: 'A parent calls about their son\'s medication. How you route it is the whole test. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'Hi, my son Eli needs his Concerta refilled — he\'s got maybe two days left.',
            choices: [
              { text: 'I can help. So I route it right — is Concerta the only medication, and is he completely out or does he have a few days?', next: 'n2', tone: 'good', feedback: 'You\'re gathering the fields and you clocked the drug name. Concerta is controlled — that changes the route.' },
              { text: 'Sure, I\'ll send that refill straight to the pharmacy for you today.', next: 'end_overpromise', tone: 'bad', feedback: 'You promised an outcome you don\'t control and missed that Concerta is controlled — two failures in one sentence.' },
              { text: 'Let me send that over to our nurses to handle.', next: 'n2b', tone: 'ok', feedback: 'Routed, but to the general queue — and you didn\'t register that Concerta is a controlled substance.' },
            ],
          },
          n2: {
            caller: 'Two days left, and yeah — just the Concerta.',
            choices: [
              { text: 'Because Concerta is a controlled medication, it goes to the specific person who handles those — I\'ll send it there with your pharmacy and callback number.', next: 'n3', tone: 'good', feedback: 'Controlled substances route to their dedicated owner and approved slots — not the general queue.' },
              { text: 'Great — I\'ll drop it in the regular refill queue and someone will call you.', next: 'end_wrongqueue', tone: 'bad', feedback: 'The regular queue can\'t process a controlled-substance follow-up. It bounces.' },
            ],
          },
          n2b: {
            caller: 'Okay… it\'s Concerta though, is that a problem?',
            choices: [
              { text: 'Actually — thank you for flagging that. Concerta is controlled, so I\'ll route it specifically to the right person, not the general queue.', next: 'n3', tone: 'good', feedback: 'Good recovery. The caller handed you the catch and you took it.' },
              { text: 'No problem at all — it\'s all the same to us.', next: 'end_wrongqueue', tone: 'bad', feedback: 'It isn\'t all the same — controlled substances have their own path, and you just waved it off.' },
            ],
          },
          n3: {
            caller: 'Thanks. Will it be ready today?',
            choices: [
              { text: 'I can\'t promise the timing since the provider reviews it, but I\'ve routed exactly what you need and our team will call you back at this number.', next: 'end_strong', tone: 'good', feedback: 'Promise the process, never the outcome.' },
              { text: 'Yes, it should be ready by tonight.', next: 'end_overpromise2', tone: 'bad', feedback: 'You routed it correctly, then promised a timing you don\'t control.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'Recognized, routed, honest', summary: 'You caught that Concerta is controlled, sent it to its dedicated owner with the pharmacy and callback, and promised the process instead of a delivery time.', lesson: 'Recognizing a controlled substance is the whole game — then route to the right owner and never promise timing.' } },
          end_wrongqueue: { ending: { verdict: 'weak', title: 'Wrong queue, lost days', summary: 'The refill went to the general queue, which can\'t process a controlled-substance follow-up. It bounces, and the family loses days they didn\'t have.', lesson: 'Concerta, Adderall, Ritalin, Vyvanse, Focalin, Xanax → the controlled-substance owner and approved slots, every time.' } },
          end_overpromise: { ending: { verdict: 'weak', title: 'One sentence, two failures', summary: 'You promised a same-day pharmacy fill you don\'t control and never registered that Concerta is controlled. When nothing arrives, the family is out of meds and out of trust.', lesson: 'Gather the fields, recognize the drug class, and promise the process — not a fill time.' } },
          end_overpromise2: { ending: { verdict: 'mixed', title: 'Right route, wrong promise', summary: 'Your routing was correct, but "ready by tonight" is a promise the provider owns, not you. When the pharmacy has nothing tonight, that promise becomes a complaint.', lesson: 'Even after a perfect route, never attach a timeline you don\'t control.' } },
        },
      },
      {
        label: 'OB-GYN',
        departments: ['obgyn'],
        title: 'Dr. Bank, and bleeding',
        callerName: 'Patient',
        intro: 'A patient wants a specific provider — but she also reports a serious symptom. Route the symptom, respect the preference. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'I\'ve been bleeding pretty heavily today, but I only want to see Dr. Bank.',
            choices: [
              { text: 'I hear that you want Dr. Bank. Heavy bleeding is something our clinical team needs to know about now, so let me take care of that first and then talk options.', next: 'n2', tone: 'good', feedback: 'You put the serious symptom ahead of the scheduling preference — correctly.' },
              { text: 'Okay, let me get you onto Dr. Bank\'s schedule as soon as she has an opening.', next: 'end_bank', tone: 'bad', feedback: 'You tried to schedule Dr. Bank directly AND let a preference delay a serious symptom.' },
            ],
          },
          n2: {
            caller: 'Okay… so what do you do about the bleeding?',
            choices: [
              { text: 'I\'m sending a High Priority note to our OB team about the bleeding and alerting our urgent line, so a nurse calls you quickly.', next: 'n3', tone: 'good', feedback: 'High Priority TE to OB Portal + urgent channel — the serious-symptom workflow.' },
              { text: 'I\'ll send a message to Dr. Bank\'s office so they know about the bleeding.', next: 'end_wrongdest', tone: 'bad', feedback: 'A serious symptom goes to the clinical team via OB Portal + urgent channel, not to one provider\'s office.' },
            ],
          },
          n3: {
            caller: 'And can I still get Dr. Bank for my visit?',
            choices: [
              { text: 'Dr. Bank is booked through a waiting list, so I\'ll add you there — but I\'d also offer another provider so you\'re seen sooner. Either way, the bleeding is already with our clinical team.', next: 'end_strong', tone: 'good', feedback: 'Waiting List Portal for Dr. Bank, alternative offered, symptom already escalated.' },
              { text: 'Sure — I\'ll book Dr. Bank directly for you as soon as she\'s free.', next: 'end_bank', tone: 'bad', feedback: 'Navigators never schedule Dr. Bank directly; she\'s waiting-list only.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'Symptom first, preference handled', summary: 'You didn\'t let a provider preference delay a serious symptom: you escalated the bleeding with a High Priority TE to OB Portal and the urgent channel, then handled the Dr. Bank request through the Waiting List Portal and offered an alternative.', lesson: 'A serious symptom always routes first (OB Portal + urgent channel). Dr. Bank is waiting-list only — never scheduled directly.' } },
          end_bank: { ending: { verdict: 'weak', title: 'Preference over safety', summary: 'You tried to schedule Dr. Bank directly — which navigators don\'t do — and let a scheduling preference sit in front of heavy bleeding.', lesson: 'Never schedule Dr. Bank directly (Waiting List Portal), and never let provider preference delay routing a serious symptom.' } },
          end_wrongdest: { ending: { verdict: 'mixed', title: 'Right urgency, wrong door', summary: 'You treated the bleeding as serious, but routed it to one provider\'s office instead of the clinical team. Serious symptoms go to OB Portal as a High Priority TE plus the OB Urgent Calls channel.', lesson: 'Serious OB symptoms always go to the clinical team via OB Portal + the urgent channel — not to an individual provider.' } },
        },
      },
    ],
    keyTakeaways: [
      { text: 'Peds routing: PEDS Encounters for medical Q / labs / refills, Anisa Azeez for referrals, Marisa Kraft for shots / imaging, Sally Carilli for controlled substances.', departments: ['pediatrics'] },
      { text: 'OB/GYN: routine GYN scheduling is DIRECT (Annual GYN UTD rule + template); OB Portal owns clinical / unclear / labs / results / procedures / missing-order / exception work; MFM → Rebecca Wood; Dr. Bank annual/fertility → Waiting List Portal.', departments: ['obgyn'] },
      { text: 'Serious OB symptoms → High Priority TE to OB Portal + the OB Urgent Calls channel. Navigators never dispatch to L&D or judge urgency.', departments: ['obgyn'] },
      { text: 'An open OB/GYN Urgent slot is not authorization — book it only with written nurse/provider approval.', departments: ['obgyn'] },
      'Name the route out loud — the destination, the mechanism, and the callback — so the caller knows exactly what happens next.',
    ],
  },

  // ── SCHEDULING ────────────────────────────────────────────────────────────
  {
    domainId: 'scheduling',
    title: 'Scheduling & Appointment Rules',
    blurb: 'Reading the order from the chart, building paired appointments correctly, and honoring the timing rules that protect the claim.',
    estMinutes: 35,
    lessons: [
      {
        title: 'Schedule from the chart, not from the patient\'s words',
        points: [
          { text: 'OB/GYN: "checkup," "ultrasound," "the doctor told me" are not orders. The order lives in the chart — the Medical Summary RTO, the last provider note, or a TE. Follow it; don\'t recalculate cadence from memory.', departments: ['obgyn'] },
          { text: 'RTO reading: "RTO 4 weeks" = a routine MD visit. "RTO 3 weeks BPP w/MD" = a BPP sonogram PLUS an MD visit. If the patient claims a scan or interval the chart doesn\'t support, send a TE to OB Portal to clarify — don\'t create it from her statement.', departments: ['obgyn'] },
          { text: 'Pediatrics timing: physicals follow the cadence and the "one calendar year plus one day" commercial rule; the Fidelis/Medicaid early-PE exception needs BOTH a birthday since the last PE AND at least six months elapsed.', departments: ['pediatrics'] },
        ],
        script: [
          {
            say: '"Let me check your Medical Summary for the exact instruction before I book — I want to match your chart, not guess."',
            not: '"Sure, I\'ll add the ultrasound you mentioned."',
            why: 'Patients can\'t self-order pregnancy scans. Booking from the chart\'s documented order (or a TE to OB Portal when it\'s missing) is the whole discipline.',
            departments: ['obgyn'],
          },
        ],
      },
      {
        title: 'Paired appointments, New OB, and what counts as authorization',
        departments: ['obgyn'],
        points: [
          'A New OB (first prenatal) is ONE appointment made of two parts: a 30-minute New OB sonogram and a 30-minute New OB provider visit, back-to-back, same day, no gap. Mark the second record "OB Verified" so the patient gets one clear reminder.',
          'Positive pregnancy test: with a reliable last period (LMP), build the New OB pair directly (usually the 8–12 week window). With an unknown/unreliable LMP, schedule a 15-minute Confirmation of Pregnancy visit first.',
          'Paired appointments (New OB, BPP w/MD, Growth w/MD, IUD insertion + GYN Sono) move and cancel together — never keep one half. Anatomy scan is a 1-hour sonogram with Dr. Rosenberg entered as the SCAN provider plus a separate MD visit; that does NOT make it an MFM appointment.',
          'An open OB Urgent or GYN Urgent slot is NOT authorization to book it — that requires written nurse/provider approval. Overbook only with traceable written approval (a Teams message or TE counts). Annual GYN is "up to date" only if an actual Annual GYN was completed in the department within the past year (a Pap alone, an outside annual, or a postpartum visit don\'t count).',
        ],
        example: {
          intro: 'A patient with a reliable LMP calls after a positive test. Watch the New OB pair get built correctly.',
          turns: [
            { speaker: 'caller', text: 'My home test is positive! My last period was June 1st.' },
            { speaker: 'nav', text: 'Congratulations! With a reliable last period I can set up your first OB visit directly — no separate confirmation needed.', note: 'Reliable LMP → New OB, not a Confirmation of Pregnancy visit.' },
            { speaker: 'nav', text: 'Your first visit is really two appointments that work as one: a 30-minute sonogram and the provider visit right after, same day. I\'ll keep them back-to-back and mark the second one OB Verified.', note: 'New OB pair built correctly — one workflow, two records, no gap.' },
          ],
        },
      },
    ],
    mistakes: [
      {
        mistake: 'Booking a pregnancy scan (or any OB visit) from the patient\'s wording without a documented order.',
        consequence: 'You may create a scan no provider ordered, or the wrong visit entirely — the chart, not the caller, defines the appointment.',
        instead: 'Read the Medical Summary / last note / TE. If the patient\'s claim isn\'t supported, send a TE to OB Portal to clarify.',
        departments: ['obgyn'],
      },
      {
        mistake: 'Splitting a New OB (or any paired) appointment across days, or booking a Confirmation visit when the LMP is reliable.',
        consequence: 'A split pair breaks the visit — the provider needs the scan; a needless Confirmation delays real prenatal care.',
        instead: 'Reliable LMP → build the New OB pair back-to-back same day (OB Verified on the second). Unknown LMP → Confirmation of Pregnancy first.',
        departments: ['obgyn'],
      },
      {
        mistake: 'Granting a Fidelis early PE on a birthday alone (Pediatrics).',
        consequence: 'The claim needs BOTH the birthday AND ≥6 months since the last PE — half-checked bookings become denied claims.',
        instead: 'Check both conditions out loud, every time. It takes one sentence each.',
        departments: ['pediatrics'],
      },
    ],
    quickRef: {
      title: 'Scheduling — pin this',
      rows: [
        { label: 'OB order source', value: 'Medical Summary RTO / last note / TE — never the patient\'s wording', departments: ['obgyn'] },
        { label: 'RTO 4 weeks', value: 'Routine MD visit', departments: ['obgyn'] },
        { label: 'RTO 3 weeks BPP w/MD', value: 'BPP sonogram + MD visit, paired', departments: ['obgyn'] },
        { label: 'New OB (first prenatal)', value: '30-min sono + 30-min provider, back-to-back, same day · 2nd record OB Verified', departments: ['obgyn'] },
        { label: 'Positive test', value: 'Reliable LMP → New OB pair · unknown/unreliable LMP → Confirmation of Pregnancy (15 min)', departments: ['obgyn'] },
        { label: 'Anatomy scan', value: '1-hr sono, Dr. Rosenberg as SCAN provider + MD visit — NOT an MFM appointment', departments: ['obgyn'] },
        { label: 'Annual GYN "UTD"', value: 'Actual Annual GYN in-department within a year (Pap-only / outside / postpartum don\'t count)', departments: ['obgyn'] },
        { label: 'Open OB/GYN Urgent slot', value: 'NOT authorization — book only with written nurse/provider approval', departments: ['obgyn'] },
        { label: 'Peds same-day sick / Fidelis early PE', value: 'Same day only · early PE needs birthday AND ≥6 months', departments: ['pediatrics'] },
      ],
    },
    drill: [
      {
        departments: ['obgyn'],
        prompt: 'An OB patient says "the doctor told me to schedule my anatomy scan." The Medical Summary shows an Anatomy + MD order. How do you build it?',
        options: [
          { text: 'Book a 1-hour Anatomy sonogram with the MFM director only, since anatomy scans are specialist-level.', why: 'This floor doesn\'t restrict anatomy to an "MFM director." Enter Dr. Rosenberg as the SCAN provider and pair it with a separate MD visit — and it\'s not an MFM appointment.' },
          { text: 'Book the 1-hour Anatomy sonogram (Dr. Rosenberg as scan provider) and pair it with the MD visit.', correct: true, why: 'Anatomy is a documented, paired study: the scan (Dr. Rosenberg entered on the scan record) plus the MD visit. Preserve the pair.' },
          { text: 'Book just the anatomy scan — she can see the doctor another time.', why: 'It\'s a paired appointment. The provider needs the scan for the visit, so the scan and MD visit stay together.' },
        ],
      },
      {
        departments: ['obgyn'],
        prompt: 'A patient with a positive test and a reliable LMP of June 1st calls to get started. What do you schedule?',
        options: [
          { text: 'A Confirmation of Pregnancy visit first, then the New OB later.', why: 'Confirmation is for unknown or unreliable LMP. With a reliable LMP you build the New OB pair directly — a needless Confirmation just delays care.' },
          { text: 'The New OB pair — a 30-min sonogram and a 30-min provider visit, back-to-back, in the 8–12 week window.', correct: true, why: 'Reliable LMP → New OB directly, built as the back-to-back sono + provider pair with OB Verified on the second record.' },
          { text: 'Just the sonogram now, and the provider visit once she\'s further along.', why: 'The New OB sonogram and provider visit are one appointment and can\'t be split across days.' },
        ],
      },
      {
        departments: ['pediatrics'],
        prompt: 'A parent wants an early physical for camp. The child had a birthday since the last PE, but that PE was only three months ago. He\'s on Fidelis. Can you book the early PE?',
        options: [
          { text: 'Yes — a birthday since the last physical is enough for the Fidelis early-PE exception.', why: 'A birthday alone is only half the rule. The early-PE exception needs BOTH a birthday AND at least six months since the last PE.' },
          { text: 'No — the early-PE exception needs a birthday AND at least six months since the last PE, and only three have passed.', correct: true, why: 'Both conditions must be met. Three months short of the six-month minimum means the early PE isn\'t covered yet.' },
          { text: 'Book it anyway and let the claim sort itself out.', why: 'Booking an ineligible early PE creates a denied claim and an unexpected bill — check both conditions before booking.' },
        ],
      },
    ],
    simulations: [
      {
        label: 'OB-GYN',
        departments: ['obgyn'],
        title: 'The first pregnancy visit',
        callerName: 'Patient',
        intro: 'A positive test, a reliable last period, and a New OB pair to build correctly. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'My home test came back positive! My last period was June 1st.',
            choices: [
              { text: 'Congratulations! With a reliable last period I can set up your first OB visit directly. Let me find the New OB pair.', next: 'n2', tone: 'good', feedback: 'Reliable LMP → New OB directly. No separate Confirmation needed.' },
              { text: 'Let me book you a Confirmation of Pregnancy visit to get started.', next: 'end_confirm', tone: 'bad', feedback: 'Confirmation is for unknown/unreliable LMP — hers is reliable, so it just delays real prenatal care.' },
            ],
          },
          n2: {
            caller: 'Perfect. What does the first visit look like?',
            choices: [
              { text: 'It\'s two appointments that work as one — a 30-minute sonogram and the provider visit right after, same day, back-to-back.', next: 'n3', tone: 'good', feedback: 'The New OB pair, described exactly right.' },
              { text: 'I\'ll book the sonogram now, and you can see the provider on another day.', next: 'end_split', tone: 'bad', feedback: 'You split the New OB pair — the two parts are one appointment.' },
            ],
          },
          n3: {
            caller: 'Honestly the ultrasound is the part I care about — can I skip the doctor visit for now?',
            choices: [
              { text: 'They\'re one appointment — the provider needs the scan for the visit — so I\'ll keep them together and mark the second one OB Verified so you get a single clear reminder.', next: 'end_strong', tone: 'good', feedback: 'Pair kept intact, OB Verified applied.' },
              { text: 'Sure, we can just do the ultrasound and add the doctor later.', next: 'end_split', tone: 'bad', feedback: 'The pair can\'t be split — the provider needs the scan as part of the visit.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'New OB, built right', summary: 'You recognized a reliable LMP and went straight to New OB, built the sonogram and provider visit back-to-back on the same day, and marked the second record OB Verified for a clean reminder.', lesson: 'Reliable LMP → New OB pair (sono + provider, same day, no gap, OB Verified on the second). Confirmation is only for unknown LMP.' } },
          end_confirm: { ending: { verdict: 'mixed', title: 'A needless confirmation', summary: 'With a reliable LMP you can build the New OB pair directly. Booking a Confirmation of Pregnancy visit is for unknown or unreliable dates and just adds a step before real prenatal care.', lesson: 'Reliable LMP → New OB. Confirmation of Pregnancy is only for unknown/unreliable LMP.' } },
          end_split: { ending: { verdict: 'weak', title: 'You split the pair', summary: 'The New OB sonogram and provider visit are a single appointment — the provider needs the scan for the visit. They can\'t be split across days or separated by a gap.', lesson: 'Paired appointments move and stay together. Build the New OB pair back-to-back, same day.' } },
        },
      },
      {
        label: 'Pediatrics',
        departments: ['pediatrics'],
        title: 'The early physical',
        callerName: 'Parent',
        intro: 'A parent wants a physical sooner than the calendar allows. The exception has two conditions. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'Camp needs a fresh physical and his last one was in October. Can we come in this week? He\'s on Fidelis.',
            choices: [
              { text: 'Fidelis can allow an early physical in some cases — has he had a birthday since that October physical?', next: 'n2', tone: 'good', feedback: 'You know the exception exists and you\'re checking the first of its two conditions.' },
              { text: 'Sure — I\'ll book the physical for this week.', next: 'end_claim', tone: 'bad', feedback: 'You booked an early PE with no eligibility check. If the conditions aren\'t met, the claim is denied.' },
            ],
          },
          n2: {
            caller: 'Yes, he turned 9 back in January.',
            choices: [
              { text: 'And October to now is about seven months — that clears the six-month minimum too. Both conditions are met, so I can book it this week.', next: 'end_strong', tone: 'good', feedback: 'Both conditions checked out loud: new age milestone AND ≥6 months. Now it\'s a clean, covered booking.' },
              { text: 'A birthday means we can do it early — booking it now.', next: 'end_halfcheck', tone: 'bad', feedback: 'A birthday alone isn\'t enough. It happened to also be past six months here — but you didn\'t check.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'Both boxes, then book', summary: 'You recognized the Fidelis early-PE exception and confirmed BOTH conditions — a new age milestone and at least six months since the last PE — before booking.', lesson: 'The early-PE exception needs both conditions, every time. Check each out loud, then book with confidence.' } },
          end_claim: { ending: { verdict: 'weak', title: 'A denied claim in the making', summary: 'You booked an early physical with no eligibility check at all. If either condition is missing, the visit isn\'t covered and the family gets a bill they never expected.', lesson: 'Never book an early PE before confirming the plan\'s specific conditions are met.' } },
          end_halfcheck: { ending: { verdict: 'mixed', title: 'Right outcome, dangerous habit', summary: 'It happened to be past six months here, so the booking is fine — but you granted it on the birthday alone. Next time the six-month gap won\'t be met, and that same habit becomes a denied claim.', lesson: 'Both conditions, not one. "There was a birthday" is only half the rule.' } },
        },
      },
    ],
    keyTakeaways: [
      { text: 'OB/GYN: schedule from the chart (Medical Summary RTO / note / TE), never from the patient\'s wording.', departments: ['obgyn'] },
      { text: 'New OB = 30-min sono + 30-min provider, back-to-back, same day, OB Verified on the second; paired appointments never split.', departments: ['obgyn'] },
      { text: 'An open OB/GYN Urgent slot isn\'t authorization — book it only with written nurse/provider approval.', departments: ['obgyn'] },
      { text: 'Peds early PE needs a birthday since the last physical AND at least six months elapsed — both, every time.', departments: ['pediatrics'] },
    ],
  },

  // ── BOUNDARIES ────────────────────────────────────────────────────────────
  {
    domainId: 'boundaries',
    title: 'Scope & Privacy Discipline',
    blurb: 'The lines a non-clinical navigator never crosses — and the exact words that hold them without losing the caller.',
    estMinutes: 30,
    lessons: [
      {
        title: 'The scope line, and how to hold it warmly',
        points: [
          'You are NOT clinically trained. Never interpret a lab result, give medical advice, judge whether a symptom is safe to wait, decide someone is miscarrying / in labor / infected, or promise clinical approval. Those are the clinical team\'s calls.',
          'Never promise outcomes you don\'t control: no "the doctor will approve it," no "the refill will go out today," no "you\'ll be accepted as a transfer." Promise the PROCESS — what you\'re sending, to whom, and how the answer comes back.',
          'The High Priority checkbox flags a serious symptom for the clinical team — it does NOT authorize you to make a clinical decision. Escalation is not the same as judgment.',
          'A held boundary with no next step feels like a wall. A held boundary WITH a next step feels like service. Always leave the path forward.',
        ],
        script: [
          {
            say: '"I can\'t read results myself — but I\'m sending your request to the clinical team right now, and they\'ll call you back to go through them."',
            not: '"Your results look fine to me."',
            why: 'Both hold the boundary only if you don\'t interpret. The first routes; the second is a clinical judgment a navigator can\'t make.',
          },
          {
            say: '"I can\'t promise what the provider will decide, but here\'s exactly what happens: your request goes to the clinical team now, marked High Priority, and they call you back."',
            not: '"Don\'t worry, they always approve these — it\'ll be sorted today."',
            why: 'The second sentence is a promise you can\'t keep. When it fails, the patient is out of care AND out of trust.',
          },
        ],
      },
      {
        title: 'Privacy under pressure',
        points: [
          'Information goes only to callers AUTHORIZED on the account. Family relationship alone — spouse, grandparent, adult sibling — authorizes nothing.',
          'Behavioral Health is the strictest: you may take information from many callers, but never confirm someone is a BH patient, and never share care details with an unauthorized caller. Even "yes, she\'s a patient here" is a disclosure.',
          { text: 'On a reported pregnancy loss or miscarriage: escalate (High Priority TE to OB Portal + urgent channel) and await clinical direction. Do NOT independently cancel future appointments, remove the pregnancy, or decide follow-up care.', departments: ['obgyn'] },
          'Decline courteously and leave a path forward: take a message, or have the authorized contact call in themselves.',
        ],
        example: {
          departments: ['pediatrics'],
          intro: 'A grandmother calls about her grandson\'s test results. Warm, firm, with a path forward.',
          turns: [
            { speaker: 'caller', text: 'I\'m his grandmother, I watch him every day — I just want to know if the strep test came back.' },
            { speaker: 'nav', text: 'I completely understand, and I can hear how much you\'re on top of his care. I\'m only able to discuss results with the contacts authorized on his account.', note: 'Empathy first, then the rule — stated as what the navigator CAN do, without blame.' },
            { speaker: 'caller', text: 'That\'s ridiculous, I\'m family!' },
            { speaker: 'nav', text: 'I know it\'s frustrating. Here\'s what I can do: if his mom calls us — or adds you to the account — we can share everything. Would you like me to note that she should call?', note: 'The boundary holds under pushback, and the call still ends with a concrete legitimate path.' },
          ],
        },
      },
    ],
    mistakes: [
      {
        mistake: 'Reassuring the caller that a symptom or a result "looks fine" to be kind.',
        consequence: 'That reassurance is a clinical judgment. If it\'s wrong, care was delayed because the phone team said not to worry.',
        instead: 'Kindness without judgment: "That\'s exactly the kind of question our clinical team answers — I\'m sending it now with your callback number."',
      },
      {
        mistake: 'On a reported miscarriage, canceling the patient\'s future OB appointments to be helpful.',
        consequence: 'You\'ve independently changed a pregnancy schedule and possibly removed care she still needs — a clinical decision that isn\'t yours.',
        instead: 'High Priority TE to OB Portal + urgent channel, then await clinical direction. Never cancel or remove pregnancy status yourself.',
        departments: ['obgyn'],
      },
      {
        mistake: 'Promising the refill or approval "will happen today" to end a tense call.',
        consequence: 'The clinical team hasn\'t decided; when it doesn\'t happen, the caller\'s next call is a complaint — with your promise quoted back.',
        instead: 'Promise the process: what you sent, to whom, with what priority, and how the answer comes back.',
      },
    ],
    quickRef: {
      title: 'Never do / do instead',
      rows: [
        { label: 'Interpret a result ("looks normal")', value: 'Route to the clinical team; the answer comes from them' },
        { label: 'Decide a symptom is safe to wait', value: 'Escalate — gather facts, High Priority if serious, let clinicians judge' },
        { label: 'Promise approval / a fill time / transfer acceptance', value: 'Promise the process and the callback, never the outcome' },
        { label: 'Cancel OB appts on a reported loss', value: 'High Priority TE + urgent channel, await clinical direction', departments: ['obgyn'] },
        { label: 'Confirm a BH patient / disclose to unauthorized caller', value: 'Neither confirm nor deny; share only with authorized contacts' },
      ],
    },
    drill: [
      {
        prompt: 'A husband calls for his wife\'s lab results. He\'s polite, knows her DOB and address, and says she asked him to call. What do you do?',
        options: [
          { text: 'Share the results — he verified her details and has her verbal permission.', why: 'Knowing a DOB proves nothing about authorization, and second-hand verbal permission isn\'t authorization on the account.' },
          { text: 'Check whether he is an authorized contact; if not, decline warmly and offer the path — she can call, or add him.', correct: true, why: 'Authorization on the account is the only test. The decline comes with two legitimate paths forward.' },
          { text: 'Read only the "normal" results and hold back anything concerning.', why: 'Partial disclosure is still disclosure — and now you\'ve also made a clinical judgment about what counts as concerning.' },
        ],
      },
      {
        departments: ['obgyn'],
        prompt: 'A patient says "can you just tell me if my results are normal?" You can see the values in the chart. What\'s correct?',
        options: [
          { text: 'Read the values and reassure her they look normal.', why: 'Interpreting a result is a clinical judgment outside the navigator scope — even when the numbers look reassuring.' },
          { text: 'Send or update a TE to OB Portal for the result question, and don\'t interpret it yourself.', correct: true, why: 'Result questions route to the clinical team. You never read or interpret the value.' },
          { text: 'Tell her results are always fine unless someone calls.', why: 'That\'s a false clinical reassurance and can delay a needed callback. Route it to the clinical team.' },
        ],
      },
    ],
    simulations: [
      {
        label: 'Pediatrics',
        departments: ['pediatrics'],
        title: 'The grandmother on the line',
        callerName: 'Caller',
        intro: 'A caller wants results she isn\'t authorized for — and she\'s persistent. Hold the line, keep her. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'This is Yitzy\'s grandmother — I watch him every day. Did his strep test come back?',
            choices: [
              { text: 'I can hear how involved you are in his care. I\'m only able to discuss results with the contacts authorized on his account, though.', next: 'n2', tone: 'good', feedback: 'Empathy first, then the boundary — stated as what you CAN do, no blame.' },
              { text: 'Let me check… yes, it\'s positive, he\'s on amoxicillin now.', next: 'end_breach', tone: 'bad', feedback: 'You disclosed protected results to an unauthorized caller. Relationship is not authorization.' },
            ],
          },
          n2: {
            caller: 'That\'s ridiculous — I\'m family! I take care of him every single day!',
            choices: [
              { text: 'I know it\'s frustrating. If his mom calls, or adds you to his account, we can share everything going forward.', next: 'n3', tone: 'good', feedback: 'The boundary holds under pressure, and you\'re already pointing at the legitimate path.' },
              { text: 'Okay — just this once, since you\'re family. It came back positive.', next: 'end_breach2', tone: 'bad', feedback: 'You knew the rule and abandoned it under pressure. "Just this once" is still a breach.' },
            ],
          },
          n3: {
            caller: 'Fine. Is there anything at all you can do for me right now?',
            choices: [
              { text: 'I can take a message for his mom, or note that she should call us — whichever is easier. I want to get you an answer the right way.', next: 'end_strong', tone: 'good', feedback: 'Boundary held, warmth intact, two legitimate paths offered.' },
              { text: 'Not really — you\'ll just have to have his mom call.', next: 'end_curt', tone: 'ok', feedback: 'The rule held, but you left her with a wall and no next step.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'Held the line, kept the caller', summary: 'You protected the patient\'s privacy, never confirmed anything you shouldn\'t, stayed warm under real pressure, and left the grandmother with two legitimate ways forward.', lesson: 'Authorization on the account decides disclosure — and a boundary with a path forward is service, not a wall.' } },
          end_breach: { ending: { verdict: 'weak', title: 'A privacy breach', summary: 'You disclosed a child\'s test result to a caller who isn\'t authorized on the account. Being family — even a devoted caregiver — is not authorization.', lesson: 'Never share results or care details with anyone not authorized on the account, however sympathetic.' } },
          end_breach2: { ending: { verdict: 'weak', title: 'You knew — and caved', summary: 'You held the rule for one turn, then dropped it under pressure. "Just this once" is exactly the breach the policy exists to prevent, and pressure will come every shift.', lesson: 'A boundary that only holds when it\'s easy isn\'t a boundary. Hold it, and hand over a legitimate path instead.' } },
          end_curt: { ending: { verdict: 'mixed', title: 'Right rule, cold service', summary: 'You protected privacy — but you left the caller with a flat no and no next step. The rule was right; the service wasn\'t.', lesson: 'Decline with a path: take a message, or route the authorized contact to call. Never end on the wall.' } },
        },
      },
      {
        label: 'OB-GYN',
        departments: ['obgyn'],
        title: '"I think I lost the baby."',
        callerName: 'Patient',
        intro: 'A patient reports a possible miscarriage and asks you to cancel everything. Support her — without deciding her care. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'I think I miscarried over the weekend… I just want to cancel all my appointments.',
            choices: [
              { text: 'I\'m so sorry you\'re going through this. I\'m not able to make that change myself, but I\'m getting this to our clinical team right now as High Priority so they can support you.', next: 'n2', tone: 'good', feedback: 'Compassion, then the scope line — you escalate instead of acting on a clinical event.' },
              { text: 'Of course — I\'ll cancel your upcoming visits and take the pregnancy off your schedule.', next: 'end_cancel', tone: 'bad', feedback: 'You independently changed a pregnancy schedule on a reported clinical event — outside the navigator role.' },
            ],
          },
          n2: {
            caller: 'So you\'ll just cancel everything for me?',
            choices: [
              { text: 'I won\'t change your appointments myself — the clinical team reviews first so nothing you might still need is removed by mistake. I\'m sending a High Priority note and alerting our urgent line; a nurse will call you.', next: 'end_strong', tone: 'good', feedback: 'High Priority TE + urgent channel, await clinical direction — exactly right, and kindly explained.' },
              { text: 'Yes — I\'ll clear your whole schedule right now so you don\'t have to think about it.', next: 'end_cancel', tone: 'bad', feedback: 'Still a clinical decision that isn\'t yours; the team must review before anything is removed.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'Supported, not decided', summary: 'You met a painful moment with compassion, held the scope line, and escalated with a High Priority TE to OB Portal plus the urgent channel — leaving the appointment and care decisions to the clinical team.', lesson: 'On a reported pregnancy loss: escalate (High Priority + urgent channel) and await clinical direction. Never cancel appointments or remove pregnancy status yourself.' } },
          end_cancel: { ending: { verdict: 'weak', title: 'A clinical decision that wasn\'t yours', summary: 'Canceling future OB appointments or removing the pregnancy on a reported loss is a clinical decision the navigator can\'t make — the patient may still need care the clinical team would keep.', lesson: 'Escalate a reported loss; don\'t act on it. High Priority TE + urgent channel, then follow the clinical team.' } },
        },
      },
    ],
    keyTakeaways: [
      'No advice, no results, no promises — route instead, and promise the process.',
      'Authorization on the account — not family relationship — decides disclosure.',
      'On a serious clinical event (loss, urgent symptom), escalate and await clinical direction — never act on it yourself.',
    ],
  },

  // ── DOCUMENTATION ─────────────────────────────────────────────────────────
  {
    domainId: 'documentation',
    title: 'Documentation & Follow-through',
    blurb: 'TEs a clinician can act on the first time, new-TE-vs-Take-Action discipline, and clean reason fields.',
    estMinutes: 30,
    lessons: [
      {
        title: 'A TE someone can act on — the first time',
        points: [
          'A complete refill TE answers every question the clinical team would otherwise call back to ask: medication + dosage, prescribing provider (from the e-prescription log), preferred pharmacy, best callback number, and whether the patient is completely OUT → mark it HIGH PRIORITY.',
          'Use a short, recognizable reason: "Refill Request," "Severe Pain," "Missing Order." Put the detail in the TE body — don\'t write a diagnosis.',
          'Never type "urgent" into the message to convey priority. Use the High Priority checkbox — that\'s the workflow.',
          'The DESTINATION is part of the documentation — a perfect TE in the wrong queue helps no one.',
          { text: 'For paired OB/GYN appointments, mark the second record "OB Verified" so the patient gets one clear reminder.', departments: ['obgyn'] },
        ],
        doc: {
          departments: ['obgyn'],
          label: 'Model serious-symptom TE — OB Portal',
          lines: [
            'REASON — Decreased Fetal Movement',
            'Assign to: OB Portal',
            'High Priority: YES',
            'Body: Pt 31 weeks, reports much less movement since yesterday.',
            'Callback: (845) 555-0142, best before 3pm.',
            'Also messaged the OB Urgent Calls channel.',
          ],
          note: 'Short recognizable reason, correct destination, High Priority checkbox (not the word "urgent"), gestational age + callback in the body, and the urgent-channel alert. No diagnosis, no triage.',
        },
      },
      {
        title: 'New TE or Take Action — don\'t duplicate, don\'t mix',
        points: [
          'Before creating a TE, check whether an OPEN TE already exists for the same issue. If it does, use Take Action to add the patient\'s callback, worsening symptom, or missing detail — don\'t open a duplicate that fragments the history.',
          'An open TE for a DIFFERENT issue? Create a separate TE. Never fold an unrelated refill into an open serious-symptom TE.',
          { text: 'Same-day sick visits (Peds): ALL reported symptoms go in the reason field — "FEVER + COUGH since last night," not just "sick." The provider preps from that line.', departments: ['pediatrics'] },
          'Write it during the call, not after: details reported mid-call evaporate the moment you hang up. Read the key facts back before you send.',
        ],
        script: [
          {
            say: '"I see an open note about that issue from yesterday — I\'ll add an update to that one rather than start a new one, and keep it High Priority."',
            not: '"I\'ll create a new note so it gets noticed."',
            why: 'A duplicate TE fragments the history and splits the clinical team\'s attention. Take Action keeps one clean thread.',
          },
        ],
      },
    ],
    mistakes: [
      {
        mistake: 'Sending a refill TE without the callback number, pharmacy, or medication.',
        consequence: 'The clinical team must call the family to ask, the family misses the call, the refill slides a day — one blank field became 24 hours.',
        instead: 'Run the field checklist before sending: medication · prescriber · pharmacy · callback · (Peds) supply status.',
      },
      {
        mistake: 'Opening a second TE for an issue that already has an open one.',
        consequence: 'The history fragments — the clinical team sees two half-notes and loses the thread of what\'s already been done.',
        instead: 'Check for an open TE first. Same issue → Take Action. Different issue → a separate TE.',
      },
      {
        mistake: 'Typing "URGENT" in the message instead of using the priority workflow.',
        consequence: 'It may be missed, and it isn\'t how the queue surfaces urgency — the word does nothing the checkbox does.',
        instead: 'Use the High Priority checkbox — that\'s how the queue actually surfaces urgency.',
      },
    ],
    quickRef: {
      title: 'Documentation — pin this',
      rows: [
        { label: 'Refill TE fields', value: 'Medication · prescriber (e-Rx log) · pharmacy · callback · out? → High Priority' },
        { label: 'Reason field', value: 'Short + recognizable ("Severe Pain," "Refill Request") — never a diagnosis' },
        { label: 'Priority', value: 'High Priority checkbox — never type "urgent"' },
        { label: 'Serious OB symptom priority', value: 'High Priority TE to OB Portal + message the OB Urgent Calls channel', departments: ['obgyn'] },
        { label: 'Open TE, same issue', value: 'Take Action — add callback / worsening / detail. No duplicate.' },
        { label: 'Open TE, different issue', value: 'Separate TE — never mix unrelated requests' },
        { label: 'Peds same-day sick', value: 'All symptoms in the reason field ("FEVER + RASH since Tue")', departments: ['pediatrics'] },
        { label: 'Paired appointment', value: 'Mark the second record OB Verified', departments: ['obgyn'] },
      ],
    },
    drill: [
      {
        departments: ['obgyn'],
        prompt: 'A patient calls back: "I phoned yesterday about bleeding and nobody\'s called me." There\'s already an open bleeding TE. What do you do?',
        options: [
          { text: 'Create a new bleeding TE so it gets fresh attention.', why: 'A duplicate fragments the history — the clinical team ends up with two half-notes and loses track of what\'s been done.' },
          { text: 'Use Take Action on the open TE to note she called again and is still waiting, keeping it High Priority.', correct: true, why: 'Same issue, open TE → Take Action. One clean thread, updated, still High Priority.' },
          { text: 'Type "URGENT — still no callback" as a brand-new message.', why: 'Typing "urgent" isn\'t the workflow, and a new message duplicates the existing TE. Use Take Action + the High Priority checkbox.' },
        ],
      },
      {
        departments: ['pediatrics'],
        prompt: 'This TE is about to go out: "Mom called, needs refill for the ADHD med, please send to pharmacy. Thanks!" What\'s wrong with it?',
        options: [
          { text: 'Nothing major — the clinical team can look up the details.', why: 'Which medication? Which pharmacy? Callback? Is he out? Every gap is a callback — and "the ADHD med" may be a controlled substance routed to the wrong owner.' },
          { text: 'Almost everything: no medication name, pharmacy, callback, or supply status — and a controlled substance would be in the wrong queue.', correct: true, why: 'Five gaps, each a round-trip. ADHD meds (Concerta, Adderall…) are controlled and route to Sally Carilli, not the general queue.' },
          { text: 'Only the tone — it should be more formal.', why: 'Tone is fine. The problem is that nothing here is actionable without a callback to the family.' },
        ],
      },
    ],
    simulations: [
      {
        label: 'Pediatrics',
        departments: ['pediatrics'],
        title: 'Build the TE the nurse can act on',
        callerName: 'Parent',
        intro: 'A refill call. Every field you capture now is a callback the nurse won\'t have to make. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'Hi — my son needs a medication refill.',
            choices: [
              { text: 'I can help with that. Which medication is it, and which pharmacy do you use?', next: 'n2', tone: 'good', feedback: 'You\'re gathering the fields a refill TE actually needs.' },
              { text: 'Okay, I\'ll send a refill request over to the nurses for you.', next: 'end_thin', tone: 'bad', feedback: 'A "needs a refill" TE with no medication, pharmacy, callback, or supply status is unworkable.' },
            ],
          },
          n2: {
            caller: 'It\'s his amoxicillin. Walgreens on 17M. He\'s completely out, actually.',
            choices: [
              { text: 'Completely out — I\'ll flag it high priority. What\'s the best callback number for you?', next: 'n3', tone: 'good', feedback: '"Out" triggers the HIGH PRIORITY flag, and you\'re still collecting the callback.' },
              { text: 'Got it — sending that over now.', next: 'end_nocallback', tone: 'ok', feedback: 'You have the medication and pharmacy, but no callback number and no priority flag.' },
            ],
          },
          n3: {
            caller: '(845) 555-0142.',
            choices: [
              { text: 'Let me read it back: amoxicillin, Walgreens on 17M, completely out, callback (845) 555-0142 — sending it high priority to our pediatric team now.', next: 'end_strong', tone: 'good', feedback: 'The read-back catches a wrong pharmacy or number while she\'s still on the line — the cheapest possible moment.' },
              { text: 'Perfect — I\'ll get this sent, it should be filled by tonight.', next: 'end_overpromise', tone: 'bad', feedback: 'A complete TE, undone by promising a fill time the provider controls, not you.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'A TE with no round-trip', summary: 'You captured medication, pharmacy, supply status, and callback, flagged it high priority because he\'s out, and read it back before sending. The nurse can act without calling the family first.', lesson: 'Complete TE = what, who, where, callback, priority — read back, then sent to the right queue.' } },
          end_thin: { ending: { verdict: 'weak', title: 'Five callbacks in one line', summary: '"Needs a refill" with no medication, pharmacy, callback, or supply status is five separate phone calls the nurse now has to make — and if it\'s a controlled substance, it\'s in the wrong queue too.', lesson: 'Gather every field on the call. A thin TE just moves the work — and the delay — downstream.' } },
          end_nocallback: { ending: { verdict: 'mixed', title: 'Missing the reach-back', summary: 'You have the medication and pharmacy, but no callback number and no priority flag — so the nurse can\'t reach the family, and an out-of-medication refill isn\'t marked urgent.', lesson: 'Callback number and supply status aren\'t optional. "Out" always means the HIGH PRIORITY flag.' } },
          end_overpromise: { ending: { verdict: 'mixed', title: 'Great TE, wrong promise', summary: 'Your documentation was complete and clean — then "filled by tonight" attached a timeline you don\'t control. When the pharmacy has nothing tonight, the perfect TE is forgotten and the promise is remembered.', lesson: 'Document everything; promise the process. The fill time belongs to the provider and the pharmacy.' } },
        },
      },
      {
        label: 'OB-GYN',
        departments: ['obgyn'],
        title: 'New note, or update the old one?',
        callerName: 'Patient',
        intro: 'A callback on an open issue, a priority to set correctly, and a second unrelated request. Document it cleanly. You take the call.',
        start: 'n1',
        nodes: {
          n1: {
            caller: 'I called yesterday about bleeding and nobody\'s called me back.',
            choices: [
              { text: 'Let me check for that note… I see it\'s still open. I\'ll add an update to it rather than start a new one.', next: 'n2', tone: 'good', feedback: 'Open TE, same issue → Take Action. No duplicate.' },
              { text: 'I\'ll create a new bleeding note so it gets fresh attention.', next: 'end_dup', tone: 'bad', feedback: 'A duplicate TE fragments the history and splits the clinical team\'s attention.' },
            ],
          },
          n2: {
            caller: 'Okay — can you make sure they know it\'s serious?',
            choices: [
              { text: 'I\'m using Take Action to note you called again and are still waiting, and I\'ll keep it High Priority.', next: 'n3', tone: 'good', feedback: 'High Priority via the checkbox, one clean updated thread.' },
              { text: 'I\'ll type "URGENT URGENT" in the message so they can\'t miss it.', next: 'end_urgentword', tone: 'bad', feedback: 'Typing "urgent" isn\'t the workflow — the High Priority checkbox and urgent channel are.' },
            ],
          },
          n3: {
            caller: 'Thank you. Oh — and while I have you, I need a refill on my prenatal vitamins.',
            choices: [
              { text: 'That\'s a separate issue, so I\'ll open a new refill TE for it — I won\'t fold it into the bleeding note.', next: 'end_strong', tone: 'good', feedback: 'Different issue → separate TE. The bleeding thread stays clean.' },
              { text: 'I\'ll just add the refill to the same note so everything\'s in one place.', next: 'end_mix', tone: 'bad', feedback: 'Mixing an unrelated refill into a serious-symptom TE buries both.' },
            ],
          },
          end_strong: { ending: { verdict: 'strong', title: 'One clean thread each', summary: 'You used Take Action on the open bleeding TE instead of duplicating it, kept it High Priority with the checkbox (not the word "urgent"), and opened a separate TE for the unrelated refill.', lesson: 'Same issue → Take Action. Different issue → new TE. High Priority is a checkbox, not a word you type.' } },
          end_dup: { ending: { verdict: 'weak', title: 'A duplicate that fragments', summary: 'A second bleeding TE splits the history — the clinical team now has two partial notes and can\'t see what\'s already been done.', lesson: 'Check for an open TE first; if the issue matches, use Take Action rather than creating a duplicate.' } },
          end_urgentword: { ending: { verdict: 'mixed', title: 'The word isn\'t the workflow', summary: 'You kept it on the right TE, but typing "urgent" doesn\'t raise priority the way the queue actually surfaces it — the High Priority checkbox and the OB Urgent Calls channel do.', lesson: 'Never type "urgent" for priority. Use the High Priority checkbox (+ urgent channel for serious symptoms).' } },
          end_mix: { ending: { verdict: 'mixed', title: 'Two issues, one buried note', summary: 'Folding an unrelated refill into a serious-symptom TE means one of them gets missed — the refill lacks its fields and the bleeding note is now cluttered.', lesson: 'Unrelated requests get their own TEs. Keep each issue on its own clean thread.' } },
        },
      },
    ],
    keyTakeaways: [
      'Complete TE = no round-trip: what, who, where, callback, priority — with a short, recognizable reason, never a diagnosis.',
      'Open TE, same issue → Take Action; different issue → a separate TE. Never duplicate, never mix.',
      'High Priority is a checkbox, never a word you type.',
      { text: 'For serious OB symptoms, use a High Priority TE to OB Portal plus the OB Urgent Calls channel.', departments: ['obgyn'] },
    ],
  },
];

export const moduleForDomain = (domainId) =>
  TRAINING_MODULES.find((m) => m.domainId === domainId) ?? null;

// ─────────────────────────────────────────────────────────────────────────────
// DEPARTMENT SCOPING
//
// Every training module carries content for both live departments. Each catalog
// item (a lesson, a lesson point, a script pair, an example, a model doc, a
// mistake, a quick-reference row, a drill, a simulation, a takeaway) may declare
// a `departments` array of the stable department IDs it belongs to. An item with
// NO `departments` field is genuinely shared and shows in every department.
//
// Use the pure helpers below to render exactly "shared + the selected
// department" — never another department's content. Runtime NEVER infers a
// department from keywords; scope is declared in the data.
// ─────────────────────────────────────────────────────────────────────────────

// The stable department IDs training content may be scoped to.
export const TRAINING_DEPARTMENTS = ['pediatrics', 'obgyn'];

// The declared department scope of a single item, or null when it is shared.
// Plain strings (e.g. a shared lesson point) are always shared.
export const itemDepartments = (item) =>
  item && typeof item === 'object' && Array.isArray(item.departments)
    ? item.departments
    : null;

// True when an item should render for the given department: shared items always
// render; scoped items render only for a department they belong to.
export const belongsToDept = (item, department) => {
  const depts = itemDepartments(item);
  return depts === null || depts.includes(department);
};

// Filter any (possibly missing) array of items down to shared + selected-department
// items only. Safe on undefined/null (returns []).
export const scopeForDept = (items, department) =>
  Array.isArray(items) ? items.filter((it) => belongsToDept(it, department)) : [];

// Read the display text of a point/takeaway that may be a plain string (shared)
// or a `{ text, departments }` object (scoped).
export const itemText = (item) => (typeof item === 'string' ? item : item?.text ?? '');
