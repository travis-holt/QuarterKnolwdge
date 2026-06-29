---
name: pattern-discovery
description: Discover existing patterns, utilities, and conventions before writing new code for Knowledge Check. Use before adding any function, component, hook, or API endpoint to check if it already exists.
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash
---

# Pattern Discovery — Knowledge Check

## When This Skill Applies

Always invoke before:
- Writing a new function (especially in scoring.js)
- Creating a new component
- Adding a new API endpoint
- Adding a Firestore collection or db.js export
- Adding client-side fetch logic

**The first question is always: does this already exist?**

## Discovery Workflow

### Step 1: Check the Module That Owns This Concern

| Concern | Owner | Check |
|---|---|---|
| Scoring/analytics logic | `src/lib/scoring.js` | Read exports list |
| Firestore reads/writes | `src/lib/db.js` | Read API at top of file |
| Session state | `src/lib/session.js` | Read exports |
| Client API calls | `src/lib/apiFetch.js` | Read the helper |
| Domain/competency data | `src/data/config.js`, `questions.js`, `competencies.js` | Read exports |
| Training data | `src/data/training.js` | Read `moduleForDomain()` |
| Department logic | `src/data/departments.js` | Read `isAssessed()`, `ASSESSED_DEPTS` |
| Gemini calls (server) | `api/_gemini-client.js` | Read `geminiWithRotation` |
| Secret validation | `api/_auth.js` | Read `validateSecret()` |

### Step 2: Grep for the Pattern

```bash
# Is there already a function for this?
grep -r "functionNameOrConcept" src/ api/ --include="*.js" --include="*.jsx"

# Is there already a CSS class for this?
grep -r "class-name-concept" src/styles.css

# Is there already a Firestore collection for this?
grep -r "collection(" src/lib/db.js
```

### Step 3: Check Test Files for Intent

Test files reveal the intended API of modules:

```bash
grep -r "describe\|it(\|test(" src/lib/scoring.test.js | head -30
```

## Key Existing Patterns (don't re-implement)

### Already in scoring.js
- `scoreToLevel(pct)` — converts a percentage to `'learning'|'solid'|'canTeach'`
- `levelFor(pct)` — full level descriptor object
- `buildMatrixRows(samples, liveResult)` — constructs the matrix
- `domainDistribution(rows)`, `competencyDistribution(rows)` — analytics aggregations
- `mentorSuggestions(rows, name)` — finds Can-Teach matches per domain
- `trainingForRow(row)`, `trainingPlan(rows)` — auto-assign training
- `computeQuestionHealth(questions, results)` — SOP drift detection
- `columnGaps(rows)`, `canTeachRoster(rows)`, `readinessTally(rows)` — read-offs

### Already in db.js
- All Firestore CRUD for: `roster`, `results`, `questions`, `interviews`, `completions`
- Composite key pattern: `${navigatorId}__${department}` for results
- `subscribeX(cb, onError?)` pattern for live subscriptions

### Already in apiFetch.js
- AbortController timeout, SUPERVISOR_PASSCODE injection, Content-Type — use this for all `/api` calls from components

### Already in _gemini-client.js
- `geminiWithRotation(keys, body, {label})` — key rotation, 429 handling, structured output
- Use this for all new Gemini endpoint handlers

### Already in _auth.js
- `validateSecret(req, res)` — validates request secret against `GENERATION_SECRET || SUPERVISOR_PASSCODE`

## If a Pattern Doesn't Exist

Only then write it. Placement rules:
- Pure scoring/analytics logic → `src/lib/scoring.js` + test in `scoring.test.js`
- Firestore operation → `src/lib/db.js`
- Shared server-side Gemini logic → `api/_gemini-client.js`
- React hook → `src/lib/useX.js`
- Reusable display component → `src/components/`
- Domain data → `src/data/`
