# Development History - Knowledge Check

> Full dated development journal, moved out of CLAUDE.md on 2026-07-07 to cut per-session
> context cost. This file is NOT auto-loaded; read it when you need the history of a
> feature, decision, or fix. New entries are added HERE (newest first, same format),
> not in CLAUDE.md.

### 2026-07-07 — Fix mojibake in NavigatorApp.jsx (Practice chooser emoji + punctuation)
- **Context:** The F26 commit saved `NavigatorApp.jsx` with UTF-8 content mis-decoded as
  Windows-1252 and re-encoded (double-encoded UTF-8 + a stray BOM). The Practice chooser
  rendered garbage glyphs instead of the mic/chat emoji, and 15 other spots (em-dashes,
  ellipses, the ⚠ unsaved-result banner) were garbled.
- **Fix:** Byte-level re-decode of the whole file (cp1252 reverse map → UTF-8), BOM stripped.
  Only `NavigatorApp.jsx` was affected in `src/` and `api/`.
- **Verification:** `npm test` → 381 passing; `npm run build` → clean.

### 2026-07-07 — 3-phase assessment flow (F26)
- **Context:** Owner request to stop treating Multiple choice / Spot the Error / Call QA Test as three sibling choices and instead make them one sequenced department assessment.
- **Decisions:** No data-model change; each phase keeps writing what it already wrote. Completion stays **derived, never stored**: MCQ from `resultsByType.mcq`, Spot from `resultsByType.spot`, QA from the latest department-scoped interview doc that has a `qa` field. The old chooser became `PhaseHub`; department select now lands on the hub until all 3 phases are done; coaching and full-profile Spot return to the hub while phases remain; completed phases can be retaken without re-locking later phases; the Practice tab drops the graded QA card so Phase 3 cannot be completed out of order; legacy `__qa` result docs remain fetchable for history but do not count toward phase completion.
- **Files:** new `src/lib/{phases,phases.test}.js`, `src/components/PhaseHub.jsx`; edited `src/components/{NavigatorApp,components.test}.jsx`, `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` → **381 passing** across **15 files**; `npm run build` → clean with the existing chunk-size warning.

### 2026-07-07 â€” Audit follow-ups: department scope, QA isolation, API throttles
- **Context:** Follow-up from a production-readiness audit. Goal was to fix concrete bugs and pilot
  hardening gaps without rebuilding the app's auth model in one oversized pass.
- **Bugs fixed:**
  - `saveResult` now writes the current result and `resultHistory` snapshot in one Firestore batch,
    avoiding split-brain saves and duplicate retry history.
  - Completions now carry `department`; navigator and supervisor reads filter completions to the
    active department, with legacy docs treated as Pediatrics.
  - Navigator mentor floor scores now call `getFloorScores(department)`, returning the latest
    projected result per navigator for that department and deduping by `navigatorId`.
  - Mentor pairings now carry/filter by `department`, preventing same-domain collisions between
    Pediatrics and OB/GYN.
  - `adaptiveTrainingRecommendations` checks `INTERVIEW_SCORE_BANDS.strong` instead of the
    nonexistent `.good`, so weak graded interviews keep call practice as the next step.
  - `seedQuestionsIfEmpty` now seeds missing seed IDs instead of no-oping whenever any question doc
    exists, so future department seeds can be added safely.
  - Call QA Test no longer writes a synthetic six-domain `results` doc; it remains a separate
    QA/readiness scorecard on the interview doc until the QA rubric is domain-tagged.
- **Production hardening:**
  - `server.js` now uses a 100kb JSON limit globally and a 20mb parser only for `/api/refine-sop`.
  - Added tiny dependency-free in-memory rate limits to REST AI routes.
  - `live-relay.js` imports `WebSocket` explicitly from `ws`, caps active voice sessions at 2 per IP,
    and closes calls after 10 minutes.
  - SOP-grounded authoring/scoring handlers now await `sopContextForFresh(department)` so a newly
    activated live SOP is used on the first request when Firestore is reachable.
- **Not changed:** real Firebase role auth, hashed navigator PINs, and CI workflow creation remain
  production work. The attempted GitHub Actions workflow was blocked by the environment because it
  creates persistent external automation; add it only with explicit owner approval.
- **Verification:** `npm test` â†’ 363 passing; `npm run build` â†’ clean with the existing Firebase
  chunk-size warning; `node --check` on all edited API/server files.
- **Files:** new `api/_rate-limit.js`; edited `server.js`, `api/{_sop-context,_sop-store,generate-scenarios,generate-audit,grade-interview,grade-call-qa,interview-turn,sequence-path,live-relay}.js`,
  `src/lib/{db,db.test,scoring,scoring.test}.js`, `src/components/{NavigatorApp,SupervisorApp}.jsx`,
  `CLAUDE.md`.

### 2026-07-06 â€” Codebase refactor & stability audit (no user-facing behavior change intended)
- **Context:** Owner requested a full reliability/maintainability pass â€” find bugs, fragile
  logic, duplication, and weak error handling; fix safely without changing product behavior.
  A 6-agent audit (standards, duplication, logging, secrets, tests, dependencies) drove the pass.
- **Bugs fixed:**
  - `api/sequence-path.js` and `api/refine-sop.js` mapped EVERY non-fatal Gemini failure to 502
    (`result.status ?? 502` â€” auth/exhausted results carry no `.status`), so rate-limit
    exhaustion returned 502 instead of 429. Both also lacked the empty-keys guard; both had a
    stray `model:` field inside the request body (the model lives in the URL) and a dead local
    `MODEL` constant.
  - Key-leak risk in server logs: `_gemini-client.js` logged the raw thrown fetch error (whose
    cause/stack can embed the `?key=<KEY>` request URL) and `live-relay.js` logged the upstream
    WS error message (same URL-key pattern). New exported `redactKeys()` strips `key=` query
    params before logging.
- **Consistency/DRY (all 9 Gemini handlers):**
  - New `rotationFailure(result, overrides)` in `api/_gemini-client.js` â€” the single mapping of a
    failed rotation to HTTP per the documented contract (fatalâ†’502, authâ†’500, exhaustedâ†’429).
    Handlers that previously had no auth branch (auth fell into 429) now correctly return 500
    on all-keys-403; per-endpoint user-facing copy preserved via overrides.
  - `validateSecret` now runs BEFORE the `getApiKeys()` guard in every handler (7 handlers
    previously revealed server-config state to unauthenticated callers); the keys guard itself
    standardized to `if (!keys.length)` and added where missing.
  - `api/grade-interview.js` grade clamping extracted to exported pure `coerceGrade(parsed)`
    (identical behavior, now unit-testable like its grade-call-qa siblings).
  - Scoring rule unified: `optionPoints(question, optionId)` is now exported from
    `src/lib/scoring.js` as THE canonical per-option scoring rule; the two internal duplicates
    (`earnedPoints`, a second `optionPoints`) and one inline copy inside `buildDossier` collapse
    onto it, and the inline re-implementations in `Coaching.jsx`, `MyHistory.jsx`,
    `QuestionBank.jsx`, and `api/generate-coaching.js` (`buildDigest`) now import it.
  - `api/generate-coaching.js` local `domainName` arrow replaced by the `domainName` export from
    `src/data/questions.js`.
  - `Interview.jsx`/`SpotTheError.jsx` inline AbortError message shaping replaced with the
    existing `fetchErrorMessage` helper (helper hardened to tolerate null errors).
  - `NavigatorApp.jsx` silent `catch {/* non-critical */}` around the two `saveCompletion` sites
    now logs (`console.error`) so a failing completions collection is visible in the console.
- **Hygiene:** `.gitignore` gains generic secret patterns (`.env`, `.env.*` with
  `!.env.local.example`, `*.pem`, `*.key`, `*.p12`, `service-account*.json`).
- **Tests:** 328 â†’ **358** passing, 11 â†’ **14** files. New: `src/lib/apiFetch.test.js`
  (apiFetch success/error paths, `fetchErrorMessage`, `runPooled` order/rejection/concurrency),
  `api/_auth.test.js` (`validateSecret`/`isValidSecret` â€” the previously untested security gate),
  `api/grade-interview.test.js` (`coerceGrade`). Extended: `_gemini-client.test.js`
  (+`rotationFailure`, +`redactKeys`), `scoring.test.js` (+`optionPoints`).
- **Intentionally NOT changed:**
  - The `'pediatrics'` literal defaults in `db.js` and the API handlers stay literals â€” they are
    the legacy back-compat key for pre-multi-department docs/clients, not "the default
    department"; if `DEFAULT_DEPT` ever changes, these must still read pediatrics.
  - Vite stays on 5.4.21 (known moderate advisories; the fix is a semver-major jump to Vite 8 â€”
    out of scope for a stability pass; recorded in Â§11 tech debt).
  - `[live-relay] upstream closed` log kept (documented ops signal); `api/_sop-store.js` direct
    Firestore access kept (the server can't import the client-only db.js â€” documented exception);
    tracked `SOP Guide.pdf` left alone (removal is an owner call).
- **Verification:** `npm test` â†’ **358 passing** (14 files); `npm run build` â†’ clean;
  `node --check` on all touched api files â†’ OK.
- **Files:** edited `api/{_gemini-client,generate-scenarios,generate-coaching,interview-turn,
  grade-interview,grade-call-qa,generate-audit,coach-audit,sequence-path,refine-sop,live-relay}.js`,
  `src/lib/{scoring,apiFetch}.js`, `src/components/{Coaching,MyHistory,QuestionBank,Interview,
  SpotTheError,NavigatorApp}.jsx`, `.gitignore`, test files as above, `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-06 â€” F25 hardening: confidence/review layer, context-aware grading, decision-support pass/fail
- **Context:** Owner asked for an audit + hardening of the Call QA grading so management can trust
  it as a decision-support tool â€” reliability, context-awareness, evidence, and pass/fail safety
  over raw scoring. Audit findings on the existing pipeline: the deterministic core was sound, but
  (1) auto-fail reports whose quote didn't verify were **silently dropped** (a possible safety
  event vanished), (2) there was **no confidence layer** â€” every call got a confident PASS/FAIL,
  (3) standalone "Aizer" mis-hearings ("Izer") weren't in the glossary (only two-word phrases),
  (4) the grader prompt didn't demand scenario-conditional judgment or SOP-rule citations, and
  (5) improvement notes didn't carry the transcript quote.
- **Review layer (`assessQa` in `api/_qa-rubric.js`, new):** a PURE, deterministic
  confidence + supervisor-review assessment on top of the scorecard â€” no model call. Returns
  `{ recommendation: 'pass'|'needs_review'|'fail', confidence: 'high'|'medium'|'low',
  safetyRisk: 'none'|'elevated'|'critical', reviewFlags: [{id,label,detail}] }`. Flags:
  `low-transcript-confidence` (â‰¥3 glossary-corrected turns or too-short call),
  `unverified-evidence` (grader quotes not found in the transcript), `possible-unsafe-behavior`
  (auto-fail reported but unverified â€” now surfaced instead of dropped; forces needs_review +
  critical risk), `thin-coverage` (>25 rubric points NA), `safety-criterion-missed`
  (`SAFETY_CRITICAL_CRITERIA` = verify-three, verify-before-access, know-rule, doc-te â€” a passing
  score over a safety miss becomes needs_review), `borderline-score` (within `QA_REVIEW_MARGIN`=5
  of the pass mark), `requires-supervisor-judgment` (verified auto-fail). Two confidence hits â†’
  low confidence â†’ needs_review. `scoreQa` now also returns `unverifiedAutoFails`.
- **Handler (`grade-call-qa.js`):** uses new `correctTranscriptWithStats` (corrected-turn count =
  transcript-quality signal); attaches `review` + `correctedTurns` to the stored `qa`; prompt
  gained a **CONTEXT-AWARE JUDGMENT** block (routing depends on patient state â€” pregnant vs
  non-pregnant vs MFM; refill completeness incl. out-of-med priority; lab calls must be routed,
  never interpreted; escalation triggers; multi-child calls must not conflate patients) and a rule
  that NOT_MET notes must **name the specific SOP rule** so supervisors can coach from them.
- **Glossary (`_qa-glossary.js`):** standalone org-name aliases (`izer`, `iser`, `eiser`, `ayzer`,
  `eyzer`, `aizor`, `aiser` â†’ Aizer) ordered after the two-word phrases so "Izer Health" still
  becomes "Aizer Health"; new `correctTranscriptWithStats` counts changed turns.
- **Evidence-based feedback:** `buildGradeProjection` now appends the verified transcript quote to
  each strength/improvement and auto-fail line, and appends a `FLAGGED FOR SUPERVISOR REVIEW (â€¦)`
  sentence to the stored summary when the recommendation is needs_review â€” so the flags travel
  into the interview doc the supervisor panel already renders.
- **UI:** `VoiceCall.jsx` test results show a NEEDS REVIEW verdict (amber) when flagged, plus a
  "Supervisor review flags" card (confidence + safety risk + each flag). `NavigatorDetail.jsx` QA
  badge gains a `NEEDS REVIEW` variant and the expanded grade panel lists the review flags.
  New `.qa-result--review` / `.qa-reviewflags*` / `.qa-log-badge--review` styles.
- **Pass/fail safety model:** the AI result is decision support â€” a verified auto-fail still
  recommends fail but carries a supervisor-confirmation flag; borderline, low-confidence,
  unconfirmed-unsafe, and safety-miss-while-passing results all recommend supervisor review
  instead of a confident verdict. Domain-score feed unchanged (scores stay deterministic).
- **Verification:** `npm test` â†’ **328 passing** (11 files; +20 regression tests covering
  Izerâ†’Aizer standalone, correction stats, unverified auto-fail retention, all review flags,
  borderline/safety-miss recommendations, evidence quotes in feedback, and the context-judgment
  prompt block); `npm run build` â†’ clean; `node --check` on the 3 edited api files.
- **Files:** edited `api/{_qa-rubric,grade-call-qa,_qa-glossary}.js` + both QA test files,
  `src/components/{VoiceCall,NavigatorDetail}.jsx`, `src/styles.css`, `CLAUDE.md`.
- **Status:** Complete (code). Supervisor grade override (writing a final human verdict back to
  the doc) remains the planned next step; the review flags give supervisors the trigger list.

### 2026-07-03 Ã¢â‚¬â€ F25 QA fairness pass: SOP transcript glossary + context-aware grading
- **Context (pilot feedback):** two linked complaints about the Call QA Test. (1) The grader was
  **too literal / context-blind** Ã¢â‚¬â€ it failed Closing because the navigator didn't say "thank you"
  even though the caller had already thanked them and the call closed naturally. (2) The Gemini Live
  **transcription has no domain vocabulary**, so it mis-heard SOP proper nouns ("Aizer Health" Ã¢â€ â€™
  "Isr Pediatrics", "49 Forest Road", provider/queue names, "PE"), and the literal grader then
  penalized the navigator (e.g. Opening Ã¢Ë†â€™3 for the org name) for terms they actually said right.
  Owner's constraint: correct the transcription toward the closest SOP reference **without making
  it hallucinate words**. Decisions taken via question: **fairness fixes only** (keep verification /
  scope / SOP-knowledge hard) and apply the correction on the **grading transcript** (not live
  captions).
- **Transcript glossary (`api/_qa-glossary.js`, new):** a curated, department-aware glossary of the
  SOP's canonical terms (org name, locations, provider surnames, queues, hospital). `correctText` /
  `correctTranscript` snap mis-hearings to canonical via (1) explicit alias phrases (fixes "Isr
  Pediatrics" Ã¢â€ â€™ "Aizer Health", "peds encounter" Ã¢â€ â€™ "PEDS Encounters") and (2) a conservative
  single-word fuzzy pass (Levenshtein ratio Ã¢â€°Â¥ 0.82, distinctive proper nouns Ã¢â€°Â¥ 6 chars only,
  whole-word replace). **No-hallucination guarantee:** output is bounded to the glossary Ã¢â‚¬â€ an
  unmatched span is left exactly as transcribed; ordinary conversation is untouched.
  `glossaryPromptBlock` hands the grader the canonical spellings + abbreviation equivalences (PE =
  physical exam, TE = telephone encounter, OV = office visit, GS = Good Samaritan, Ã¢â‚¬Â¦) so a synonym
  or correct term never costs a criterion.
- **Grading (`api/grade-call-qa.js`):** the handler now `correctTranscript`s the call BEFORE
  building the prompt and scoring, so both the model verdicts and the evidence-verification gate see
  the corrected text. The system instruction gained scoped **FAIRNESS RULES** (don't fail a
  criterion on a mis-transcribed / synonymous proper noun; accept a natural mutual close for the
  closing pleasantry) that explicitly leave verification, scope/HIPAA, routing, scheduling, and
  SOP-knowledge strict. `_qa-rubric.js` reworded `close-anything-thanks` to accept a courteous
  natural close (exact scripted wording no longer required); points unchanged.
- **Verification:** `npm test` Ã¢â€ â€™ **308 passing** (11 files; +16 `_qa-glossary` tests); `npm run
  build` Ã¢â€ â€™ clean (known Firebase chunk warning only); `node --check` on the new/edited api files.
  Glossary tests cover the reported cases (Isr Pediatrics Ã¢â€ â€™ Aizer Health, provider near-spelling,
  ordinary text untouched, no out-of-glossary output).
- **Not changed:** live captions / the saved interview transcript keep the raw text (grading-only
  scope, per the decision); advisory `grade-interview` is untouched but `_qa-glossary` is reusable
  there later.
- **Files:** new `api/{_qa-glossary,_qa-glossary.test}.js`; edited `api/{grade-call-qa,_qa-rubric}.js`,
  `CLAUDE.md`.
- **Status:** Complete (code). Needs an in-browser voice-call run to confirm end-to-end on the
  real transcription, as with the rest of F22/F25.

### 2026-07-03 - F25: Call QA Test promoted to first-class navigator assessment
- **What changed:** Added **Call QA Test** as the third card in `NavigatorApp`'s
  `AssessmentTypeChooser` (after department selection), alongside Multiple choice and Spot the
  Error. It launches the existing `VoiceCall mode='test'` flow, keeps the Practice-tab entry
  intact, and returns to the navigator dashboard from the test review screen.
- **Domain score feed (later 2026-07-03, superseded 2026-07-07):** QA results now also write `results` +
  `resultHistory` with `assessmentType:'qa'` and a `__qa` result-doc suffix. Because the QA rubric
  is not domain-tagged yet, `scoreQaAcrossDomains(qa)` applies the one full-call QA score to all
  six domains from either Call QA entry point. Domain-practice analytics still ignore `interviews`
  with `qa` so the random call scenario domain cannot satisfy a training/path step.
- **Dashboard UI:** Navigator dashboard now shows the latest department-scoped Call QA Test as a
  small PASS/FAIL card with score, date, and Retake button. `saveInterview` now stores
  `department` for new chat/voice/QA interview docs; old docs continue to fall back to Pediatrics.
- **Verification:** `npm test` -> **292 passing** (10 files); `npm run build` -> clean (existing
  Firebase chunk-size warning only).
- **Files:** edited `src/components/{NavigatorApp,VoiceCall,Interview}.jsx`,
  `src/lib/{db,scoring,scoring.test}.js`, `src/styles.css`, `CLAUDE.md`.

### 2026-07-03 â€” F25: Call QA Test â€” hard rubric-graded voice test (owner-provided quality guide)
- **Context:** Owner wants the voice practice call to double as a real, RELIABLY-graded pass/fail
  test â€” "actually really really hard", no vague scoring â€” and provided the call quality guide
  (`Aizer_Health_Navigator_Quality_Guide_SOP.pdf`, scanned/no text layer; transcribed via Gemini
  native PDF input, the same mechanism F24 uses).
- **Why the old grading couldn't be the test:** `grade-interview` asks Gemini for one holistic
  0â€“100 against prose bands at temp 0.3 â€” the same call can plausibly score 68 or 81 across runs.
  The fix is structural, not prompt-tuning: **the model classifies, the code scores.**
- **What was built:**
  - `api/_qa-rubric.js` â€” the guide's 100-point scorecard as data: 9 categories / 20 binary
    criteria + 3 auto-fails (HIPAA/verification Â· clinical scope Â· conduct), `QA_PASS_THRESHOLD
    = 85`, and the pure pipeline: `verifyEvidence` (fragment-split, role-label-stripped
    normalized matching), `validateQaResponse`, `scoreQa` (trust gates + deterministic math),
    `buildGradeProjection` (maps the scorecard onto the existing interview `grade` shape).
    Guide quirks resolved: timing metrics (<5s answer, 11s dead air) aren't transcript-observable
    â†’ folded into observable call-control criteria; Closing 5-vs-10 contradiction â†’ 5 (the
    100-point scorecard is authoritative).
  - `api/grade-call-qa.js` (`POST /api/grade-call-qa`) â€” Gemini returns ONLY per-criterion
    MET/NOT_MET/NA verdicts + verbatim evidence quotes at **temperature 0** (structured JSON,
    no lite-model fallback, one retry on malformed shape). Trust gates in code: MET with
    unverifiable evidence â†’ NOT_MET; NA on a core criterion â†’ NOT_MET; an auto-fail stands only
    with verified evidence (anti-hallucination) and zeroes the score. Pass = â‰¥85, zero auto-fails.
  - UI: `VoiceCall.jsx` `mode='test'` â€” hard-test copy, QA grading (60s timeout), results screen
    with PASS/FAIL banner, auto-fail cards (quoted offending line), per-category bars, "Points
    you lost" list. Third `PracticeChooser` card (ðŸŽ¯ Call QA Test). `updateInterviewGrade(id,
    grade, qa)` stores the full scorecard on the interview doc; supervisor `NavigatorDetail`
    shows a "QA TEST Â· PASS/FAIL" badge (grade breakdown renders via the existing panel).
- **Live verification (real keys):** a strong fixture call graded **twice with identical verdicts
  on all 20 criteria** (the determinism claim, demonstrated); a bad fixture call (read lab
  results, gave med advice, sarcasm, no verification) â†’ score 0, FAIL. First smoke run exposed
  two evidence-gate fairness bugs â€” model quotes stitched from multiple turns / prefixed with
  role labels were being rejected, and auto-fail evidence was filtered the same way â€” fixed by
  fragment-splitting `verifyEvidence` (any genuine 2+ word fragment verifies) + a
  single-contiguous-quote prompt rule.
- **Verification:** `npm test` â†’ **290 passing** (10 files; +28 QA pipeline tests);
  `npm run build` â†’ clean; `node --check` on both new api files; live smoke test above.
- **Files:** new `api/{_qa-rubric,grade-call-qa,grade-call-qa.test}.js`; edited `server.js`,
  `src/lib/db.js`, `src/components/{VoiceCall,NavigatorApp,NavigatorDetail}.jsx`,
  `src/styles.css`, `CLAUDE.md`.
- **Status:** Complete. QA test results also feed the capability matrix as a full-profile score
  snapshot. Supervisor grade override remains the planned backstop.

### 2026-07-03 Ã¢â‚¬â€ Gemini quota diagnosis + flash-lite overflow lane (free-tier stopgap)
- **Context:** Owner asked why the pilot exhausted the 4-key rotation so fast despite low daily
  volume. Live key probes (tiny generateContent bursts against the real keys) established the
  facts: (1) the 4 keys ARE independent quota pools Ã¢â‚¬â€ key #0 rate-limited while keys 1-3 kept
  returning 200, so rotation works; (2) **the free-tier limit is now 5 RPM per project per model**
  (the 429 body reports `generate_content_free_tier_requests limit=5` Ã¢â‚¬â€ Google's Dec-2025 quota
  cut halved the old 10), so the whole pool is ~20 requests/min; (3) exhaustion was per-minute
  burst pressure (a pre-audit-bank Spot = 6 heavy calls/min from ONE navigator; a practice chat =
  1 call per message), never the daily cap; (4) `gemini-2.5-flash-lite` has a **separate**
  per-model quota bucket on the same keys but its free tier intermittently 503s ("high demand") Ã¢â‚¬â€
  a cushion, not guaranteed capacity.
- **What changed (all stopgap until paid-tier billing is approved for full deployment):**
  - `api/_gemini-client.js` Ã¢â‚¬â€ `MODEL` + new `LITE_MODEL` (`gemini-2.5-flash-lite`) are exported;
    `callGemini` takes a `model` param; `geminiWithRotation` accepts `models: [...]` and tries
    every key on the primary model first, then every key on each fallback model (per-model quota
    buckets). Default stays single-model Ã¢â‚¬â€ no behavior change for handlers that don't opt in.
    New `quotaInfo()` parses the 429 body so Railway logs now say WHICH quota tripped
    (metric, limit value, per-minute vs per-DAY) instead of a bare status code.
  - `api/interview-turn.js` Ã¢â‚¬â€ init + turn calls opt into `models: [MODEL, LITE_MODEL]` (roleplay
    is conversational, unscored; a lighter model beats a 429 mid-call).
  - `api/generate-coaching.js` Ã¢â‚¬â€ same opt-in (advisory prose; client silently drops it on 429).
  - Scored/authoring endpoints (grading, scenario/audit generation, refine-sop, sequence-path)
    deliberately do NOT fall back Ã¢â‚¬â€ quality gate kept.
  - **Follow-up (same day): per-key cooldown.** A key that 429s now sits out for the
    `retryDelay` Gemini's 429 body specifies (default 30 s when absent), per model, so
    concurrent/subsequent requests skip known-limited keys instead of wasting a round-trip
    re-learning it. Module-level `cooldowns` Map + exported `resetCooldowns()` test hook.
    If every key+model is cooling, the rotation returns `exhausted` instantly with zero
    network calls (callers already map that to 429 "try again shortly"). Latency win only Ã¢â‚¬â€
    capacity is unchanged. +4 cooldown tests (skip, healthy-key routing, retryDelay expiry,
    per-model independence).
- **Path to real capacity (owner decision):** enable billing on one Google project (Tier 1 Ã¢â€°Ë†
  hundreds+ RPM; ~$1-2/day at pilot volume), put that key first in `GEMINI_API_KEYS`, keep free
  keys behind it as rotation backup. Zero code change needed. Free-tier stacking is confirmed
  a dead end (5 RPM per extra account).
- **Verification:** `npm test` Ã¢â€ â€™ **262 passing** (9 files; +5 model-fallback and +4 cooldown
  rotation tests); `npm run build` Ã¢â€ â€™ clean; `node --check` on the 3 edited api files Ã¢â€ â€™ OK.
- **Files:** `api/{_gemini-client,_gemini-client.test,interview-turn,generate-coaching}.js`,
  `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-03 Ã¢â‚¬â€ Pilot-feedback pass (6-7 navigator soft launch)
- **Context:** The owner launched the webapp to 6-7 navigators and collected feedback
  ("Knowledge Check Webapp Bugs And Feature Tweaks.docx", untracked). This pass addressed 6 of
  the 9 items; the remaining 3 are: add more keys to `GEMINI_API_KEYS` in Railway (owner action,
  no code), colour-scheme feedback (content unknown Ã¢â‚¬â€ needs specifics), and Railway cold-start
  (infra-side; the in-repo part was fixed here via code-splitting).
- **1 Ã‚Â· Practice caller switched language mid-call** (one navigator's chat "turned into indian"):
  `buildSystemInstruction()` in `api/interview-turn.js` had NO language rule, so nothing stopped
  Gemini drifting into Hindi at roleplay temperatures. Added a CRITICAL English-only rule (covers
  BOTH the text chat and the voice call Ã¢â‚¬â€ the live relay reuses the same persona builder) and an
  "everything in English" line in the init prompt.
- **2 Ã‚Â· Voice/chat practice review never appeared:** grading failures in `VoiceCall.jsx` and
  `Interview.jsx` were swallowed (console.error Ã¢â€ â€™ reviewed screen with a bare "Ã¢â‚¬â€"), and the
  transcript/docId were discarded so nothing could be retried. Both components now keep the saved
  transcript + doc id, explain the failure ("the reviewer may be busy"), and offer a **"Try the
  review again"** button that re-calls `/api/grade-interview` and writes the grade back to the
  interview doc. `VoiceCall` also resets stale grade state when starting a new call.
- **3 Ã‚Â· "Spot the Error" was slow (40Ã¢â‚¬â€œ70 s) with unrealistic scenarios Ã¢â€ â€™ pre-generated audit
  bank:** new Firestore `audits` collection (same draftÃ¢â€ â€™active review-gate model as the question
  bank). `db.js`: `subscribeAudits`, `getActiveAudits(dept)`, `saveDraftAudits`, `activateAudit`,
  `archiveAudit`, `deleteAudit` (+3 db tests). New supervisor UI `AuditBank.jsx` (rendered under
  the Question Bank in the Questions tab): per-domain active-coverage read-off, pooled generation
  (2 concurrent via `runPooled`, now exported from `apiFetch.js`), full-transcript review with the
  planted error highlighted, activate/archive/delete. `SpotTheError.jsx` now draws items from the
  bank first (instant, shuffled, no repeat within an assessment) and only live-generates domains
  the bank can't cover. `generate-audit.js` prompt gained REALISM RULES (specific ordinary
  requests grounded in SOP visit types/queues, natural phone speech, plausible rushed-agent
  mistakes Ã¢â‚¬â€ not cartoonish ones, near-miss distractor turns, English only). Rule added to
  `firestore.rules` Ã¢â‚¬â€ deployed to `quarterly-knowledge-check` on 2026-07-03.
- **4 Ã‚Â· MCQ best answer too obvious:** `generate-scenarios.js` prompt gained a DISTRACTOR QUALITY
  block Ã¢â‚¬â€ every wrong option must be a plausible near-miss failing on a specific SOP detail, all
  options the same length/tone (no longest-answer tell), at least one distractor more
  cautious-sounding than the best answer, two-plus options tempting without SOP knowledge.
  Existing weak questions still need regeneration + curation through the Question Bank.
- **5 Ã‚Â· Navigators couldn't review answers / see history:** new `MyHistory.jsx` + "My history"
  navigator tab. Panel 1: attempt history from `resultHistory` (first navigator-facing read of
  it) Ã¢â‚¬â€ every snapshot for the active dept, newest first, per-domain level chips. Panel 2:
  answer-by-answer review of the latest MCQ from the stored `answers` on the result doc (same
  rendering as post-check Coaching; answers to since-retired questions are skipped with a note).
- **6 Ã‚Â· Welcome page slow to appear:** code-split at both seams. `App.jsx` lazy-loads
  `SupervisorApp`/`NavigatorApp` via `React.lazy` + `Suspense`; `Start.jsx` imports
  `firebase.js`/`db.js` **dynamically** (roster fetch + PIN save) so the Firebase SDK leaves the
  entry chunk. Entry JS: **889 kB Ã¢â€ â€™ 197 kB** (62 kB gzip); Firebase (684 kB) + each role app now
  load as separate lazy chunks. Railway cold-start remains a possible second cause (infra).
- **Verification:** `npm test` Ã¢â€ â€™ **253 passing** (9 files; +3 audit-bank db tests);
  `npm run build` Ã¢â€ â€™ clean, chunks split as above; `node --check` on the 3 edited api handlers.
- **Files:** new `src/components/{AuditBank,MyHistory}.jsx`; edited `api/{interview-turn,
  generate-audit,generate-scenarios}.js`, `src/components/{VoiceCall,Interview,SpotTheError,
  SupervisorApp,NavigatorApp,Nav,Start,App}.jsx`, `src/lib/{db,db.test,apiFetch}.js`,
  `firestore.rules`, `src/styles.css`, `CLAUDE.md`.
- **Status:** Complete (code). Owner actions: deploy rules; generate + activate audit transcripts
  per domain in the new bank; add more Gemini keys; report what the colour-scheme feedback was.

### 2026-07-03 Ã¢â‚¬â€ F24 upgrade: PDF upload, fidelity audit, SOP tab redesign
- **Context:** Owner review of the first SOP manager: "bland and generic", questioned whether
  "Build with AI" can be trusted, and flagged the missing file-upload option. All three addressed
  in one pass (scope approved by owner).
- **PDF upload:** `/api/refine-sop` now accepts `file` (base64 PDF Ã¢â€°Â¤10 MB) as the source for both
  modes, passed to Gemini **natively as a document part** Ã¢â‚¬â€ no text-extraction library, works on
  scanned PDFs. TXT/MD files are read client-side into the paste area; Word gets an
  "export as PDF" hint. `server.js` JSON limit 1mb Ã¢â€ â€™ 20mb. New pure `validateSopFile`.
- **Fidelity audit (the trust answer):** every AI draft now gets a second Gemini pass (temp 0.1)
  comparing the draft against the source: `audit = { omissions[], inventions[] }`. Shown on the
  draft as a chip (Ã¢Å“â€œ passed / Ã¢Å¡Â  N findings) with amber/red detail panels; persisted on the draft
  doc (new `notes`/`changes`/`audit` fields in `saveSopDraft`) so the report survives reload.
  Best-effort Ã¢â‚¬â€ audit failure returns null and never blocks the draft. New pure `validateSopAudit`.
- **Redesign (`SopManager.jsx` + `.sops*`/`.sopdoc*`/`.sop-*` CSS rewritten):** drag-and-drop
  upload zone; active-version hero with pulsing LIVE badge + meta chips; SOP bodies rendered as a
  **parsed document** (ALL-CAPS headings Ã¢â€ â€™ numbered styled sections, rules as marked rows) with
  collapse/fade instead of a grey `<pre>`; drafts/archived as a **version timeline** with status
  dots; spinner status line during AI runs; reduced-motion safe.
- **Verification:** `npm test` Ã¢â€ â€™ **250 passing** (9 files; +12 for the new validators);
  `npm run build` Ã¢â€ â€™ clean; **live smoke test**: posted the real in-repo `SOP Guide.pdf` (115 KB)
  through build mode Ã¢â€ â€™ structured 6-domain SOP + 3 review notes + audit reporting **8 omissions /
  0 inventions** Ã¢â‚¬â€ the audit correctly caught provider-affiliation details the restructuring
  dropped, demonstrating exactly the trust layer the owner asked for.
- **Files affected:** `api/refine-sop.js`, `api/refine-sop.test.js`, `server.js`,
  `src/lib/db.js`, `src/components/SopManager.jsx`, `src/styles.css`, `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-02 Ã¢â‚¬â€ Navigator self-created PINs
- **What changed:** Supervisors now add navigators by name only. A roster row with a blank `pin`
  prompts the navigator to create a 4-digit PIN at the Start gate after choosing their name; that
  PIN is saved back through `updateRosterEntry`. Existing PIN rows still use the old PIN check.
- **Why:** Navigators should be able to create their own passcodes instead of relying on a
  supervisor-assigned code.
- **Tests:** Added component coverage for first-login PIN creation and existing-PIN login, plus a
  `db.js` check that `addToRoster` can create blank-PIN rows.
- **Files affected:** `src/components/Start.jsx`, `src/components/Navigators.jsx`,
  `src/lib/db.js`, `src/components/components.test.jsx`, `src/lib/db.test.js`, `README.md`,
  `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-02 Ã¢â‚¬â€ Welcome page premium redesign
- **What changed:** Reworked the Start gate from generic explanatory copy to a premium first
  screen: product-name hero, concise readiness/capability language, stable summary chips, an
  animated lightweight capability-map preview, stronger role cards, and overflow-safe domain tiles.
- **Why:** The old opening line ("development and fit, not pass/fail") no longer matched how the
  check is being used, and made the page feel generic.
- **Follow-up 2026-07-02:** Removed the variable scenario-count chip, changed the eyebrow to
  "Knowledge & Adaptability", animated the map preview bars, and fixed long domain labels colliding
  with blurbs at tablet/mobile widths.
- **Verification:** `npm test` Ã¢â€ â€™ **238 passing**; `npm run build` Ã¢â€ â€™ clean (existing large-chunk
  warning only).
- **Files affected:** `src/components/Start.jsx`, `src/styles.css`, `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-02 Ã¢â‚¬â€ Firebase deploy manifest for Firestore rules/indexes
- **What changed:** Added root `firebase.json` pointing Firestore deploys at `firestore.rules`
  and `firestore.indexes.json`.
- **Why:** The local rules already allow the new `sops` collection, but the live project still
  needs the pending C1 deploy. Without `firebase.json`, `firebase deploy --only
  firestore:rules,firestore:indexes` may not know which local files to publish from this repo.
- **Verification:** `firebase.cmd deploy --project quarterly-knowledge-check --only
  firestore:rules,firestore:indexes` completed successfully; `node scripts/reset-pilot-data.mjs
  --delete` then completed cleanly on retry (first pass hit a transient `resultHistory`
  permission-denied while rules propagated).
- **Status:** Complete. C1 is active in the live Firebase project.

### 2026-07-02 Ã¢â‚¬â€ F24: SOP Manager (adder / builder / refiner)
- **What changed:** Department SOPs moved from hardcoded strings to live, supervisor-managed,
  versioned Firestore data with AI-assisted authoring. See the F24 feature entry (Ã‚Â§4) for the full
  design. Highlights:
  - New `sops` Firestore collection + `db.js` CRUD (`subscribeSops`, `saveSopDraft`, `updateSop`,
    `activateSop` Ã¢â‚¬â€ batch-archives the previous active version Ã¢â‚¬â€ `archiveSop`, `deleteSop`) +
    `firestore.rules` entry.
  - New `api/_sop-store.js`: the Express server now reads Firestore (first time ever) via the
    firebase web SDK with defensive init and a 60s sync cache, so `sopContextFor()` stays
    synchronous and zero AI-handler call sites changed. Resolution: live active SOP Ã¢â€ â€™ hardcoded
    context Ã¢â€ â€™ Pediatrics.
  - New `POST /api/refine-sop` (build = structure raw document into the 6-domain layout; refine =
    merge new material into the current SOP with typed change flags). `validateSopRefineResponse`
    exported pure; `server.js` JSON limit 100kb Ã¢â€ â€™ 1mb.
  - New supervisor "SOPs" tab (`SopManager.jsx`): active/draft/archived versions, inline confirms,
    import panel (verbatim / Build with AI / Refine), proposal preview with change chips.
- **Verification:** `npm test` Ã¢â€ â€™ **238 passing** (9 files; +10 refine-sop tests); `npm run build`
  Ã¢â€ â€™ clean; `node --check` on all new/edited api files; **live smoke test** against a local server
  + real Gemini keys: 401/400 validation paths, build mode (structured a raw BH guide, flagged the
  thin intake section), refine mode (caught the psych-nurse Ã¢â€ â€™ provider-direct contradiction,
  added the refill-continuity rule, preserved all untouched rules, left crisis routing alone).
- **Known gate:** resolved. The live project now has Anonymous auth enabled and current
  `firestore.rules` + `firestore.indexes.json` deployed (wired by root `firebase.json`).
- **Files affected:** new `api/{_sop-store,refine-sop,refine-sop.test}.js`,
  `src/components/SopManager.jsx`; edited `src/lib/db.js`, `api/_sop-context.js`, `server.js`,
  `firestore.rules`, `firebase.json`, `src/components/{SupervisorApp,Nav}.jsx`, `src/styles.css`,
  `CLAUDE.md`.
- **Status:** Complete.

### 2026-07-02 Ã¢â‚¬â€ Domain redesign: 6 job-aligned Patient Navigator domains (+ pilot data reset)
- **Context:** The owner provided a comprehensive Patient Navigator role description (cross-
  department inbound call handlers: classify Ã¢â€ â€™ route Ã¢â€ â€™ schedule Ã¢â€ â€™ protect scope/privacy Ã¢â€ â€™
  document; Peds/OB-GYN/BH/IM; Intermedia + eCW + Teams). The old 6 domains were pediatric-SOP-
  shaped ("Sites & Routing", "Provider Matching", "Insurance & Eligibility") and didn't match the
  job. Decisions taken with the owner: use 6 new domains (not the 7 capability areas verbatim Ã¢â‚¬â€
  "adaptability under complexity" belongs to the competency axis), reset pilot data, domains
  before the SOP-manager feature.
- **New DOMAINS** (`src/data/questions.js`): `intake` Ã¢â‚¬â€ Call Opening & Identification (dept-
  adaptive lookup: parent-phone-first for Peds, DOB-first for adult depts, family accounts);
  `classification` Ã¢â‚¬â€ Call Classification (scheduling vs clinical question vs refill vs lab vs
  urgent vs wrong-department vs needs-approval); `routing` Ã¢â‚¬â€ Routing & Escalation (TE queues,
  dept sub-routing, soft transfers, urgent paths); `scheduling` Ã¢â‚¬â€ Scheduling & Appointment Rules;
  `boundaries` Ã¢â‚¬â€ Scope & Privacy (no advice/results/promises, caller authorization);
  `documentation` Ã¢â‚¬â€ Documentation & Follow-through (TE destination + fields, reason fields,
  entry conventions). Refills are deliberately NOT a domain Ã¢â‚¬â€ a refill call exercises
  classification + routing + documentation, so it appears as scenario content across domains.
- **Seed banks rewritten:** Pediatrics **21** questions (best old questions re-tagged/re-IDed,
  new ones authored for intake/classification/boundaries/documentation from the role doc Ã¢â‚¬â€ e.g.
  multi-child family calls, refillÃ¢â€ â€™PEDS Encounters queue with HIGH PRIORITY when out, no promised
  approvals, complete refill-TE fields). OB/GYN **16** questions (sanitized as before Ã¢â‚¬â€ role
  labels only) encoding the current floor routing table: pregnant/pregnancy-related Ã¢â€ â€™ **OB
  Portal**, non-pregnant GYN visit issue Ã¢â€ â€™ **PSS OB**, established MFM patient Ã¢â€ â€™ **the MFM
  coordinator**; plus DOB-first lookup and third-party privacy scenarios. Total seed 32 Ã¢â€ â€™ **37**.
- **`src/data/training.js`:** all 6 modules rewritten for the new domains (still flagged mockup).
- **`api/_sop-context.js`:** new exported `NAVIGATOR_ROLE_CONTEXT` (distilled from the role
  description, sanitized: OB names Ã¢â€ â€™ role labels; BH psych-nurse routing treated as outdated per
  the doc Ã¢â‚¬â€ questions/refills go provider-direct). `sopContextFor(deptId)` now prepends it to the
  department SOP, so all 7 AI features ground in the real role model + current routing rules.
- **Pilot data reset** (owner-approved): new `scripts/reset-pilot-data.mjs` (web SDK +
  `.env.local`, dry-run by default, `--delete` to execute, per-collection permission tolerance).
  Deleted live `results` (5) and the old `questions` bank (23). `resultHistory`/`completions`/
  `pairings` were blocked by the then-deployed old rules (unauthenticated access denied) Ã¢â‚¬â€
  *(resolved later the same day: after the C1 activation Ã¢â‚¬â€ see the "Firebase deploy manifest"
  entry above Ã¢â‚¬â€ the script was re-run and all collections cleared).* New bank auto-seeds from
  `ALL_SEED_QUESTIONS` on next app load. Old `interviews` docs keep old domain tags (render as
  raw ids Ã¢â‚¬â€ cosmetic; clear manually if desired).
- **Also:** `stress/quota-probe.mjs` domain list updated. Tests derive from `DOMAINS`
  dynamically, so no test-file changes were needed.
- **Files affected:** `src/data/{questions,questions-obgyn,training}.js`, `api/_sop-context.js`,
  `stress/quota-probe.mjs`, new `scripts/reset-pilot-data.mjs`, `CLAUDE.md`.
- **Verification:** `npm test` Ã¢â€ â€™ **228 passing** (8 files); `npm run build` Ã¢â€ â€™ clean (known
  large-bundle warning); `node --check api/_sop-context.js` Ã¢â€ â€™ OK; reset script dry-run + delete
  executed against the live project.
- **Next (agreed with owner):** SOP manager (adder/builder/refiner) Ã¢â‚¬â€ Firestore `sops`
  collection + supervisor editor UI + AI refine endpoint + DB-backed `sopContextFor`.
- **Status:** Complete.

### 2026-07-01 Ã¢â‚¬â€ Pre-rollout hardening (C1/C4/H1/H2/M1/H3) + stress harness + load results
- **Context:** Readiness audit ahead of a ~20-navigator rollout flagged the privacy/role model as
  UI-only. This pass closes the top items and adds a repeatable stress harness that measures real
  Gemini-quota and concurrency ceilings.
- **C1 Ã¢â‚¬â€ Firebase Anonymous Auth + hardened rules:** `src/lib/firebase.js` now signs every visitor
  in with `signInAnonymously` and exports an `authReady` promise that **never rejects** (a failed
  sign-in logs and resolves `false` so the app keeps working under the current open rules).
  `src/lib/db.js` gates every read/write behind `authReady` (via aliased `fb*` primitives wrapped in
  auth-gated versions Ã¢â‚¬â€ zero call-site churn) and defers every `onSnapshot` behind `authReady` via a
  new `liveQuery()` helper. `firestore.rules` rewritten to require `request.auth != null` on all 9
  collections, with a documented SAFE DEPLOY ORDER (enable Anonymous auth Ã¢â€ â€™ ship app code Ã¢â€ â€™ THEN
  deploy rules). **Honest limit:** anonymous auth has no per-user identity, so this stops anonymous
  internet scraping but not a determined signed-in navigator Ã¢â‚¬â€ real Auth + role claims is still the
  next step. `db.test.js` updated (mock `authReady`; 5 subscription tests made async).
- **C4 Ã¢â‚¬â€ stop broadcasting all results to navigators:** new `getFloorScores()` returns a one-time,
  minimized `{ name, scores }` projection (drops peers' raw `answers`, competency detail,
  navigatorId). `NavigatorApp` uses it instead of the full-collection `subscribeResults` live stream.
  Residual (peers' scores still reach the client for mentor matching) noted for future server-side
  computation.
- **H1 Ã¢â‚¬â€ `firestore.indexes.json`** declaring the `resultHistory (navigatorId, department)`
  composite index `getResultHistory` requires (`firebase deploy --only firestore:indexes`).
- **H2 Ã¢â‚¬â€ visible save-failure + retry:** `NavigatorApp` surfaces a banner instead of swallowing
  `saveResult` failures; `persistResult`/`retrySave` wrap all three save sites (MCQ, Spot, mini-check).
- **M1 Ã¢â‚¬â€ in-progress check persistence:** `Check.jsx` takes a `persistKey`, restoring/saving answers
  + step to `sessionStorage` (survives refresh); cleared on submit/cancel; step clamped to the live
  bank. Wired for the main MCQ check only.
- **H3 Ã¢â‚¬â€ bounded Spot fan-out:** `SpotTheError` full-profile generation runs through a `runPooled`
  limiter (max 2 concurrent `/api/generate-audit`) instead of firing all 6 at once.
- **Stress harness (new `stress/` + `playwright.stress.config.js`):** `stress/quota-probe.mjs`,
  `stress/voice-ws-probe.mjs`, `stress/load.spec.js`. Scripts: `test:stress`, `stress:quota`,
  `stress:voice`. NOTE: Node `fetch`/`ws` must target `127.0.0.1` not `localhost` (undici picks IPv6
  `::1`; the server listens IPv4).
- **Measured ceilings (live keys, 2026-07-01):**
  - **Gemini generateContent rotation:** clean 100% up to **8 concurrent** heavy calls; first
    `429 "All Gemini keys are rate-limited"` at **12 concurrent**; majority-fail by 16Ã¢â‚¬â€œ20 (each heavy
    call ~11Ã¢â‚¬â€œ23s). Ã¢â€¡â€™ with H3 (~2 calls/navigator) ~**4 navigators** can start a full Spot at once;
    coaching (1/navigator) tolerates ~**8 simultaneous** MCQ finishes before falling back to
    rule-based. The MCQ check uses NO AI in its critical path, so it never breaks.
  - **Voice relay (`/api/live`):** 5/5 concurrent sessions reached `ready` with no server errors, but
    only 1/5 delivered caller audio in-window Ã¢â‚¬â€ the Gemini **Live preview** tier is the bottleneck,
    not the relay. Ã¢â€¡â€™ cap concurrent voice calls to a few, or leave off preview.
  - **20 concurrent navigators, full MCQ+coaching:** **20/20 completed end-to-end**, ~126s wall, no
    crashes; AI endpoints degraded gracefully (429/400 Ã¢â€ â€™ fallback). Observed non-blocking console
    signal: `getInterviews: Missing or insufficient permissions` in the LIVE project Ã¢â‚¬â€ reinforces that
    Anonymous auth must be enabled and the new rules deployed together.
- **Gates:** `npm test` Ã¢â€ â€™ **228 passing** (8 files); `npm run build` Ã¢â€ â€™ clean.
- **Files:** `src/lib/{firebase,db,db.test}.js`, `firestore.rules`, new `firestore.indexes.json`,
  `src/components/{NavigatorApp,Check,SpotTheError}.jsx`, new `stress/*` +
  `playwright.stress.config.js`, `package.json`, `CLAUDE.md`.
- **Status:** Code complete + stress-validated. **Owner action to activate C1:** enable Anonymous
  auth in the Firebase console, confirm the deployed app still reads data, THEN
  `firebase deploy --only firestore:rules,firestore:indexes`. *(Completed 2026-07-02 Ã¢â‚¬â€ see the
  "Firebase deploy manifest" entry: Anonymous auth enabled, rules + indexes deployed, verified
  live.)*

### 2026-07-01 Ã¢â‚¬â€ Playwright end-to-end test harness added
- **What changed:** Added Playwright so browser flows can actually be verified locally (the app's
  Firebase/Gemini/Web-Audio paths were previously "not verifiable headlessly").
  - `@playwright/test` dev dependency + Chromium browser installed (browsers live in the user-level
    `ms-playwright` cache, not the repo).
  - `playwright.config.js` Ã¢â‚¬â€ `testDir: './e2e'`, headless Chromium, and a `webServer` that runs
    `npm run build && npm start` and waits on `/api/health` (so tests hit the real Express server +
    `/api` routes + `.env.local`, exactly like Railway). `reuseExistingServer: true`.
  - `e2e/smoke.spec.js` Ã¢â‚¬â€ Start gate renders + wrong supervisor passcode is rejected.
  - `e2e/supervisor.spec.js` Ã¢â‚¬â€ signs in with the public pilot passcode (`0200`) and confirms the
    management shell loads, exercising the **live Firebase subscriptions** end to end.
  - `e2e/navigator.spec.js` Ã¢â‚¬â€ signs in as a real test navigator (roster name + PIN), reaches the
    MCQ/Spot chooser, completes an MCQ end to end (Ã¢â€ â€™ coaching Ã¢â€ â€™ dashboard), and Ã¢â‚¬â€ the headline
    coverage Ã¢â‚¬â€ **takes a full live-Gemini Spot the Error assessment, then an MCQ, and asserts both
    results coexist and the dashboard toggle switches between them**. This is the browser proof of the
    "MCQ + Spot coexist" feature.
  - `vite.config.js` Ã¢â‚¬â€ Vitest `include` pinned to `src/**` + `api/**` so it ignores `e2e/` (which
    uses `@playwright/test`, not Vitest). `npm run test:e2e` runs the Playwright suite.
  - `.gitignore` Ã¢â‚¬â€ Playwright artifacts (`test-results/`, `playwright-report/`, Ã¢â‚¬Â¦).
- **Gates now:** `npm test` (228 Vitest unit) Ã‚Â· `npm run test:e2e` (6 Playwright e2e) Ã‚Â· `npm run build`.
- **Note:** the navigator specs write to live Firestore and the Spot journey calls live Gemini, so
  they need `.env.local` (Firebase + `GEMINI_API_KEYS`). The navigator credential is a pre-deploy
  test account; the supervisor passcode is the public pilot one. Swap both before any real rollout.
- **Files affected:** new `playwright.config.js`, `e2e/{smoke,supervisor,navigator}.spec.js`; edited
  `package.json`, `vite.config.js`, `.gitignore`, `CLAUDE.md`.
- **Verification:** `npm run test:e2e` Ã¢â€ â€™ **6 passed** (incl. the live take-both-and-switch journey);
  `npm test` Ã¢â€ â€™ **228 passed** (unchanged).
- **Status:** Complete.

### 2026-07-01 Ã¢â‚¬â€ MCQ + Spot the Error results coexist (take/switch either)
- **What changed:** A navigator can now hold **both** an MCQ result and a Spot the Error result per
  department, take the other type after finishing one, and switch which one their dashboard reflects
  Ã¢â‚¬â€ instead of the second overwriting the first (owner request: "keep both separately", entry point
  on the dashboard).
  - **Storage (`db.js`):** result docs are now keyed by assessment type Ã¢â‚¬â€ MCQ keeps the legacy
    `${navigatorId}__${department}` key (full back-compat); Spot the Error uses
    `${navigatorId}__${department}__spot`. New `resultDocId()` helper; `getResult` and `saveResult`
    take an `assessmentType` param (`'mcq'` default) and stamp `assessmentType` on the doc + history
    snapshot; `clearResult` now deletes both docs (+ the legacy plain-id doc for pediatrics).
  - **Navigator (`NavigatorApp.jsx`):** single `ownResult` state replaced by `resultsByType`
    `{ mcq, spot }` + `activeType`; `ownResult` is derived. `handleDeptSelect` loads both types and
    defaults the view to the most recent. New `AssessmentBar` on the dashboard: a **MCQ Ã¢â€¡â€ž Spot
    toggle** (when both exist) + a **"Take the other / Retake"** button Ã¢â€ â€™ the chooser. `handleSubmit`
    writes `mcq`; `handleSpotComplete` writes `spot` in full mode and merges into the **active** type
    in training mode; the mini-check likewise re-saves the active type. The chooser badges which types
    are already completed.
  - **Supervisor (`SupervisorApp.jsx`):** `subscribeResults` now returns up to two docs per
    navigator+department, so results are **deduped to the most recent** per navigator+department
    before building the matrix / cross-dept strip Ã¢â‚¬â€ the matrix still shows one current row per person.
  - **Tests:** `db.test.js` `clearResult` cases updated for dual-doc deletion (228 passing).
- **Known limitation:** `resultHistory` now interleaves MCQ and Spot snapshots, so trend lines mix
  both assessment types (not filtered by type yet). Acceptable for the pilot.
- **Files affected:** `src/lib/{db,db.test}.js`, `src/components/{NavigatorApp,SupervisorApp}.jsx`,
  `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` Ã¢â€ â€™ **228 passing** (8 files); `npm run build` Ã¢â€ â€™ clean. Browser
  click-through (take both, toggle, supervisor dedup) not run headlessly.
- **Status:** Complete.

### 2026-07-01 Ã¢â‚¬â€ Ponytail installed for Codex usage reduction (local only Ã¢â‚¬â€ NOT an app change)
- **What changed:** Installed `DietrichGebert/ponytail` for the repo owner's Codex environment to
  bias future agent work toward smaller, reused, stdlib/native-first changes. Because `git` is not
  available on this Windows PATH, the repo was downloaded as a GitHub zip to
  `~/.codex/marketplaces/ponytail-main`, registered as a local Codex marketplace, and installed as
  `ponytail@ponytail` version `4.8.4`.
  - **Mode:** `full` was initialized via Ponytail's activation hook, which emitted `PONYTAIL:FULL`
    and wrote the plugin data mode flag.
  - **Important:** This is user-level Codex tooling only. It changes how future agents choose
    implementations; it does not change the app, its runtime, or deploy output.
- **Files affected:** `CLAUDE.md` only.
- **Status:** Complete.

### 2026-07-01 Ã¢â‚¬â€ Assessment-type chooser: MCQ vs. full-profile Spot the Error
- **What changed:** Added a top-level choice of assessment. After a navigator picks a department,
  a new `typeselect` view (`AssessmentTypeChooser` in `NavigatorApp.jsx`) offers **Multiple choice**
  (the existing MCQ `check`) or **Spot the Error** (a new full-profile assessment, view `spotfull`).
  Both feed the capability matrix.
  - `SpotTheError.jsx` generalised to two modes via `domains` (array) + `mode` props:
    **`full`** = one item per domain across all 6 (backfills a failed-gen domain to 0 for a complete
    profile); **`domain`** = the existing `SPOT_ASSESSMENT_SIZE`-item single-domain training launch.
    Each item now carries its own `domainId` (shown as a tag); the review adds a per-domain breakdown
    in full mode. `onComplete` now hands back a `{ domainId: percent }` map + the mode.
  - `scoring.js` Ã¢â‚¬â€ new pure `scoreSpotTheErrorByDomain(graded)` (`[{domainId,correct}]` Ã¢â€ â€™
    `{domainId: percent}`); 2 tests added (`scoring.test.js`, 226 Ã¢â€ â€™ 228).
  - `NavigatorApp.jsx` Ã¢â‚¬â€ `handleAuditComplete(domainId, score)` replaced by
    `handleSpotComplete(domainScores, mode)`: full Ã¢â€ â€™ replace the whole profile and land on the
    dashboard; domain Ã¢â€ â€™ merge just that domain and return to training. `handleDeptSelect`'s no-result
    branch now routes to `typeselect` (was `check`); the MCQ `check` cancel returns to `typeselect`;
    the dept switcher is hidden during `spotfull` (as it already was during `check`).
  - `styles.css` Ã¢â‚¬â€ per-domain breakdown rows on the results screen.
- **Design choices (with owner):** full-profile covers **all domains, 1 item each** (fast, coarse
  0/100 per domain); chooser sits **after** department selection.
- **Files affected:** `src/lib/{scoring,scoring.test}.js`, `src/components/{SpotTheError,NavigatorApp}.jsx`,
  `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` Ã¢â€ â€™ **228 passing** (8 files); `npm run build` Ã¢â€ â€™ clean (known large
  main-bundle warning only). Browser click-through against live Gemini keys not run headlessly.
- **Status:** Complete.

### 2026-07-01 Ã¢â‚¬â€ F16 "Spot the Error" Ã¢â€ â€™ scored, matrix-feeding assessment
- **What changed:** Converted "Spot the Error" from advisory-only training into a real, scored
  assessment whose result feeds the per-domain capability rating (owner request). Design decisions
  taken with the owner: **feed the domain score**, **multiple items** (`SPOT_ASSESSMENT_SIZE = 5`),
  **click-accuracy scoring only** (no AI grading).
  - `src/lib/scoring.js` Ã¢â‚¬â€ new pure `scoreSpotTheError(picks)` Ã¢â€ â€™ share of items found correctly
    (0Ã¢â‚¬â€œ100), on the same scale as the main check. 3 tests added (`scoring.test.js`, 223 Ã¢â€ â€™ 226).
  - `src/data/config.js` Ã¢â‚¬â€ `SPOT_ASSESSMENT_SIZE = 5`.
  - `src/components/SpotTheError.jsx` Ã¢â‚¬â€ rewritten as an item-by-item assessment: `loading` (fires
    N `/api/generate-audit` calls in parallel via `Promise.allSettled`, keeps what succeeds) Ã¢â€ â€™
    `active` (one click per item, correct/wrong reveal + Next) Ã¢â€ â€™ `review` (score + level badge +
    per-item breakdown) Ã¢â€ â€™ `saving` Ã¢â€ â€™ `done`. Removed the hint/shake, the reflection textarea, and
    the AI-coaching step (those were training affordances). No longer calls `saveCompletion`
    itself Ã¢â‚¬â€ the parent orchestrates the save.
  - `src/components/NavigatorApp.jsx` Ã¢â‚¬â€ `handleAuditComplete(domainId, score)` is now async and
    merge-saves the domain score into the result doc (overwrites only that domain, preserves
    competency scores + answers, appends a `resultHistory` trend point) and records a
    `kind:'practice'` completion Ã¢â‚¬â€ mirroring the mini-check merge pattern. Updates local `ownResult`/
    `allDeptResults` immediately so the dashboard/matrix reflect the new rating without a round-trip.
  - `src/styles.css` Ã¢â‚¬â€ assessment styles (progress pill, wrong-pick red reveal, per-item feedback,
    results scorecard with level-coloured score, per-item review list).
- **Not touched but now dead:** `api/coach-audit.js` + the `POST /api/coach-audit` route are no
  longer wired (reflection step removed). Left in place; flagged in F16 notes.
- **Files affected:** `src/lib/{scoring,scoring.test}.js`, `src/data/config.js`,
  `src/components/{SpotTheError,NavigatorApp}.jsx`, `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` Ã¢â€ â€™ **226 passing** (8 test files); `npm run build` Ã¢â€ â€™ clean (known
  large main-bundle warning only). Browser click-through of the assessment flow not run headlessly.
- **Status:** Complete.

### 2026-07-01 Ã¢â‚¬â€ Learning Loop: trim inline feedback chips to signal-only
- **What changed:** `FeedbackControls` (the inline chips on adaptive next steps, question
  improvement signals, flagged questions, and supervisor-visible interview grades) no longer renders
  **Approve** / **Reject**. It now shows only **Helpful / Inaccurate / Adjust**. Approve/Reject were
  ambiguous inline Ã¢â‚¬â€ they only logged a `supervisorFeedback` status string and did nothing
  actionable, yet visually implied they approved the recommendation. Those two actions belong solely
  to proposals in the Learning Loop **Human review queue**, where Approve actually creates a draft
  question and advances the proposal. `feedbackInsights` still treats `approved` as a positive status
  (tolerates any legacy docs); no scoring/feedback-math change.
- **Files affected:** `src/components/FeedbackControls.jsx`, `CLAUDE.md`.
- **Verification:** `npm test` Ã¢â€ â€™ **223 passing** (8 test files); `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-07-01 Ã¢â‚¬â€ Learning Loop click feedback UX fix
- **What changed:** Feedback and proposal buttons in the Learning Loop now show visible state instead
  of failing silently. `FeedbackControls` displays `Saving...`, then `Saved`, or `Could not save`.
  `LearningLoop` and `QuestionBank` show queued/approved/rejected status messages and surface Firestore
  save errors so local misconfiguration or network issues are obvious.
- **Why:** In localhost testing, clicking Helpful/Inaccurate/Queue Proposal appeared to do nothing
  because the original implementation wrote to Firestore without any success or error affordance.
- **Files affected:** `src/components/{FeedbackControls,LearningLoop,QuestionBank}.jsx`,
  `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` Ã¢â€ â€™ **223 passing** (8 test files); `npm run build` Ã¢â€ â€™ clean with the
  known large main-bundle warning.
- **Status:** Complete.

### 2026-07-01 Ã¢â‚¬â€ Learning Loop dead recomputation cleanup
- **What changed:** Removed an unused `computeQuestionHealth(questions, results)` call inside
  `buildLearningSignals()`. Question health is still computed by `buildQuestionImprovementSuggestions()`;
  this only removes redundant work from the Learning Loop render path.
- **Files affected:** `src/lib/scoring.js`, `CLAUDE.md`.
- **Verification:** `npm test` Ã¢â€ â€™ **223 passing** (8 test files).
- **Status:** Complete.

### 2026-07-01 Ã¢â‚¬â€ Adaptive learning feedback loop (controlled intelligence layer)
- **What changed:** Added a controlled, human-reviewed learning loop that uses stored data to produce
  explainable recommendations and improvement proposals without silently changing production logic.
  - `src/lib/scoring.js`: new pure helpers `buildLearningSignals`, `buildQuestionImprovementSuggestions`,
    `adaptiveTrainingRecommendations`, and `feedbackInsights`. They analyze result history, current
    answers, question health, completions, interviews, and supervisor feedback, returning ranked
    evidence and reasons only.
  - `src/lib/db.js` + `firestore.rules`: added `supervisorFeedback` and `learningProposals`
    collections. Feedback records store target type/id, status, note/context, and timestamp.
    Proposals store type/title/target/payload/reasons/status and require supervisor review.
  - New UI: `LearningLoop.jsx` supervisor tab plus `FeedbackControls.jsx`. Supervisors can review
    adaptive next steps, queue training/question proposals, mark advisory output helpful/inaccurate/
    needs-adjustment/approved/rejected, and approve or reject pending proposals.
  - Question improvement loop: flagged question-health signals can be queued as revision proposals;
    approving a question proposal creates a draft question only (`source: 'learning-loop'`), preserving
    the existing activation gate.
  - AI prompt improvement: `generate-coaching` and `sequence-path` accept optional learning evidence
    (prior results, completions, interviews, feedback summaries) so advisory coaching/path rationales
    can become more specific over time.
- **Files affected:** `src/lib/{scoring,scoring.test,db,db.test}.js`, `firestore.rules`,
  `api/{generate-coaching,sequence-path}.js`, `src/components/{LearningLoop,FeedbackControls,
  SupervisorApp,Nav,QuestionBank,NavigatorDetail,Coaching,MyTraining}.jsx`, `src/styles.css`,
  `CLAUDE.md`.
- **Verification:** `npm test` Ã¢â€ â€™ **223 passing** (8 test files); `node --check` on
  `api/generate-coaching.js` and `api/sequence-path.js`; `npm run build` Ã¢â€ â€™ clean with the known
  large main-bundle warning.
- **Status:** Complete.

### 2026-07-01 Ã¢â‚¬â€ Doc consistency fix (stale department references)
- **What changed:** Corrected two stale lines in this CLAUDE.md and de-duplicated the global file.
  - Ã‚Â§14 "Common pitfalls" said *"the live check only assesses Pediatrics (`ASSESSED_DEPT`)"* Ã¢â‚¬â€ now
    correctly states **Pediatrics and OB/GYN** are assessed (`ASSESSED_DEPTS` / `isAssessed(id)`),
    consistent with F10 and Ã‚Â§8.
  - Ã‚Â§9 data-modules list undersold `src/data/departments.js` (`DEPARTMENTS`, `ASSESSED_DEPT`) Ã¢â‚¬â€ now
    lists the real exports (`ASSESSED_DEPTS`, `DEFAULT_DEPT`, `isAssessed`, `departmentName`, with
    `ASSESSED_DEPT` as a back-compat alias), verified against the source.
  - The user-global `C:\Users\t.1223\CLAUDE.md` held a full stale copy of this project's knowledge
    base (2026-06-24: "Quarterly Knowledge Check", GitHub Pages, Pediatrics-only, 38 tests, Firebase
    "in design"), which injected contradictory context every session. Replaced with a short pointer
    to this authoritative file.
- **Files affected:** `CLAUDE.md` (Ã‚Â§9, Ã‚Â§14, this entry); `C:\Users\t.1223\CLAUDE.md` (global Ã¢â‚¬â€ now a pointer).
- **Verification:** exports confirmed via grep of `src/data/departments.js`; docs-only change (no code touched).
- **Status:** Complete.

### 2026-06-30 Ã¢â‚¬â€ Local Codespace migration bundle guide
- **What changed:** Added a local migration guide and bundle script for moving the full Codespace
  state to a local machine before Codespace quota expires. The guide explicitly calls out the
  important ignored/local files that are not recoverable from GitHub alone: `.env.local`,
  `roo-code-settings.json`, `OB GYN SOP.pdf`, `Pediatrics_SOP_Updated.pdf`, in-repo `.claude/`, and
  user-level `/home/codespace/.claude` + `/home/codespace/.codex` state. The script writes private
  timestamped tarballs under `migration-bundles/`, includes `.git` and ignored local files, excludes
  regenerable `node_modules`, emits a manifest plus SHA-256 checksums, and ignores bundle output in
  `.gitignore` so private archives are not committed by accident.
- **Files affected:** new `LOCAL_MIGRATION.md`, new `scripts/create-migration-bundles.sh`,
  `.gitignore`, `CLAUDE.md`.
- **Verification:** `bash -n scripts/create-migration-bundles.sh`.
- **Status:** Complete.

### 2026-06-30 Ã¢â‚¬â€ Live voice call freshness pass: opener, department, transcript quality
- **What changed:** The real-time voice call now carries the generated `openingLine` from
  `/api/interview-turn` into the `/api/live` WebSocket start payload, and the relay includes it in
  the Gemini Live system instruction. `buildSystemInstruction()` is now department-aware, so OB/GYN
  voice calls no longer inherit the old pediatric-hardcoded caller context. `VoiceCall.jsx` also
  normalizes streaming transcription fragments before showing captions or saving/grading the call,
  avoiding glued-together words from raw Live API transcript chunks.
- **Why:** The call could feel stale because the init endpoint generated a fresh opener that the
  Live session ignored, forcing Gemini to invent a second opener from colder context. Department
  hardcoding also made non-pediatric calls feel less current. Cleaner transcript assembly improves
  both live captions and the transcript sent to grading.
- **Files affected:** `api/interview-turn.js`, `api/live-relay.js`, `src/components/VoiceCall.jsx`,
  `api/api-handlers.test.js`, `CLAUDE.md`.
- **Verification:** `node --check api/interview-turn.js`; `node --check api/live-relay.js`;
  `npm test` Ã¢â€ â€™ **210 passing** (8 test files). Browser mic/playback still needs Chrome/Edge
  confirmation because Web Audio capture is not verifiable in the headless codespace.
- **Status:** Complete.

### 2026-06-30 Ã¢â‚¬â€ Add Codex bootstrap file for new-chat context
- **What changed:** Added a tracked root `AGENTS.md` that tells new Codex sessions to read
  `CLAUDE.md` first, treat it as the project source of truth, inspect relevant live files before
  editing, preserve the main architecture boundaries, and update `CLAUDE.md` with any project
  change. Removed `AGENTS.md` from `.gitignore` so this bootstrap travels with the repo instead of
  being a fragile local-only file.
- **Why:** New chats do not automatically inherit conversation memory. A Codex-native bootstrap
  file gives each fresh session a reliable first instruction without duplicating the full project
  knowledge base.
- **Files affected:** `AGENTS.md`, `.gitignore`, `CLAUDE.md`.
- **Verification:** Docs/bootstrap-only change; no runtime tests needed.
- **Status:** Complete.

### 2026-06-30 Ã¢â‚¬â€ Fix: dev-path/action-center contract bugs + stale README claims
- **What changed:** Fixed several follow-on issues discovered during a full repo orientation pass:
  - `api/sequence-path.js` had its `validateSecret` guard inverted, so valid "Personalize my path"
    calls returned before responding. The handler now matches the other Gemini endpoints.
  - Adaptive paths now treat `interview` as a supported AI-sequenced step kind end to end:
    `validateSequenceResponse`, the Gemini prompt, `MyTraining.jsx` labels/actions, and navigator
    evidence loading all know about practice-call steps.
  - Mini-check completions no longer count as Spot-the-Error practice completions. Passed
    mini-check result saves preserve/merge existing answer and competency context instead of
    replacing competency scores with a 4-question subset.
  - `buildActionCenter` now returns the fields its UI renders (`score`, `interviewId`,
    `canTeachCount`) and only treats practice completions as clearing required practice training.
  - `NavigatorDetail` now passes real completion records into `trainingImpact` and `buildDossier`.
  - Replaced undefined `var(--border)` CSS references with the existing `--line` token.
  - Updated `README.md` to reflect Railway + Express API, current AI endpoints, and Pediatrics +
    OB/GYN live-check scope instead of the older Vercel/Pediatrics-only description.
- **Files affected:** `api/sequence-path.js`, `api/sequence-path.test.js`, `api/_auth.js`,
  `src/lib/{scoring,scoring.test}.js`, `src/components/{ActionCenter,MyTraining,NavigatorApp,NavigatorDetail,SupervisorApp}.jsx`,
  `src/styles.css`, `README.md`, `CLAUDE.md`.
- **Verification:** `npm test` Ã¢â€ â€™ **208 passing** (8 test files); `npm run build` Ã¢â€ â€™ clean with the
  known large main-bundle warning (~891 kB minified JS).
- **Status:** Complete.

### 2026-06-30 Ã¢â‚¬â€ Fix: voice call dropped on first mic frame (deprecated `mediaChunks` format)
- **What changed:** With audio finally flowing (after the suspended-AudioContext fix), the Gemini
  Live session closed the instant the first mic frame arrived: `code 1007 Ã¢â‚¬â€ realtime_input.
  media_chunks is deprecated. Use audio, video, or text instead.` The relay was forwarding mic
  audio as `realtimeInput: { mediaChunks: [{mimeType, data}] }`, which newer Live models
  (`gemini-3.1-flash-live-preview`) reject. Changed to the current single-Blob form
  `realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data } }` in `api/live-relay.js`.
  This also explains the earlier "no caller audio": the session died right after `ready`, before
  the opening line could stream back.
- **How it was found:** added server-side `[live-relay]` logs + an on-screen "caller audio chunks"
  counter and live captions in `VoiceCall.jsx`; the relay log showed the exact 1007 close reason.
  (Also surfaced an operational gotcha: a stale `npm start` left port 3000 bound, so later
  `npm start`s hit `EADDRINUSE` and the browser kept hitting old code Ã¢â‚¬â€ kill with `pkill -f server.js`.)
- **Verification:** new headless test (`relay-audio-test.mjs`, PORT 3100) sends mic frames through
  the relay after `ready` Ã¢â‚¬â€ session now **survives** and streams **182KB** of caller audio +
  transcript back (previously closed 1007 with 0 audio). `npm test` Ã¢â€ â€™ 206; `node --check` OK.
- **Files affected:** `api/live-relay.js` (format fix), `src/components/VoiceCall.jsx` (live
  captions), `src/styles.css`. **Owner confirmed working in Chrome** (full call: heard the caller,
  spoke back, saw captions). The temporary diagnostics (on-screen chunk counter, per-frame
  console logs) were removed in the same pass Ã¢â‚¬â€ kept the lifecycle/error logs in `live-relay.js`
  (connect/disconnect/upstream-closed) since those are useful ops signal in Railway logs, and kept
  live captions in `VoiceCall.jsx` as real UX, not just a diagnostic.
- **Status:** Complete. Real-time voice practice call works end to end.

### 2026-06-30 Ã¢â‚¬â€ Fix: voice call connected but mic/audio were silent (suspended AudioContext)
- **What changed:** After the previous env-loading fix, the voice call reached the active screen
  but produced no audio either direction Ã¢â‚¬â€ mic didn't engage, no caller audio played. Root cause:
  `VoiceCall.jsx` created both `AudioContext`s (`inCtx`/`outCtx`) **after** awaiting a network
  round-trip (scenario generation) and the mic permission prompt. By that point Chrome's autoplay
  policy had very likely started both contexts in `'suspended'` state Ã¢â‚¬â€ and a suspended context
  renders **no** audio at all: `ScriptProcessorNode.onaudioprocess` never fires (mic never sends),
  and scheduled `AudioBufferSource`s for caller playback just sit queued (silence). Neither
  direction logs an error; it just does nothing, which matches exactly what was reported.
- **Fix:** explicit `await Promise.all([inCtx.resume(), outCtx.resume()])` immediately after
  creating the contexts in `startCall()`. `resume()` still succeeds here because it's running
  inside the same gesture chain as the "Start voice call" click (promise/async chains without a
  `setTimeout` don't break Chrome's transient-activation window for `resume()`, even though the
  *initial* suspended-or-not state was already decided unfavorably). Added a guard: if either
  context still isn't `'running'` after resume, show "Audio is blocked by the browser Ã¢â‚¬â€ click
  again" and return to setup, rather than silently failing a second time.
- **Files affected:** `src/components/VoiceCall.jsx`.
- **Verification:** `npm test` Ã¢â€ â€™ 206 passing; `npm run build` Ã¢â€ â€™ clean. **Not browser-verified** Ã¢â‚¬â€
  audio-context suspend/resume behavior can't be exercised in the headless codespace; needs an
  owner test in Chrome/Edge to confirm mic + playback now work.
- **Status:** Complete (code); awaiting browser confirmation.

### 2026-06-30 Ã¢â‚¬â€ F22: Real-time voice practice call (Gemini Live API) Ã¢â‚¬â€ replaced the TTS first attempt
- **Context:** An earlier attempt this session bolted one-shot Gemini TTS (`/api/speak`) + browser
  Web-Speech STT onto the chat `Interview.jsx`. It felt glitchy (auto-send on pauses, caller text
  appearing before its audio, no call rhythm). Owner flagged that chat + voice in one UI was the
  wrong call. That attempt was **fully reverted** (`git checkout` of `Interview.jsx`/`server.js`;
  `api/speak.js` + `src/lib/pcmAudio.js` + its test deleted) and rebuilt on the Live API.
- **What changed:** New real-time voice call as its own screen, with a chooser separating it from
  the text chat.
  - **`api/live-relay.js` (new):** `ws` `WebSocketServer` at `/api/live`, attached to the Express
    http server via `attachLiveRelay(server)` in `server.js`. Relays browser Ã¢â€¡â€ž Gemini Live
    (`BidiGenerateContent` WSS) so the key stays server-side. Builds the patient persona with
    `buildSystemInstruction()` (reused from `interview-turn.js`), validates the secret with the new
    `isValidSecret()` helper in `_auth.js`, model
    `gemini-3.1-flash-live-preview`, with input+output transcription enabled.
    Small JSON protocol (`start`/`audio`/`ready`/`transcript`/`interrupted`/`turnComplete`/`error`).
  - **`src/components/VoiceCall.jsx` (new):** mic capture (`getUserMedia` Ã¢â€ â€™ `ScriptProcessorNode`
    Ã¢â€ â€™ downsample 16kHz PCM16 Ã¢â€ â€™ relay), gapless 24kHz playback via scheduled `AudioBufferSource`s,
    barge-in flush on `interrupted`, speaking/listening orb, end Ã¢â€ â€™ `saveInterview` Ã¢â€ â€™
    `/api/grade-interview` Ã¢â€ â€™ same reviewed screen as the chat call.
  - **`src/components/NavigatorApp.jsx`:** `PracticeChooser` (voice vs chat) + `practiceMode` state
    routing the Practice tab to `<VoiceCall>` or `<Interview>`; resets on leaving the tab via a
    `useEffect` placed **with the other hooks above the early returns** (a first cut put it after
    the `deptselect`/`loading` early returns, which violated the Rules of Hooks Ã¢â‚¬â€ clicking a
    department changed the hook count between renders and blanked the page; fixed by hoisting it).
  - **`src/styles.css`:** `.practice-choice*` cards + `.voicecall*` orb/pulse (reduced-motion safe).
  - **`package.json`:** `ws` added.
  - **Local-dev env fix (`load-env.js`):** `node server.js` never loaded `.env.local` (only Vite
    did, for build-time `VITE_*`), so a plain local `npm start` ran with **no `GEMINI_API_KEYS`** Ã¢â€ â€™
    every `/api/*` AI call 500'd "not configured" Ã¢â€ â€™ the voice/chat call showed "Could not set up
    the call scenario." New `load-env.js` (imported first by `server.js`) calls native
    `process.loadEnvFile('.env.local')` when present Ã¢â‚¬â€ no-op on Railway (vars injected, file
    absent) and on Node < 20.12 (guarded). Reminder: `/api` (incl. the `/api/live` WS) only runs
    under `npm start`/Railway Ã¢â‚¬â€ **not** `npm run dev` (Vite, no proxy configured).
- **Model note:** initially built on `gemini-2.5-flash-native-audio-preview-09-2025`, then
  switched to **`gemini-3.1-flash-live-preview`** (gemini-3 Live) after a `listModels` check showed
  it available + a setup handshake confirmed it. `gemini-3.5-flash` was raised as a candidate but
  it's text-only (no `bidiGenerateContent`) so it can't drive the voice call; it was also 503-ing
  ("high demand") on the free tier at the time, a reason the REST `MODEL` stayed on `gemini-2.5-flash`.
- **Verification:** `npm test` Ã¢â€ â€™ **206 passing** (8 test files Ã¢â‚¬â€ back to pre-attempt count after
  removing `pcmAudio.test.js`); `npm run build` Ã¢â€ â€™ clean; `node --check api/live-relay.js`,
  `server.js` Ã¢â€ â€™ OK. **Live API verified before and after building:** (1) `listModels` Ã¢â‚¬â€ enumerated
  the `bidiGenerateContent` models on the key; (2) full-turn probe Ã¢â‚¬â€ setup Ã¢â€ â€™ text prompt Ã¢â€ â€™ 163KB
  audio + output transcript; (3) **relay round-trip** on the final gemini-3 Live model Ã¢â‚¬â€ node
  client Ã¢â€ â€™ our `/api/live` relay Ã¢â€ â€™ Gemini Ã¢â€ â€™ `ready` + 250KB caller audio + transcript, key never
  leaving the server. In-browser mic capture/playback is **not** verifiable in the headless
  codespace and must be tested in Chrome/Edge.
- **Status:** Complete. Server relay live-verified; **owner confirmed working end-to-end in
  Chrome** (mic, caller voice, captions) after two follow-on fixes Ã¢â‚¬â€ see the two 2026-06-30
  history entries above this one (suspended `AudioContext` + deprecated `realtimeInput.mediaChunks`
  format).

### 2026-06-30 Ã¢â‚¬â€ Fix: "Personalize my path" button did nothing (instant-abort bug)
- **What changed:** `MyTraining.jsx` called `apiFetch('/api/sequence-path', {...})` with no
  `timeoutMs` argument. `apiFetch` did `setTimeout(() => controller.abort(), undefined)`, and a
  `setTimeout` with an `undefined` delay fires on the next tick (treated as 0 ms) Ã¢â‚¬â€ so the
  `AbortController` aborted the fetch before it could complete. The `AbortError` was swallowed by
  the silent `catch` in `handlePersonalize`, so the button just reset and nothing visible happened.
  Two fixes: (1) pass a 25 s timeout at the call site (matches the other Gemini-backed callers);
  (2) root-cause guard Ã¢â‚¬â€ `apiFetch`'s `timeoutMs` now defaults to `30_000`, so any future caller
  that omits it gets a sane timeout instead of an instant abort.
- **Files affected:** `src/components/MyTraining.jsx`, `src/lib/apiFetch.js`, `CLAUDE.md`.
- **Verification:** `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-06-30 Ã¢â‚¬â€ Added ARCHITECTURE.md (maintenance/panic guide Ã¢â‚¬â€ docs only)
- **What changed:** New top-level `ARCHITECTURE.md` written for the "something is down in 6 months
  and I need to know where to look" moment. Plain-language, non-exhaustive, aimed at a non-expert
  maintainer. Sections: (1) what the app does, (2) the stack, (3) 3 end-to-end data flows
  (take-the-check, supervisor dashboard, AI feature), (4) **the seams** Ã¢â‚¬â€ the 5 connection points
  that actually break (browserÃ¢â€ â€™Firestore, browserÃ¢â€ â€™Railway `/api`, serverÃ¢â€ â€™Gemini, Railway hosting,
  the fake PIN/passcode auth boundary), each with "what failure looks like" + "what to check first",
  (5) a load-bearing-vs-peripheral file map, (6) a literal down-the-checklist debug + rollback guide,
  (7) an honest "risky smells" list (fake auth + open Firestore rules, browser-talks-to-DB-directly,
  SOP PDFs, 21-feature scope creep, no CI). Read-only documentation pass Ã¢â‚¬â€ **no `src/`, `api/`,
  config, or build file was touched.**
- **Files affected:** new `ARCHITECTURE.md`; `CLAUDE.md` (this entry).
- **Verification:** N/A (docs only; grounded in a direct read of `server.js`, `src/lib/{db,firebase,
  apiFetch,session}.js`, `src/data/config.js`, `api/_gemini-client.js`, `api/_auth.js`,
  `api/generate-coaching.js`, `src/components/{Start,App}.jsx`, `firestore.rules`, and the role-app
  subscription wiring Ã¢â‚¬â€ not assumptions).
- **Status:** Complete.

### 2026-06-30 Ã¢â‚¬â€ Drop the branch/PR ceremony (main-first workflow)
- **What changed:** Removed the feature-branch enforcement from the in-repo SAW harness. This is a
  solo project with no CI and Railway auto-deploy on push to `main`, so the branch Ã¢â€ â€™ PR Ã¢â€ â€™ self-merge
  loop was pure ceremony Ã¢â‚¬â€ every PR was reviewed by no one and merged seconds later. Work now commits
  straight to `main`.
  - `.claude/settings.json` Ã¢â‚¬â€ removed three hooks: the "you're on main" UserPromptSubmit warning, the
    "block push to main" PreToolUse blocker, and the "/pre-pr before gh pr create" reminder. **Kept**
    the commit-format reminder and the block-push-with-uncommitted-changes guard (cheap insurance,
    not branch ceremony).
  - `CLAUDE.md` Ã‚Â§14 Ã¢â‚¬â€ harness bullet rewritten to describe the main-first flow; the `/start-work`,
    `/pre-pr`, `/end-work` slash commands still exist but are optional (they don't fire on their own).
    Ã‚Â§14 "Required workflows" already described committing + pushing to `main` directly, so it's now
    consistent rather than contradicted by the hooks.
- **Rationale:** A branch only earns its keep when something gates the merge (a reviewer or CI). With
  neither, branches added 4 steps around a 1-step push. If `npm test` ever runs as a GitHub Actions
  check on PRs, revisit Ã¢â‚¬â€ at that point the PR gate becomes worth the ceremony.
- **Files affected:** `.claude/settings.json`, `CLAUDE.md`.
- **Status:** Complete.

### 2026-06-29 Ã¢â‚¬â€ F17Ã¢â‚¬â€œF21: Longitudinal trends, dossier, action center, adaptive dev paths, mentor matching
- **What changed:** Five new capability-platform features turning Knowledge Check into the standing
  quarterly instrument described in the vision. All builds are complete; no mockup stubs.
  - **F17 Ã¢â‚¬â€ Longitudinal trends:** new `resultHistory` Firestore collection (append-only snapshot
    on every `saveResult`); `buildTrend`, `trainingImpact`, `teamTrend` pure functions; `Sparkline.jsx`
    (inline SVG, no dep); trend panel in `NavigatorDetail` (per-domain sparklines + delta badges,
    lazy-fetched on mount); team-trend widget in `Overview` (floor solidPlusRate + avgReadiness);
    `subscribeResultHistory` live subscription wired into `SupervisorApp`.
  - **F18 Ã¢â‚¬â€ Evidence dossier:** `buildDossier` maps each answered question to its competency,
    recording what was chosen vs best answer + rationale; competency cards in `NavigatorDetail` are
    now expandable; `answers` + `questions` threaded from both role apps.
  - **F19 Ã¢â‚¬â€ Action center:** `buildActionCenter` produces 5 category arrays (critical gaps, training
    overdue, declining trends, failed practice, ready-for-more); new `ActionCenter.jsx` supervisor
    tab + `subscribeInterviews` live subscription in `SupervisorApp`.
  - **F20 Ã¢â‚¬â€ Adaptive dev paths:** `buildDevPath` computes 5-step paths per weak domain (coaching Ã¢â€ â€™
    practice Ã¢â€ â€™ module Ã¢â€ â€™ mini-check) with done/next/todo status; `MyTraining.jsx` rewritten as a
    path stepper with "Personalize my path" button that calls the new `api/sequence-path.js` Gemini
    endpoint (temp 0.3, structured JSON, `validateSequenceResponse` tested); mini-check mode in
    `Check.jsx` via `miniDomain` + `limit` props (domain-filtered, saves completion + history point
    on pass); `minicheck` view wired in `NavigatorApp`.
  - **F21 Ã¢â‚¬â€ Mentor matching:** `buildMentorMatches` load-balances Learning/Solid mentees to
    least-loaded Can-Teach mentors (capped at `MENTOR_MAX_LOAD = 3`); `pairingOutcomes` enriches
    saved pairings with score delta; `pairings` Firestore collection + `savePairing` /
    `subscribePairings` / `updatePairingStatus`; new `Mentorship.jsx` supervisor tab.
  - **Foundation (Phase 0):** `resultHistory` + `pairings` Firestore rules added; `MENTOR_MAX_LOAD`,
    `MINICHECK_SIZE`, `MINICHECK_PASS`, `TREND_SYNTH_POINTS` added to `config.js`.
  - **Tests:** 197 Ã¢â€ â€™ **206** (8 test files); added `sequence-path.test.js` (9 tests for
    `validateSequenceResponse`); 9 new `buildTrend`/`trainingImpact`/`teamTrend` tests; 5 dossier
    tests; 8 action-center tests; 6 dev-path tests; 5 mentor-match tests; 3 pairing-outcomes tests.
- **Files affected:** new `src/components/{Sparkline,ActionCenter,Mentorship}.jsx`,
  `api/sequence-path.js`, `api/sequence-path.test.js`; edited `src/lib/{scoring,scoring.test,db}.js`,
  `src/data/config.js`, `src/components/{NavigatorDetail,Overview,MyTraining,Check,NavigatorApp,SupervisorApp,Nav}.jsx`,
  `src/styles.css`, `firestore.rules`, `server.js`.
- **Verification:** `npm test` Ã¢â€ â€™ **206 passing** (8 test files); `npm run build` Ã¢â€ â€™ clean;
  `node --check api/sequence-path.js` Ã¢â€ â€™ OK.
- **Status:** Complete.

### 2026-06-29 Ã¢â‚¬â€ Practice call: remove the domain picker (choice-friction cleanup)
- **What changed:** The Practice call (`Interview.jsx`) setup screen used to make the navigator pick
  one of 6 domains before starting. Removed the picker Ã¢â‚¬â€ the setup screen is now just a one-line
  description + "Start practice call". `startInterview` picks a random domain client-side purely to
  anchor the AI scenario (the API still requires a valid `domainId`; practice scores are advisory and
  never feed the matrix, so the specific domain is cosmetic). First of a planned set of
  choice-friction cleanups requested by the owner.
- **Scope note:** "Spot the Error" was intentionally left alone Ã¢â‚¬â€ its domain comes from the
  navigator's training plan context (a "Practice scenario" button per assigned weak domain), which is
  meaningful, not a free picker.
- **Files affected:** `src/components/Interview.jsx`, `CLAUDE.md`.
- **Verification:** `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-06-29 Ã¢â‚¬â€ Fix: navigator duplicated in supervisor cross-department strip
- **What changed:** The "Strength by department" strip (`departmentMatrix`) in the supervisor
  Overview listed a navigator who took two departments as **two separate rows** (one per result
  doc). Root cause: `SupervisorApp` mapped *each* `activeResults` doc into its own `departmentMatrix`
  sample, and a navigator with two dept checks has two result docs (composite keys
  `${navigatorId}__pediatrics` and `${navigatorId}__obgyn`). Fixed by grouping `activeResults` by
  `navigatorId` and merging each navigator's dept scores into a single sample before calling
  `departmentMatrix` Ã¢â‚¬â€ so one navigator = one row with all their department columns populated.
- **Scope note:** The main capability Matrix (`deptRows`/`buildMatrixRows`) was already correct Ã¢â‚¬â€
  it filters to one department, so it never double-listed. Only the cross-department strip was affected.
- **Files affected:** `src/components/SupervisorApp.jsx`.
- **Verification:** `npm test` Ã¢â€ â€™ 158 passing; `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-06-23 Ã¢â‚¬â€ Initial prototype build
- **What changed:** Scaffolded Vite+React app; data layer (`config`, `questions`, `navigators`);
  `scoring.js`; components Start/Check/Results/Matrix/Nav; full stylesheet; README.
- **Files affected:** entire initial `src/` tree, `package.json`, `vite.config.js`, `index.html`.
- **Reason:** Deliver the lean prototype from the brief.
- **Result:** End-to-end flow working; 6 domains / 20 questions; matrix + read-offs. (commit `2f72cf1`)

### 2026-06-23 Ã¢â‚¬â€ Analytics dashboards
- **What changed:** Added Team Overview, Navigators list, per-navigator dashboard; `floorStats`,
  `domainDistribution`, `mentorSuggestions`; clickable matrix rows; nav tabs.
- **Files affected:** `App.jsx`, `Nav.jsx`, new `Overview.jsx`/`Navigators.jsx`/`NavigatorDetail.jsx`,
  `scoring.js`, `styles.css`. *(Folded into subsequent commits.)*
- **Reason:** Make it useful to management beyond a raw matrix.
- **Result:** Floor + individual analytics; mentor suggestions.

### 2026-06-23 Ã¢â‚¬â€ Auto-assign training
- **What changed:** `training.js` catalog, `TRAINING_RULES`, training logic, Training tab,
  per-navigator "Assigned training".
- **Files affected:** `data/training.js`, `data/config.js`, `lib/scoring.js`, `components/Training.jsx`,
  `NavigatorDetail.jsx`, `Nav.jsx`, `App.jsx`, `styles.css`.
- **Reason:** Turn weak points into assigned action.
- **Result:** Required/Stretch assignments by weak point.

### 2026-06-23 Ã¢â‚¬â€ Previewable mockup training modules
- **What changed:** Added lesson content + key takeaways to each module; module preview screen;
  Preview buttons; "assigned because <domain> is at <level>" reasons.
- **Files affected:** `data/training.js`, new `components/TrainingModule.jsx`, `Training.jsx`,
  `NavigatorDetail.jsx`, `App.jsx`, `styles.css`. (commit `2041a08`)
- **Reason:** Make training previewable for the demo.
- **Result:** Clickable, previewable modules with cohorts.

### 2026-06-23 Ã¢â‚¬â€ Traffic-light level colors
- **What changed:** Recolored `LEVELS` to red/amber/green.
- **Files affected:** `data/config.js`. (commit `3d4e5d0`)
- **Reason:** Urgency encoding requested by user.
- **Result:** Consistent traffic-light coloring app-wide.

### 2026-06-23 Ã¢â‚¬â€ Department dimension
- **What changed:** Added `departments.js`; restructured `navigators.js` to per-department scores;
  `deptSamples`/`departmentOverall`/`departmentMatrix`; `DeptBar`; cross-department grid in
  Overview; per-department strip in NavigatorDetail.
- **Files affected:** new `data/departments.js`, `data/navigators.js`, `lib/scoring.js`, new
  `components/DeptBar.jsx`, `App.jsx`, `Overview.jsx`, `Matrix.jsx`, `Navigators.jsx`,
  `Training.jsx`, `NavigatorDetail.jsx`, `styles.css`. (commit `13fa39b`)
- **Reason:** Measure strength across departments.
- **Result:** Department-scoped app; Pediatrics live, 3 mockup departments.

### 2026-06-23 Ã¢â‚¬â€ Deployment to GitHub Pages
- **What changed:** Set Vite `base` for builds; published `dist/` to `gh-pages`.
- **Files affected:** `vite.config.js`; `gh-pages` branch.
- **Reason:** Stable public showcase URL.
- **Result:** Live at https://travis-holt.github.io/QuarterKnolwdge/.

### 2026-06-23 Ã¢â‚¬â€ Added this CLAUDE.md knowledge base
- **What changed:** Created the comprehensive project knowledge base.
- **Files affected:** `CLAUDE.md`.
- **Reason:** Permanent project memory + onboarding doc.
- **Result:** Single source of truth established (this file).

### 2026-06-23 Ã¢â‚¬â€ First automated tests (scoring.js)
- **What changed:** Added Vitest as the test runner and a unit-test suite covering all 18 exports
  of `lib/scoring.js` (scoring, level mapping, matrix build, read-offs, department views, training
  assignment, mentor suggestions). Added `test`/`test:watch` npm scripts. Fixtures are built from
  the real data modules and level boundaries are asserted relative to `THRESHOLDS`, so the tests
  survive future tuning of the config "knobs".
- **Files affected:** new `src/lib/scoring.test.js`, `package.json` (scripts + `vitest` devDep).
- **Reason:** Pay down the top technical-debt item Ã¢â‚¬â€ the pure logic was highly testable and had
  zero coverage.
- **Result:** 38 tests passing (`npm test`); production build unaffected (test file is excluded
  from the app bundle).

> **Note on dates:** all work above was completed in a single session dated **2026-06-23**.
> Git commit short-SHAs are referenced where a discrete commit exists; some incremental work was
> folded into later commits.

### 2026-06-24 Ã¢â‚¬â€ Post-review robustness fixes (subscription errors + duplicate names)
- **What changed:** Two issues found in a systematic code review were fixed.
  1. **Silent Firestore subscription errors (moderate):** `subscribeRoster` and `subscribeResults`
     in `db.js` now accept an optional `onError` callback (defaulting to `console.error`).
     `SupervisorApp.jsx` passes a shared handler that sets `subscribeError` state and renders a
     red banner: *"Lost connection to the database Ã¢â‚¬â€ data may be stale."* `NavigatorApp.jsx` logs
     the error (mentor suggestions silently stop updating Ã¢â‚¬â€ non-critical for the pilot).
  2. **Duplicate navigator names (minor):** `AddNavigatorForm` in `Navigators.jsx` now receives
     the live `roster` prop and performs a case-insensitive name-equality check before calling
     `addToRoster`. Shows *"A navigator with that name already exists."* inline.
- **Files affected:** `src/lib/db.js`, `src/components/SupervisorApp.jsx`,
  `src/components/NavigatorApp.jsx`, `src/components/Navigators.jsx`, `src/styles.css`
  (`.subscribe-error` banner style added).
- **Verification:** `npm test` Ã¢â€ â€™ 38 passing; `npm run build` Ã¢â€ â€™ clean.

### 2026-06-24 Ã¢â‚¬â€ Firebase pilot design complete; implementation plan written
- **What happened:** Full design session completed. Spec and implementation plan written,
  reviewed, and committed.
- **Key decisions locked:**
  - **Persistence:** Firebase/Firestore (free Spark tier). Two collections: `roster` + `results`,
    both UUID-keyed (never name-keyed Ã¢â‚¬â€ no typo/collision risk).
  - **Identity:** Navigator selects name from supervisor-managed roster dropdown + creates a
    4-digit PIN if none exists yet (otherwise enters the existing PIN). Supervisor enters hardcoded
    passcode from `config.js`.
  - **Role split:** `navigator` (own dashboard: per-domain breakdown, strengths/gaps, mentor
    suggestions, assigned training) and `supervisor` (full matrix/overview/training, live via
    `onSnapshot`).
  - **Session:** `src/lib/session.js` owns all localStorage state; exposes `{ role, name,
    navigatorId }` contract; swappable for real auth with no downstream changes.
  - **Sample data:** `SAMPLE_NAVIGATORS` removed. Matrix starts empty; fills with real submissions.
  - **Roster management:** Supervisor adds navigators by name in the Navigators tab; each
    navigator creates their PIN at first sign-in. Roster shows all members including "Not yet taken"
    state.
- **Design doc:** `docs/superpowers/specs/2026-06-24-firebase-pilot-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-06-24-firebase-pilot-plan.md`
- **Status:** Design complete. (Implementation followed Ã¢â‚¬â€ see next entry.)

### 2026-06-24 Ã¢â‚¬â€ Firebase pilot IMPLEMENTED (all code, awaiting Firebase config)
- **What changed:** Built the entire Firebase pilot end to end (Phases 1Ã¢â‚¬â€œ9 of the plan). The app is
  now a role-based multi-user webapp backed by Firestore.
  - **New libs:** `src/lib/firebase.js` (defensive init Ã¢â‚¬â€ never crashes the app if config is
    absent), `src/lib/db.js` (all Firestore reads/writes: roster + results), `src/lib/session.js`
    (isolated localStorage session).
  - **Start gate** (`Start.jsx`): role select Ã¢â€ â€™ navigator (roster dropdown + PIN create/login) /
    supervisor (passcode). Existing PINs are validated against the roster entry; blank PINs are
    set by the navigator through `updateRosterEntry`; passcode against `SUPERVISOR_PASSCODE`.
  - **Role split:** `App.jsx` reduced to a thin session/role router. New `SupervisorApp.jsx`
    (live `onSnapshot` results + roster, full management views) and `NavigatorApp.jsx` (own
    dashboard + my-training only; structurally no route to team views).
  - **Roster management:** `Navigators.jsx` gained an "Add navigator" form (name Ã¢â€ â€™ `addToRoster`)
    and shows "Not yet taken" for roster members without a submission.
  - **Navigator privacy:** `NavigatorDetail` renders mentor names as plain text (no drill-in) and
    hides the back button when used as a navigator's own dashboard; `TrainingModule` hides the
    cohort list for navigators (`showCohort={false}`); new `MyTraining.jsx` for the navigator's
    own plan. `Check.jsx` gained `hideName`/`greetingName` (navigator is already identified).
  - **Sample data removed:** `SAMPLE_NAVIGATORS` deleted; matrix starts empty and fills from
    Firestore. New `EmptyState.jsx` covers no-submissions, non-assessed-department, and
    not-configured cases. `Footer.jsx` extracted (sample-data wording removed). `Results.jsx`
    removed (navigator now lands directly on the richer dashboard).
  - **Config/setup:** `SUPERVISOR_PASSCODE` added to `config.js`; `.env.local.example` and
    `firestore.rules` added; `firebase` SDK added to `package.json`.
- **Files affected:** new `src/lib/firebase.js`, `src/lib/db.js`, `src/lib/session.js`,
  `src/components/{SupervisorApp,NavigatorApp,Start,Navigators,Nav,Check,NavigatorDetail,
  TrainingModule,MyTraining,EmptyState,Footer,Matrix}.jsx`, `src/App.jsx`, `src/data/{config,
  navigators}.js`, `src/styles.css`, `.env.local.example`, `firestore.rules`, `package.json`.
  `src/lib/scoring.js` and `scoring.test.js` unchanged.
- **Verification:** `npm test` Ã¢â€ â€™ 38 passing; `npm run build` Ã¢â€ â€™ clean; `npm run dev` Ã¢â€ â€™ all modules
  transform and serve (200). Defensive Firebase init verified to not crash without config.
- **Status:** Code complete and **deployed to GitHub Pages**. Firebase project is live (`quarterly-knowledge-check`); `.env.local` is configured; supervisor and navigator flows verified working end-to-end.

### 2026-06-24 Ã¢â‚¬â€ Competency engine + Gemini scenario generation on Vercel (Phases 1aÃ¢â‚¬â€œ1d)
- **What changed:** Turned the check into a two-axis, scenario-based competency platform that grows
  its own question bank from the SOP via Gemini.
  - **1a Ã¢â‚¬â€ Vercel migration:** `vite.config.js` base Ã¢â€ â€™ `/`; added `vercel.json` + `api/health.js`;
    retired the gh-pages base-path hack.
  - **1b Ã¢â‚¬â€ Competency engine:** new `src/data/competencies.js` (9 competencies). All 18 seed
    questions upgraded to per-option `points`+`rationale` and `competencies` tags (and renamed
    `QUESTIONS` Ã¢â€ â€™ `SEED_QUESTIONS`, with a back-compat alias). `scoring.js` refactored:
    `scorePerDomain(answers, questions)` is now points-based, new `scorePerCompetency()` +
    `competencyDistribution()`, `buildMatrixRows()` carries both axes. New `Coaching.jsx`
    (rule-based post-check feedback); competency panels on `NavigatorDetail` + `Overview`;
    `db.saveResult` stores `competencyScores`. Tests 38 Ã¢â€ â€™ **46**.
  - **1c Ã¢â‚¬â€ Question bank in Firestore:** new `questions` collection + `db.js` CRUD
    (`subscribeQuestions`, `getActiveQuestions`, `saveDraftQuestions`, `activate/archive/delete/
    updateQuestion`, `seedQuestionsIfEmpty`). `Check`/`NavigatorApp` read the **active** bank (seed
    fallback). New supervisor `QuestionBank.jsx` + `QuestionEditor.jsx` (review gate) + "Questions"
    nav tab. `firestore.rules` extended.
  - **1d Ã¢â‚¬â€ Gemini generation:** `api/generate-scenarios.js` (gemini-2.5-flash, structured JSON,
    validate/repair, multi-key rotation on 429/503) + `api/_sop-context.js`. Supervisor "Generate"
    Ã¢â€ â€™ drafts Ã¢â€ â€™ review Ã¢â€ â€™ activate. (2.0-flash returns a free-tier limit of 0 on the project keys, so
    2.5-flash is used.)
- **Files affected:** new `api/{generate-scenarios,health,_sop-context}.js`, `vercel.json`,
  `src/data/competencies.js`, `src/components/{Coaching,QuestionBank,QuestionEditor}.jsx`; edited
  `src/lib/{scoring,scoring.test,db}.js`, `src/data/questions.js`,
  `src/components/{Check,NavigatorApp,SupervisorApp,NavigatorDetail,Overview,Nav}.jsx`,
  `src/styles.css`, `vite.config.js`, `firestore.rules`, `.env.local.example`.
- **Verification:** `npm test` Ã¢â€ â€™ **46 passing**; `npm run build` Ã¢â€ â€™ clean; `npm run dev` Ã¢â€ â€™ 200;
  `node --check` on all `api/*` Ã¢â€ â€™ OK.
- **Status:** Code complete. **[ASSUMPTION]** Awaiting owner to link Vercel + set `GEMINI_API_KEY`
  / `GENERATION_SECRET`; until then the in-app Generate button is the only feature that needs the
  backend Ã¢â‚¬â€ the rest runs on the existing Firebase config.

### 2026-06-25 Ã¢â‚¬â€ Railway deployment: Express server + build fixes
- **What changed:** Migrated hosting from Vercel Ã¢â€ â€™ Railway. Three rounds of build fixes were
  needed before the Railway pipeline passed.
  - **Migration:** `server.js` (Express 5, serves `dist/` + mounts `/api/*` handlers),
    `railway.toml` (Railpack config: build + start + nixpacksConfigPath), `express` dep +
    `"start"` script + `"engines": {"node":">=20.0.0"}` in `package.json`.
  - **Express 5 wildcard fix:** SPA catch-all initially written as `app.get('*', Ã¢â‚¬Â¦)`. Express 5
    (path-to-regexp v8) rejects a bare `*` wildcard Ã¢â‚¬â€ requires a named param. Changed to
    `app.get('/*splat', Ã¢â‚¬Â¦)`.
  - **Node version (Round 1):** Railway defaulted to Node 18; vitest@4 + vite@8 require Node 20+.
    Fixed: added `"engines": {"node":">=20.0.0"}` to `package.json` to tell Nixpacks/Railpack to
    select Node 20.
  - **Lockfile sync (Round 2):** Previous partial `npm install` runs left the lockfile missing
    esbuild@0.28.1 entries. Fixed: wiped `node_modules` + `package-lock.json` and ran a clean
    `npm install` to fully regenerate the lockfile with both esbuild@0.21.5 (vite@5 dep) and
    esbuild@0.28.1 (vitest@4 dep).
  - **EBADPLATFORM (Round 3):** The clean lockfile includes all platform-specific esbuild
    optional packages (netbsd-arm64, darwin-arm64, win32-x64, Ã¢â‚¬Â¦). `npm ci` on Railway's Linux
    x64 fails when it encounters packages for incompatible platforms, even if they're optional.
    Fixed: `nixpacks.toml` overrides Railpack's install step from `npm ci` to `npm install`, which
    gracefully skips incompatible optional packages.
- **Files affected:** new `server.js`, `railway.toml`, `nixpacks.toml`; `package.json`,
  `package-lock.json`.
- **Verification:** `npm test` Ã¢â€ â€™ 46 passing; `node --check server.js` OK; pushed to `main`;
  Railway build in progress (nixpacks.toml override awaiting confirmation).
- **Status:** Code complete; awaiting Railway deploy confirmation.

### 2026-06-25 Ã¢â‚¬â€ Full SOP context + remove GENERATION_SECRET requirement
- **What changed:** Two improvements to the Gemini scenario generation pipeline.
  1. **Full SOP context (`api/_sop-context.js`):** replaced the old distilled ~50-line summary with
     the complete final SOP ("Pediatrics Department.pdf" Ã¢â‚¬â€ 12 pages). Now includes every provider's
     exact booking rules (slot durations, double-booking constraints, demographic comfort, specialist
     schedules), the full referral decision tree (PE UTD/not-UTD Ãƒâ€” in/out-of-Aizer's 5 specialties Ãƒâ€”
     emergency/non-emergency), Sally Carilli escalation triggers, all insurance indicators and
     plan-specific rules, immunization/lab routing with nurse schedules, arrival instruction nuances,
     family/sibling booking mechanics, and the full contact directory. Gemini now has sufficient
     grounding to generate high-specificity scenario questions for every domain.
  2. **Remove GENERATION_SECRET env var requirement (`api/generate-scenarios.js`):** the server now
     falls back to `SUPERVISOR_PASSCODE` (imported from `src/data/config.js`) when `GENERATION_SECRET`
     is not set. The client already sends `SUPERVISOR_PASSCODE` as the secret Ã¢â‚¬â€ there was never a
     meaningful distinction. Eliminates the need for an extra Railway Variable.
- **Files affected:** `api/_sop-context.js` (full rewrite), `api/generate-scenarios.js`
  (import `SUPERVISOR_PASSCODE`; fallback logic replacing the hard error).
- **Verification:** `node --check api/generate-scenarios.js` Ã¢â€ â€™ OK; `node --check api/_sop-context.js` Ã¢â€ â€™ OK.
- **Status:** Complete. `GEMINI_API_KEYS` (already set in Railway) is the only server-side variable
  needed for generation to work; no `GENERATION_SECRET` required.

### 2026-06-25 Ã¢â‚¬â€ SOP replaced with Pediatrics_SOP_Updated.pdf (pure replacement)
- **What changed:** `api/_sop-context.js` fully replaced using **only** content from
  `Pediatrics_SOP_Updated.pdf` (Aizer Health Organization Operational Procedures v1.0). No content
  from the old `SOP Guide.pdf` is carried forward.
  - **Providers:** Correct names and details Ã¢â‚¬â€ Dina Faiden (formerly Donna Deck, not Dick), Lazar
    Khaimov, Robin Aschkenasy, Tamar Dachoh, Chana Heintz, Lily Namanworth Ã¢â‚¬â€ with languages and
    patient caps exactly as in the updated document.
  - **New appointment types:** Tongue Tie (within 5 weeks; refer out if child is older), Weight Check
    (TE to Sally Carilli if PE up to date), Lactation (30 min OV; Robin/Tamar/Chana only), Early
    Intervention (TE to PEDS TELEPHONE ENCOUNTER queue), WIC forms (TE or OV with reason "HEMO").
  - **Full 9-scenario TE guide:** step-by-step for lab results (black lock rule), medical questions,
    shots/immunizations, ENT/nutritionist, referrals, controlled substance follow-ups, digital imaging,
    specialty care (Vision/Speech/PT-OT/Podiatry = transfer only, no TE), and medication refills
    (HIGH PRIORITY tag if patient is completely out).
  - **PE frequency calculator and consequences block** per the new SOP.
  - Source reference in Ã‚Â§1 updated from `SOP Guide.pdf` to `Pediatrics_SOP_Updated.pdf`.
- **Files affected:** `api/_sop-context.js` (full rewrite), `CLAUDE.md` (Ã‚Â§1 + Ã‚Â§7).
- **Verification:** `node --check api/_sop-context.js` Ã¢â€ â€™ OK; `npm test` Ã¢â€ â€™ 46 passing.
- **Status:** Complete. All AI features (scenario generation, coaching, interview, audit) now ground
  against the updated SOP only.

### 2026-06-25 Ã¢â‚¬â€ Interview caller consistency fix
- **What changed:** Gemini was hallucinating inconsistent facts mid-call (e.g., stating a birthday
  of August 2017 in one turn, then saying "he just turned 6" two turns later). Root cause: at
  temperature 0.8 the model generated factual answers fresh each turn without cross-checking its own
  history.
  - Added a `CRITICAL` consistency rule to `buildSystemInstruction` in `api/interview-turn.js`:
    Gemini is now explicitly told to check its prior turns before answering any factual question about
    the caller (names, dates, ages, insurance, provider, reason for calling, etc.).
  - Reduced turn temperature from 0.8 Ã¢â€ â€™ 0.5 to reduce free-form generation that diverges from the
    established conversation history.
- **Files affected:** `api/interview-turn.js`.
- **Verification:** `node --check api/interview-turn.js` Ã¢â€ â€™ OK; `npm test` Ã¢â€ â€™ 46 passing.
- **Status:** Complete.

### 2026-06-26 Ã¢â‚¬â€ OB/GYN live check: multi-department architecture (F10 Phase 2)
- **What changed:** Made OB/GYN a genuine live check alongside Pediatrics. Navigators now pick
  their department at check-start; results, questions, and all AI features are scoped per dept.
  **Hard constraint met:** all authored OB/GYN content uses sanitized generic role labels only
  (no real names, phone numbers, or portal credentials Ã¢â‚¬â€ the repo is public).
  1. **`src/data/departments.js`:** added `ASSESSED_DEPTS = ['pediatrics', 'obgyn']`,
     `DEFAULT_DEPT`, `isAssessed(id)` helper; kept `ASSESSED_DEPT` as back-compat alias.
  2. **`src/data/questions.js`:** domain names/blurbs neutralized (IDs unchanged);
     `SEED_QUESTIONS_OBGYN` imported + re-exported; `ALL_SEED_QUESTIONS` combined export added;
     `department: 'pediatrics'` injected on all Pediatrics seed questions.
  3. **New `src/data/questions-obgyn.js`:** 14 sanitized OB/GYN seed questions across all 6
     domain IDs; generic role labels only ("the MFM nurse", "the MFM director", etc.).
  4. **`api/_sop-context.js`:** added `SOP_CONTEXT_OBGYN` (sanitized OB/GYN grounding distilled
     from the owner-provided SOP), `SOP_CONTEXTS` map, `sopContextFor(deptId)` accessor; kept
     `SOP_CONTEXT` back-compat alias.
  5. **`api/generate-scenarios.js`:** already used `sopContextFor` (done in previous session).
  6. **`api/interview-turn.js`, `api/grade-interview.js`, `api/generate-audit.js`:** switched from
     `SOP_CONTEXT` to `sopContextFor(department)`, extracted `department = 'pediatrics'` from
     request body.
  7. **`src/lib/db.js`:** `getActiveQuestions(dept)` filters by dept; `saveResult` and `getResult`
     use composite key `${navigatorId}__${department}` (with Pediatrics legacy fallback);
     `clearResult(id, dept)` likewise; `seedQuestionsIfEmpty` seeds `ALL_SEED_QUESTIONS`;
     `saveDraftQuestions` stamps dept on each draft; all doc comments updated.
  8. **`src/lib/scoring.js`:** `departmentMatrix` now uses `liveResult.department ?? 'pediatrics'`
     (was hardcoded to `ASSESSED_DEPT`); removed now-unused `ASSESSED_DEPT` import.
  9. **`src/lib/scoring.test.js`:** updated `departmentMatrix` live-taker test, added OB/GYN
     live-taker case, legacy-no-dept case, and new `isAssessed` test suite. **46 Ã¢â€ â€™ 50 tests**.
  10. **`src/components/NavigatorApp.jsx`:** added `activeDept` state + `deptselect` view (dept
      picker with "Live check" badge cards); all DB calls and API features scoped to `activeDept`;
      seed fallback per dept via `SEED_BY_DEPT` map.
  11. **`src/components/SupervisorApp.jsx`:** uses `deptIsAssessed(selectedDept)` and `DEFAULT_DEPT`;
      seeds `ALL_SEED_QUESTIONS`; filters `activeResults` by dept for the matrix; `handleGenerate`
      + `saveDraftQuestions` pass `selectedDept`; `handleResetResult` passes dept.
  12. **`src/components/DeptBar.jsx`:** `isAssessed(d.id)` for live badge (both depts now show it);
      updated note text.
  13. **`src/components/QuestionBank.jsx`:** filters displayed questions by `selectedDept` prop.
  14. **`src/components/Interview.jsx`, `SpotTheError.jsx`:** accept `department` prop and pass to
      all API call bodies.
  15. **`src/components/Check.jsx`:** `deptName` prop surfaces in the greeting line.
  16. **`src/styles.css`:** `.dept-select` styles added (department picker card grid).
- **Files affected:** `src/data/departments.js`, `src/data/questions.js`,
  **new** `src/data/questions-obgyn.js`, `api/_sop-context.js`, `api/interview-turn.js`,
  `api/grade-interview.js`, `api/generate-audit.js`, `api/generate-scenarios.js`,
  `src/lib/db.js`, `src/lib/scoring.js`, `src/lib/scoring.test.js`,
  `src/components/{NavigatorApp,SupervisorApp,DeptBar,QuestionBank,Interview,SpotTheError,Check}.jsx`,
  `src/styles.css`, `CLAUDE.md`.
- **Verification:** `npm test` Ã¢â€ â€™ **50 passing**; `npm run build` Ã¢â€ â€™ clean; `node --check` on all
  4 edited API handlers Ã¢â€ â€™ OK. OB/GYN content grep confirmed zero leaked names/phone numbers.
- **Status:** Complete.

### 2026-06-26 Ã¢â‚¬â€ Question Health / SOP Drift flags
- **What changed:** Added automatic health indicators to every active question in the Question Bank.
  After a question has been answered 10+ times, a colored health dot appears next to it:
  green (healthy Ã¢â€°Â¥20% correct), red (Review Required <20% correct). A question with <10 responses
  shows a gray dot ("not enough data yet").
  - **`saveResult` in `db.js`:** now stores an `answers: { [questionId]: optionId }` field on every
    result doc. Legacy docs without the field are silently skipped by the health computation.
  - **`NavigatorApp.jsx`:** passes the raw `answers` map (already available in `handleSubmit`)
    as the new 6th argument to `saveResult`.
  - **`computeQuestionHealth(questions, results)` in `scoring.js`:** pure function that iterates
    result docs with `answers`, counts responses and correct picks per question, and derives
    `{ responseCount, correctCount, correctRate, canTeachCount, canTeachFailCount, status }` for
    each question. Also tracks "Can-Teach signal" Ã¢â‚¬â€ when navigators who scored Ã¢â€°Â¥85 in that question's
    domain also get it wrong, the alert text says "X of Y Can-Teach navigators also missed this Ã¢â‚¬â€
    the SOP may not match floor practice."
  - **`QuestionBank.jsx`:** accepts new `results` prop; calls `computeQuestionHealth(active, results)`;
    renders health indicator in each active question's header row. Flagged questions get a subtle
    red-tint border + an alert banner above the scenario text with the specific stats.
  - **`SupervisorApp.jsx`:** passes `deptResults` (already filtered to active roster + selected dept)
    to `QuestionBank`.
  - **`styles.css`:** new `.qhealth`, `.qhealth__dot--{healthy,review,insufficient}`, `.qhealth__badge`,
    `.qhealth__alert`, `.qbank__item.is-flagged` rules.
  - **`scoring.test.js`:** 10 new tests for `computeQuestionHealth` covering: insufficient threshold,
    healthy boundary, review flag, legacy-doc skipping, missing-question skipping, can-teach tracking,
    multi-question independence, empty inputs.
- **Files affected:** `src/lib/{scoring,scoring.test,db}.js`,
  `src/components/{NavigatorApp,QuestionBank,SupervisorApp}.jsx`, `src/styles.css`.
- **Verification:** `npm test` Ã¢â€ â€™ **60 passing**; `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-06-26 Ã¢â‚¬â€ Navigator department switcher UX fix
- **What changed:** Navigators were previously locked to the department they picked at login Ã¢â‚¬â€
  there was no way to switch to another department (e.g., to see OB/GYN results after taking
  Pediatrics) without signing out and back in. Fixed in two layers:
  1. **Nav pill:** `Nav.jsx` accepts `activeDeptName` + `onChangeDept` props and renders a small
     pill button (warm clay accent style) showing the current dept name with a Ã¢â€¡â€ž icon. Hidden
     during `check` and `coaching` views so navigators can't abandon mid-quiz. `NavigatorApp.jsx`
     passes these through an updated `Shell` component; clicking calls `handleChangeDept` which
     resets dept-specific state and returns to `deptselect`.
  2. **Clickable dept cards:** `NavigatorDetail.jsx` accepts a new `onChangeDept(deptId)` prop.
     In the "Strength across departments" `deptstrip`, assessed non-current dept cards render as
     `<button>` elements (`is-switchable` class) Ã¢â‚¬â€ clicking jumps directly to that dept via
     `handleDeptSelect`, which checks for an existing result and lands on `dashboard` or `check`.
     Non-assessed depts stay as `<div>` (not clickable). An assessed dept with no result yet
     shows "Take the check Ã¢â€ â€™" as its label instead of "Ã¢â‚¬â€ not assessed". `isAssessed` imported
     from `departments.js` in `NavigatorDetail`.
  - **`styles.css`:** `.nav__dept-switch` pill + `.deptstrip__item.is-switchable` hover/press
    states (lift + accent border on hover).
- **Files affected:** `src/components/{Nav,NavigatorDetail,NavigatorApp}.jsx`, `src/styles.css`.
- **Verification:** `npm test` Ã¢â€ â€™ 60 passing; `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-06-26 Ã¢â‚¬â€ Rebrand to Cruciby Ã¢â‚¬â€ Forged Under Pressure *(reverted 2026-06-29)*
- **What changed:** Full product rebrand from "Quarterly Knowledge Check" to **Cruciby Ã¢â‚¬â€ Forged Under Pressure**.
- **Status:** Reverted Ã¢â‚¬â€ see entry below.

### 2026-06-28 Ã¢â‚¬â€ `generate-audit` validation refactor + extra API-handler tests
- **What changed:** Extracted the response-validation logic of `api/generate-audit.js` into a pure,
  exported `validateAuditResponse(parsed)` helper (returns `{ data }` | `{ error }`; no I/O), and
  routed the handler through it Ã¢â‚¬â€ behaviour and status codes unchanged. Added two more `api/` test
  files on top of the 2026-06-26 audit pass: `api/generate-audit.test.js` (covers
  `validateAuditResponse` Ã¢â‚¬â€ valid shape, incomplete transcript, bad/missing errorIndex, Patient-turn
  fallback to nearest Agent turn, sanitisation) and `api/_gemini-client.test.js` (`getApiKeys` env
  parsing + `geminiWithRotation` with a stubbed `fetch`). Tests **130 Ã¢â€ â€™ 158** (7 test files).
  Also added the ponytail agent-tooling files to `.gitignore`.
- **Files affected:** `api/generate-audit.js`; **new** `api/generate-audit.test.js`,
  `api/_gemini-client.test.js`; `.gitignore`; `package-lock.json`.
- **Verification:** `npm test` Ã¢â€ â€™ **158 passing**; `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-06-26 Ã¢â‚¬â€ Code-audit pass: DRY cleanup, test coverage expansion, Vite CVE patch
- **What changed:** Systematic code-quality pass driven by a 6-agent audit. All 16 tasks completed.
  1. **`src/data/questions.js`:** exported `domainName(id)` helper; removed 9 identical inline copies
     from 9 component files (`Coaching`, `Check`, `Matrix`, `MyTraining`, `NavigatorDetail`,
     `Overview`, `QuestionBank`, `Training`, `TrainingModule`).
  2. **`src/lib/scoring.js`:** `scorePerDomain` and `scorePerCompetency` now default `answers` to `{}`
     (previously crashed on `undefined` input). `earnedPoints` already had an `options?.` guard
     (added in prior session). Fixes a latent crash if called with no arguments.
  3. **`src/lib/apiFetch.js` (new):** shared client helper encapsulating AbortController timeout,
     Content-Type header, `SUPERVISOR_PASSCODE` injection, error-body parsing, and `AbortError` name
     preservation. Used by `Interview.jsx`, `SpotTheError.jsx`, `Coaching.jsx`, `SupervisorApp.jsx`.
  4. **`api/_auth.js` (new):** `validateSecret(req, res)` Ã¢â‚¬â€ shared secret-validation helper for all
     6 Gemini handlers (replaces the identical 3-line block copy-pasted across them). The
     `GENERATION_SECRET || SUPERVISOR_PASSCODE` fallback now lives in one place.
  5. **`api/_gemini-client.js`:** added startup validation (warn if no keys configured); truncates
     error-body before logging to cap log noise.
  6. **`Coaching.jsx`:** standardised from `.then()/.catch()` to `async/await` for consistency with
     the rest of the codebase; replaced raw fetch with `apiFetch`.
  7. **Vite:** upgraded from 5.4.11 Ã¢â€ â€™ **5.4.21** (latest v5 patch Ã¢â‚¬â€ fixes 3 CVEs: `server.fs.deny`
     bypass, path traversal, NTLMv2 hash disclosure).
  8. **Test coverage (130 tests, 5 test files):**
     - `scoring.test.js`: 9 new malformed-input edge-case tests (`undefined answers`, missing
       `options` field, unknown `domainId`, unknown competency tag, etc.).
     - `src/lib/session.test.js` (new, 12 tests): localStorage round-trips, overwrite behaviour,
       corrupt JSON graceful return, unavailability handling via `vi.stubGlobal`.
     - `api/api-handlers.test.js` (new, 30 tests): `sanitize` (generate-scenarios), `buildDigest`
       (generate-coaching), `buildSystemInstruction` + `buildContents` (interview-turn) Ã¢â‚¬â€ all now
       exported with `export` keyword.
     - `src/components/components.test.jsx` (new, 15 tests, `@vitest-environment jsdom`):
       `EmptyState` pure render, `Footer` pure render, `Nav` supervisor/navigator tabs, active-state
       class, click handlers, dept-switch pill show/hide.
     - `src/lib/db.test.js` (new, 18 tests): Firebase + Firestore fully mocked via `vi.hoisted()`;
       tests composite-key construction in `saveResult`/`clearResult`, data shapes, legacy fallback
       reads, `subscribeRoster` mapping and error-callback routing.
  9. **Test infrastructure:** `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` added
     as devDeps; `src/test-setup.js` (jest-dom/vitest extension + `afterEach(cleanup)`); `test`
     config in `vite.config.js` (`setupFiles`); `@vitest-environment jsdom` pragma in component tests.
  10. **Fragile test fixes** (from prior audit): `readinessTally` empty-matrix case, `trainingPlan`
      named-navigator positional assertion, `mentorSuggestions` redundant `if` guard removed.
- **Files affected:** `src/data/questions.js`; `src/lib/{scoring,scoring.test,session.test,db.test}.js`;
  **new** `src/lib/{apiFetch,session.test,db.test}.js`; **new** `api/{_auth,api-handlers.test}.js`;
  **new** `src/components/components.test.jsx`, `src/test-setup.js`; edited
  `src/components/{Coaching,Interview,SpotTheError,SupervisorApp}.jsx`; all 6 Gemini `api/*.js`
  handlers; `api/_gemini-client.js`; `vite.config.js`; `package.json`/`package-lock.json`.
- **Verification:** `npm test` Ã¢â€ â€™ **130 passing** (5 test files); `npm run build` Ã¢â€ â€™ clean;
  `node --check` on all 6 Gemini handlers + `_auth.js` Ã¢â€ â€™ OK.
- **Status:** Complete.

### 2026-06-29 Ã¢â‚¬â€ Rename back to Knowledge Check; logo removed
- **What changed:** Reverted the 2026-06-26 Cruciby rebrand and the 2026-06-28 logo addition.
  The displayed product name is **Knowledge Check** everywhere; no logo image is rendered. The
  git repo name (`QuarterKnolwdge`) is unchanged. During the push a rebase conflict was resolved:
  the remote had added a favicon link alongside the Cruciby title Ã¢â‚¬â€ the favicon was kept, the name
  was changed.
  - `index.html` Ã¢â‚¬â€ `<title>` Ã¢â€ â€™ `Knowledge Check`; favicon `<link>` retained from remote commit.
  - `Nav.jsx` Ã¢â‚¬â€ logo `<img>` removed; brand button text Ã¢â€ â€™ `Knowledge Check`.
  - `Footer.jsx` Ã¢â‚¬â€ footer line Ã¢â€ â€™ `Knowledge Check` (tagline removed).
  - `Start.jsx` Ã¢â‚¬â€ logo `<img>` removed; eyebrow Ã¢â€ â€™ `Knowledge Check` (tagline removed).
  - `CLAUDE.md` Ã¢â‚¬â€ header, Ã‚Â§1, Ã‚Â§7 rebrand entry updated.
  - **Note:** `styles.css` retains dead `@keyframes logo-float` / `.start__logo` / `.nav__logo`
    rules from the 2026-06-28 commit Ã¢â‚¬â€ harmless but can be cleaned up.
- **Files affected:** `index.html`, `src/components/{Nav,Footer,Start}.jsx`, `CLAUDE.md`.
- **Verification:** `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-06-29 Ã¢â‚¬â€ ponytail agent tooling installed (local only Ã¢â‚¬â€ NOT an app change)
- **What changed:** Installed the **ponytail** token-reduction plugin
  (github.com/DietrichGebert/ponytail) for the repo owner's Claude Code environment. **No repo/app
  file changed** Ã¢â‚¬â€ it lives entirely in `~/.claude/` (runtime in `~/.claude/plugins/ponytail/`,
  hook wiring in `~/.claude/settings.json`). The app's `.gitignore` already treats ponytail as
  "agent tooling, not part of the app." Documented here only so future agents know it's active.
  - **Mechanism:** a `SessionStart` hook injects ponytail's "laziness ladder" ruleset (favour
    reuse / stdlib / one-liners over new abstractions) into context **autonomously every session**
    Ã¢â‚¬â€ no trigger needed; default mode `full`. A `UserPromptSubmit` hook tracks mode.
  - **Control (typed as a normal prompt):** `/ponytail lite|full|ultra|off`, or `stop ponytail`
    / `normal mode` to disable. Statusline shows `[PONYTAIL:<MODE>]`.
- **Files affected:** none in-repo (this Ã‚Â§7 note + the Ã‚Â§14 bullet are the only repo edits).
- **Status:** Complete. See also the `ponytail-installed` agent memory.

### 2026-06-29 Ã¢â‚¬â€ SAFe Agentic Workflow harness installed (in-repo `.claude/`, tailored to this stack)
- **What changed:** Installed a tailored adaptation of the **SAFe Agentic Workflow** harness
  (github.com/bybren-llc/safe-agentic-workflow) into the repo's `.claude/` directory. This is
  **agent-workflow tooling, not an app change** Ã¢â‚¬â€ no `src/`, `api/`, or build file was touched.
  SAW ships for a Linear + Docker + Postgres-RLS + Stripe + multi-reviewer team stack; every piece
  was rewritten for this project's actual stack (React/Vite + Firebase + Railway + Vitest, solo dev,
  `main` branch, gates `npm test` / `npm run build`). ~40 irrelevant SAW files (Linear sync, Docker
  deploy, RLS/Stripe skills, remote-rollback, etc.) were intentionally **not** copied.
  - **Commands (8)** in `.claude/commands/`: `start-work`, `end-work`, `pre-pr`, `check-workflow`,
    `quick-fix`, `retro`, `search-pattern`, `update-docs` Ã¢â‚¬â€ all reference npm gates and `main`, no Linear.
  - **Agents (5)** in `.claude/agents/`: `fe-developer`, `qas`, `system-architect`, `tech-writer`,
    `rte` Ã¢â‚¬â€ grounded in this codebase's modules, conventions, and the CLAUDE.md-update rule.
  - **Skills (4)** in `.claude/skills/`: `safe-workflow`, `pattern-discovery`, `testing-patterns`,
    `git-advanced` Ã¢â‚¬â€ added alongside the existing BizOps/dev skills already in that dir (untouched).
    `.gitignore` line 9 (`skills/`) normally keeps skills out of git by repo convention, but for
    codespace-migration safety they were **force-added** (`git add -f .claude/skills`) in a follow-up
    commit, so all 57 skill files (the 4 harness skills + existing BizOps/dev packs) are now committed.
  - **Config:** `.claude/team-config.json` (real values, no placeholders), `.claude/settings.json`
    (guardrail hooks: warn on `main`, block push-to-`main`, block push with uncommitted changes,
    remind `/pre-pr` before `gh pr create`, session-end uncommitted-work check), `.claude/README.md`.
  - **Incidental fix:** `src/components/components.test.jsx` Footer test still asserted the old
    "Cruciby" brand name (stale since the 2026-06-29 rename) Ã¢â‚¬â€ updated to "Knowledge Check".
  - **Sensitive files excluded + gitignored:** `roo-code-settings.json` (holds a live Cloudflare
    API key) and `OB GYN SOP.pdf` / `Pediatrics_SOP_Updated.pdf` (likely patient/provider PII) were
    **not** committed Ã¢â‚¬â€ this is a public repo. All three were added to `.gitignore` and must be
    preserved by manual download before the codespace expires. (`SOP Guide.pdf` was already tracked
    pre-session and is left as-is.)
- **Files affected:** new `.claude/{README.md,team-config.json,settings.json}`,
  `.claude/commands/*.md` (8), `.claude/agents/*.md` (5), `.claude/skills/**` (4 harness skills +
  existing packs, force-added); edited `.gitignore`,
  `src/components/components.test.jsx` (CrucibyÃ¢â€ â€™Knowledge Check), `CLAUDE.md`.
- **Delivery:** branch `chore/install-saw-harness` Ã¢â€ â€™ PR #1 (3 commits: harness, skills, gitignore).
- **Verification:** `npm test` Ã¢â€ â€™ **158 passing** (Footer test fixed); harness is config/docs only.
- **Status:** Complete.

### 2026-06-26 Ã¢â‚¬â€ Remove Gemini/AI branding from UI
- **What changed:** Stripped all visible references to "Gemini" and "AI" from the navigator and
  supervisor-facing UI. The underlying features are unchanged; only the labels are removed.
  - `Coaching.jsx` Ã¢â‚¬â€ removed "AI" badge from the personalised coaching heading (skeleton + loaded state).
  - `SpotTheError.jsx` Ã¢â‚¬â€ removed "AI Coach" badge above the coaching reply text.
  - `Interview.jsx` Ã¢â‚¬â€ replaced "Gemini plays a patient caller" with "A simulated patient caller will join";
    "get an AI score" Ã¢â€ â€™ "get a score"; "Gemini is scoring your performance" Ã¢â€ â€™ "Reviewing your performance".
  - `QuestionBank.jsx` Ã¢â‚¬â€ removed the `via {source}` tag that showed "via gemini" on generated question cards.
- **Files affected:** `src/components/{Coaching,Interview,SpotTheError,QuestionBank}.jsx`.
- **Verification:** `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-06-26 Ã¢â‚¬â€ Craft pass: shared Gemini client + latent CSS-var bug fix
- **What changed:** A focused quality refactor from a craft review (no behaviour changes to the
  happy path; one latent rendering bug fixed).
  1. **Extracted `api/_gemini-client.js`** Ã¢â‚¬â€ `getApiKeys`, `callGemini`, `geminiWithRotation`, the
     `ROTATABLE` set, and the `MODEL` constant were copy-pasted across all 6 Gemini handlers and had
     **diverged** (two handlers had a clean `geminiWithRotation` helper; three inlined the loop; one
     tracked auth failures the others lacked). Now one module. `geminiWithRotation(keys, body,
     {label})` returns a normalized result the caller maps to HTTP: `{ok:true,text}` |
     `{ok:false,reason:'fatal',status}` (Ã¢â€ â€™502) | `{ok:false,reason:'auth'}` (Ã¢â€ â€™500, used by
     generate-coaching) | `{ok:false,reason:'exhausted'}` (Ã¢â€ â€™429). Every handler's existing status
     codes and error strings were preserved. All 6 handlers (`generate-scenarios`,
     `generate-coaching`, `interview-turn`, `grade-interview`, `generate-audit`, `coach-audit`) now
     import from it.
  2. **Latent CSS-var bug fixed.** The interview score colours used `var(--can-teach)` /
     `var(--solid)` / `var(--learning)` and some new CSS used `var(--level-canteach)` etc. Ã¢â‚¬â€ **none
     of those variables were ever defined** (the matrix colours cells via inline JS from
     `LEVELS[Ã¢â‚¬Â¦].color`, not CSS vars), so the score colours silently fell back to default text
     colour. Fixed by defining `--level-learning/solid/canteach` in `styles.css :root` (kept in sync
     with `LEVELS`) and routing both `Interview.jsx` and `NavigatorDetail.jsx` through a new
     `interviewScoreColor(score)` helper in `config.js`.
  3. **Magic score-bands centralised.** The 75/60 green/amber/red thresholds (duplicated in two
     components) moved to `INTERVIEW_SCORE_BANDS` + `interviewScoreColor()` in `config.js`. This is a
     separate scale from the capability `THRESHOLDS` (60/85) by design Ã¢â‚¬â€ documented in config.
  4. **Prompt input caps.** `grade-interview.js` now caps the transcript at 40 turns Ãƒâ€” 1500 chars
     each; `coach-audit.js` caps the reflection + model explanation at 2000 chars each. Bounds the
     token budget and trims the prompt-injection surface (output is advisory, but cheap insurance).
  5. **Redundant condition** `phase === 'loading' || (phase === 'loading' && genError)` in
     `SpotTheError.jsx` simplified to `phase === 'loading'`.
- **Files affected:** new `api/_gemini-client.js`; edited all 6 `api/*` Gemini handlers,
  `src/data/config.js`, `src/styles.css`, `src/components/{Interview,NavigatorDetail,SpotTheError}.jsx`.
- **Verification:** `npm test` Ã¢â€ â€™ 46 passing; `npm run build` Ã¢â€ â€™ clean; `node --check` on all handlers
  Ã¢â€ â€™ OK; runtime `import()` smoke-test of all 6 handlers + the shared client Ã¢â€ â€™ resolves;
  `interviewScoreColor` returns the right band var for 80/65/40/null; confirmed no `--can-teach`
  refs remain and `--level-*` vars are in the built bundle.
- **Status:** Complete.

### 2026-06-25 Ã¢â‚¬â€ Interview discard option + AI grading after save (F15 Phase 2)
- **What changed:** Two navigator-requested additions to the practice call feature.
  1. **Discard option:** the single "End call" button is replaced by two header buttons Ã¢â‚¬â€
     **"Save & get feedback"** (primary) and **"Discard"** (ghost). Discarding shows a
     "Session discarded Ã¢â‚¬â€ nothing was saved" screen and calls `reset()` without touching Firestore.
  2. **AI grading:** after saving, the client calls the new `POST /api/grade-interview` endpoint
     and transitions through a `grading` phase (spinner + "Reviewing your callÃ¢â‚¬Â¦"). The `reviewed`
     screen shows: a large color-coded score (green Ã¢â€°Â¥75, amber Ã¢â€°Â¥60, red <60), a 2Ã¢â‚¬â€œ3 sentence
     summary, a "What you did well" card (green left-border, 2Ã¢â‚¬â€œ4 bullets), and a "What to work on"
     card (amber left-border, 2Ã¢â‚¬â€œ4 bullets). Grade is also written back to the Firestore interview
     doc via `updateInterviewGrade` so supervisors see it in the navigator's Practice sessions panel.
  - **New file:** `api/grade-interview.js` Ã¢â‚¬â€ Gemini proxy (temp 0.3, structured JSON schema,
    same key rotation pattern). Grounds judgment solely in `SOP_CONTEXT`; clamps score 0Ã¢â‚¬â€œ100;
    validates output before returning `{ grade: { score, summary, strengths[], improvements[] } }`.
  - **`server.js`:** new `POST /api/grade-interview` route; dead `createRequire` import removed.
  - **`src/lib/db.js`:** `updateInterviewGrade(id, grade)` added.
  - **`NavigatorDetail.jsx`:** interview-log header row shows a score badge (color-coded); expanded
    body shows the full grade breakdown (score, summary, strengths, improvements) above the transcript.
  - **`styles.css`:** new rules for discard glyph variant, `interview__end-actions` flex group,
    grading spinner, review screen (`interview__review`, `interview__score-card`, `interview__feedback-card`),
    score badge (`interview-log__score-badge`), and grade breakdown (`interview-log__grade*`).
- **Files affected:** new `api/grade-interview.js`; edited `server.js`, `src/lib/db.js`,
  `src/components/{Interview,NavigatorDetail}.jsx`, `src/styles.css`.
- **Verification:** `npm test` Ã¢â€ â€™ 46 passing; `npm run build` Ã¢â€ â€™ clean; `node --check` on both
  `api/grade-interview.js` and `server.js` Ã¢â€ â€™ OK.
- **Status:** Complete.

### 2026-06-25 Ã¢â‚¬â€ Code review: findings documented
- **What reviewed:** F13 (AI Coaching), F15 (Interview), F16 (Spot the Error + completions), Roster
  CRUD, and the interview consistency fix. Full checklist pass across all 5 API handlers, `server.js`,
  `db.js`, `SpotTheError`, `Interview`, `Coaching`, `MyTraining`, `firestore.rules`.
- **No blocking findings.** Moderate and minor findings documented:
  - **Ã¢â€”â€  Dead import** Ã¢â‚¬â€ `createRequire` imported in `server.js:6` but never used.
  - **Ã¢â€”â€  DRY violation** Ã¢â‚¬â€ `getApiKeys`, `callGemini`, `geminiWithRotation`, and `ROTATABLE` duplicated
    identically across all 5 `api/` handlers. Should be extracted to `api/_gemini-client.js`. The
    `generate-coaching.js` version has richer `authFailures` tracking that the other 4 lack.
  - **Ã¢â€”â€  Zero test coverage** for new features (F13, F15, F16): `SpotTheError`, `Interview`,
    `Coaching`, `MyTraining`, the three new API handlers, and four new `db.js` exports.
  - **Ã¢â€”â€¡ Redundant condition** in `SpotTheError.jsx:157`:
    `if (phase === 'loading' || (phase === 'loading' && genError))` Ã¢â€ â€™ simplifies to
    `if (phase === 'loading')`.
  - **Ã¢â€”â€¡ Prompt injection** Ã¢â‚¬â€ `navigatorAnswer` / `modelExplanation` / `name` inserted verbatim into
    the `coach-audit` Gemini prompt. Output is advisory-only; blast radius = one coaching note
    visible to the attacker only. Low severity for pilot; add length cap + session token before
    production.
- **Recommendation:** ship as-is; address DRY extraction and dead import before the next feature
  cycle; test coverage is the highest unresolved tech debt.
- **No files changed** (findings only Ã¢â‚¬â€ no fixes in this session).

### 2026-06-25 Ã¢â‚¬â€ Premium "refined-light" visual overhaul (design system + motion)
- **What changed:** A non-functional, presentation-layer redesign elevating the app to a polished
  SaaS feel while keeping the warm ivory/clay identity (chosen over a dark theme for trust/fit).
  No business logic, data shapes, or routing changed.
  - **Design tokens (`styles.css` `:root`):** extended palette (surfaces, ink tiers, accent
    strong/deep), an elevation scale (`--shadow-xsÃ¢â‚¬Â¦lg`, `--shadow-glow`, focus `--ring`), gradient
    tokens (`--grad-accent` etc.), glass tokens (`--glass-bg/border/blur`), a radius scale, and
    motion tokens (`--ease-out/spring`, `--dur-1/2/3`). All **existing variable names preserved**
    so the rest of the sheet kept working.
  - **Atmosphere:** layered warm radial mesh on `body`, a slow-drifting ambient glow
    (`body::before`, `ambient-drift`), and an ultra-faint SVG-noise overlay (`body::after`).
  - **Type:** Inter loaded via `index.html` (system-font fallback retained); tighter display scale.
  - **Primitives:** layered `.card` (top-sheen `::before`, `--interactive` lift, `--glass`
    variant), gradient `.btn--primary` with spring press + `:focus-visible` ring, animated
    `.linkbtn` underline, frosted sticky `.nav` with gradient app-mark, elevated dept pills, depth
    on tags/chips/inputs, global input focus rings.
  - **Motion utilities (new, dependency-free):** `src/lib/useInView.js` (IntersectionObserver),
    `src/lib/useCountUp.js` (rAF ease-out), and components `src/components/Reveal.jsx` +
    `CountUp.jsx`. CSS helpers `.reveal/.is-in`, `.view-enter`, `.stagger > *`. **No animation
    library added** (bundle already large; CSS + tiny hooks cover the brief).
  - **Screens:** Start gate (gradient hero, glass role cards w/ icons + hover reveal, staggered
    domain list, skeleton loading state), Matrix (depth pills + cell hover, row hover, live-row
    glow, staggered read-offs), Overview (KPI widgets with **count-up** + accent rail, gradient
    bars), plus `view-enter`/`stagger` entrances on Navigators/NavigatorDetail/Training/MyTraining/
    Coaching/Check/QuestionBank/TrainingModule and a premium `EmptyState` (glyph) + `.skeleton`
    loaders.
  - **A11y/perf:** `prefers-reduced-motion` neutralises animations **and delays**; animations use
    transform/opacity (GPU); color still paired with text labels.
- **Files affected:** new `src/lib/{useInView,useCountUp}.js`, `src/components/{Reveal,CountUp}.jsx`;
  edited `index.html`, `src/styles.css`, and `src/components/{Start,Matrix,Overview,EmptyState,
  NavigatorDetail,Navigators,Training,MyTraining,Coaching,Check,QuestionBank,TrainingModule}.jsx`
  (Nav restyled via CSS only).
  `lib/scoring.js`, data modules, and `scoring.test.js` untouched.
- **Verification:** `npm test` Ã¢â€ â€™ **46 passing**; `npm run build` Ã¢â€ â€™ clean; built app serves 200
  (root + CSS); new tokens/fonts confirmed in the bundle.
- **Status:** Complete (code). Presentation-only; safe to deploy with the rest.

### 2026-06-25 Ã¢â‚¬â€ Roster CRUD: edit, deactivate, reset with confirmation gate
- **What changed:** Filled the CRUD gap in the roster layer Ã¢â‚¬â€ previously navigators could be added
  but not edited, deactivated, or had their result cleared. Explicitly excluded fabricated
  performance editing, permissions, and bulk operations (see Ã‚Â§6 decisions for rationale).
  - **`db.js`:** three new exports Ã¢â‚¬â€ `updateRosterEntry(id, patch)` (name/PIN patch),
    `setRosterStatus(id, 'active'|'inactive')` (soft deactivation), `clearResult(navigatorId)`
    (deletes result so navigator can retake; roster entry untouched).
  - **`Navigators.jsx`:** rewritten. Cards are now `<div>` (not `<button>`) with an explicit "View
    dashboard Ã¢â€ â€™" button inside, removing the invalid button-in-button HTML. Each card gets a
    "Manage" button revealing: **Edit name/PIN** (inline form, pre-filled, dup check excluding self),
    **Reset result** (only if they have a result), and **Deactivate** / **Reactivate**. All
    destructive actions (deactivate, reset, reactivate) require an inline confirmation prompt before
    executing. Inactive navigators shown in a separate "Inactive" section at the bottom of the tab
    with a dashed, de-emphasised card style.
  - **`SupervisorApp.jsx`:** four new handlers (`handleUpdateNavigator`, `handleDeactivateNavigator`,
    `handleReactivateNavigator`, `handleResetResult`). Inactive navigators are now filtered out of
    `activeResults` before `buildMatrixRows` Ã¢â‚¬â€ deactivated team members don't skew floor gaps,
    can-teach tallies, or training cohorts.
  - **`Start.jsx`:** navigator dropdown in the sign-in gate now filters out `status === 'inactive'`
    roster members so deactivated navigators can't sign in.
  - **`styles.css`:** new `.nav-card__footer`, `.nav-card__manage*`, `.nav-card__confirm*`,
    `.nav-card__edit-form`, `.nav-card--inactive`, `.nav-inactive-section*` rules.
- **Design decisions held:** score editing refused (preserves measurement integrity); permissions
  refused (no auth system to back it); bulk actions refused (pilot scale doesn't warrant the risk);
  activity history deferred to the quarter-over-quarter roadmap item.
- **Files affected:** `src/lib/db.js`, `src/components/Navigators.jsx`, `src/components/SupervisorApp.jsx`,
  `src/components/Start.jsx`, `src/styles.css`.
- **Verification:** `npm test` Ã¢â€ â€™ **46 passing**; `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-06-25 Ã¢â‚¬â€ Interview transcripts in supervisor NavigatorDetail
- **What changed:** Supervisors can now read a navigator's practice session transcripts from
  within the navigator's detail panel.
  - **`SupervisorApp.jsx`:** computes `selectedNavigatorId = roster.find(m => m.name === selected)?.id`
    and passes it as `navigatorId` to `<NavigatorDetail>`.
  - **`NavigatorDetail.jsx`:** accepts optional `navigatorId` prop; adds `useState`/`useEffect`
    to fetch `getInterviews(navigatorId)` on mount (sorted newest-first). New "Practice sessions"
    panel renders a collapsible list Ã¢â‚¬â€ domain tag, caller name, response count, date Ã¢â‚¬â€ with
    an expandable transcript view (patient lines left, navigator lines right with accent tint).
    Panel is hidden when `navigatorId` is absent (navigator's own dashboard in `NavigatorApp`).
  - **`styles.css`:** `.interview-log*` rules for the supervisor panel.
- **Files affected:** `src/components/NavigatorDetail.jsx`, `src/components/SupervisorApp.jsx`,
  `src/styles.css`.
- **Verification:** `npm test` Ã¢â€ â€™ 46 passing; `npm run build` Ã¢â€ â€™ clean.
- **Status:** Complete.

### 2026-06-25 Ã¢â‚¬â€ AI interview simulation: roleplay phase
- **What changed:** Navigators can now practice handling a patient call in the "Practice" tab.
  Gemini acts as a patient caller Ã¢â‚¬â€ the navigator types responses turn by turn, and Gemini stays
  in character using a `system_instruction` seeded with the caller's scenario and SOP context.
  - **New file:** `api/interview-turn.js` Ã¢â‚¬â€ two-mode handler: init call generates a scenario +
    opening line via structured JSON schema (temperature 0.9 for variety); subsequent turn calls
    reconstruct the full conversation history into Gemini's alternating `user`/`model` format
    (with a synthetic `BEGIN_CALL` seed turn so the patient opens the call) and continue as the
    patient at temperature 0.8.
  - **`server.js`:** new `POST /api/interview-turn` route.
  - **`src/components/Interview.jsx`:** setup Ã¢â€ â€™ loading Ã¢â€ â€™ active (chat bubbles, typing-dots
    animation, auto-scroll, 20 s AbortController timeout per call) Ã¢â€ â€™ saving Ã¢â€ â€™ done. Transcript
    saved to Firestore on "End call"; non-blocking (failure doesn't block the done screen).
  - **`src/lib/db.js`:** `saveInterview` and `getInterviews` added; `INTERVIEWS` collection
    constant; header comment updated to reflect all four collections.
  - **`src/components/Nav.jsx`:** "Practice" tab added for navigator role.
  - **`src/components/NavigatorApp.jsx`:** `Interview` imported; `interview` view wired in.
  - **`src/styles.css`:** full chat UI Ã¢â‚¬â€ setup domain grid, header card, scrollable chat window,
    patient/navigator bubbles (different alignment + colors), typing-dot animation,
    input row, done screen.
- **Design decision:** Open-answer scores are advisory only and do not feed the capability matrix.
  Phase 2 (criterion-based grading + supervisor override) is planned but not yet built Ã¢â‚¬â€ the
  roleplay phase ships first as the high-value, low-risk piece.
- **Files affected:** new `api/interview-turn.js`, `src/components/Interview.jsx`; edited
  `server.js`, `src/lib/db.js`, `src/components/{Nav,NavigatorApp}.jsx`, `src/styles.css`.
- **Verification:** `npm test` Ã¢â€ â€™ 46 passing; `npm run build` Ã¢â€ â€™ clean; `node --check
  api/interview-turn.js` Ã¢â€ â€™ OK.
- **Status:** Complete (roleplay only).

### 2026-06-25 Ã¢â‚¬â€ "Spot the Error" QA audit training + completion tracking (F16)
- **What changed:** Added the "Flight Simulator" QA audit exercise to the training section.
  Navigators read an AI-generated flawed agent transcript, click the error message, write a
  reflection, receive AI coaching, and earn a completion badge. Supervisors see "Ã¢Å“â€œ Practiced"
  badges on the training dashboard and navigator detail panels.
  - **New API files:** `api/generate-audit.js` (Gemini generates flawed transcript + errorIndex +
    hint + modelExplanation via structured JSON schema, temp 0.8); `api/coach-audit.js` (Gemini
    coaches the navigator's written reflection, temp 0.4 Ã¢â‚¬â€ advisory only, never blocks).
  - **New component:** `src/components/SpotTheError.jsx` Ã¢â‚¬â€ 7-phase flow with shake animation on
    wrong clicks, hint reveal, reflection textarea, AI coaching skeleton, model-answer reveal,
    and non-blocking Firestore save.
  - **New Firestore collection:** `completions` Ã¢â‚¬â€ `{ navigatorId, name, domainId, completedAt }`.
    `db.js` gained `saveCompletion`, `getCompletions`, `subscribeCompletions`.
  - **`server.js`:** two new POST routes (`/api/generate-audit`, `/api/coach-audit`).
  - **`firestore.rules`:** `completions` + `interviews` collections added (both `allow read, write: if true`).
  - **`MyTraining.jsx`:** rewritten to accept `onStartAudit` + `completedDomains`; each training
    item now has "Practice Scenario" / "Practice again" button + "Ã¢Å“â€œ Practiced" badge.
  - **`NavigatorApp.jsx`:** `SpotTheError` imported + `audit` view wired; `getCompletions` fetched
    on mount; `handleAuditComplete` updates local `completedDomains` Set immediately on done.
  - **`SupervisorApp.jsx`:** `subscribeCompletions` live subscription added; `completionMap`
    derived; passed to `Training` (with `roster`) and `NavigatorDetail`.
  - **`Training.jsx`:** `completionMap` + `roster` props; `hasPracticed(name, domainId)` helper;
    "Ã¢Å“â€œ Practiced" badge in by-navigator assignments.
  - **`NavigatorDetail.jsx`:** `completedDomains` prop; badge in "Assigned training" panel.
  - **`styles.css`:** full SpotTheError UI (transcript bubbles, shake animation, hint box, reflect
    panel, coaching panel, model-answer block, done screen); practiced badges.
- **Verification:** `npm test` Ã¢â€ â€™ 46 passing; `npm run build` Ã¢â€ â€™ clean; `node --check` on both new
  API files Ã¢â€ â€™ OK.
- **Status:** Complete.

### 2026-06-25 Ã¢â‚¬â€ Generative AI coaching (Phase 2, first feature)
- **What changed:** Added a second coaching layer that runs Gemini asynchronously after a navigator
  submits a check Ã¢â‚¬â€ producing a 2Ã¢â‚¬â€œ3 sentence personalised coaching note per weak competency, grounded
  in the authored option rationales (not free-form SOP knowledge). The rule-based layer is unchanged
  and always present as the baseline/fallback.
  - **New file:** `api/generate-coaching.js` Ã¢â‚¬â€ Gemini proxy (same key rotation + `SUPERVISOR_PASSCODE`
    gate as `generate-scenarios`). Builds a concise digest of only the missed/partial questions with
    their chosen rationale vs best rationale as grounding context. Calls `gemini-2.5-flash` at
    temperature 0.4. Validates output: only known competency IDs with non-empty strings kept. Returns
    `{ coaching: { [compId]: "note" } }`. Advisory only Ã¢â‚¬â€ never writes to Firestore or affects scores.
  - **`server.js`:** new `POST /api/generate-coaching` route.
  - **`Coaching.jsx`:** fires the fetch on mount; shows an `AI`-badged skeleton card while loading;
    renders coaching notes (one item per weak competency, accent-rail style) above the per-question
    review when ready; silently omits the section if the call fails or returns empty.
  - **`styles.css`:** new `.coaching__ai*` rules (badge, skeleton, list, item, comp label, note).
- **Files affected:** new `api/generate-coaching.js`; edited `server.js`, `src/components/Coaching.jsx`,
  `src/styles.css`.
- **Verification:** `npm test` Ã¢â€ â€™ **46 passing**; `npm run build` Ã¢â€ â€™ clean; `node --check
  api/generate-coaching.js` Ã¢â€ â€™ OK; `node --check server.js` Ã¢â€ â€™ OK.
- **Status:** Complete. Deploys on next push to `main`.

### 2026-06-28 Ã¢â‚¬â€ Branding integration: Logo and favicon *(logo reverted 2026-06-29)*
- **What changed:** Added a favicon (`public/favicon.png`) + logo (`public/logo.png`) for the
  Cruciby branding. Favicon link added to `index.html`; logo `<img>` tags added to `Nav.jsx` and
  `Start.jsx`; `@keyframes logo-float` + `.start__logo`/`.nav__logo` CSS added to `styles.css`.
- **Status:** Partially reverted 2026-06-29 Ã¢â‚¬â€ favicon retained; logo `<img>` tags removed from
  Nav.jsx and Start.jsx; `public/logo.png` and the float CSS remain in the repo (orphaned).




