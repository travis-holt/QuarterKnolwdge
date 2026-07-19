from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Expected patch anchor not found in {path}: {old[:120]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


supervisor = ROOT / 'src/components/SupervisorApp.jsx'
replace_once(
    supervisor,
    "} from '../lib/db.js';\nimport { isFirebaseConfigured } from '../lib/firebase.js';",
    "} from '../lib/db.js';\nimport { runObgynCurrentFloorBankMigration } from '../lib/obgynCurrentFloorBankMigration.js';\nimport { isFirebaseConfigured } from '../lib/firebase.js';",
)
replace_once(
    supervisor,
    "    // Ordered so a fresh DB seeds first, then has its weak seed/generated content\n    // archived and replaced by the operating-model v2 bank. Both migrations are\n    // marker-gated and run once; the live subscription reflects each write.",
    "    // Ordered so a fresh DB seeds first, then receives the operating-model v2\n    // baseline, and finally replaces only the OB/GYN half with the current-floor\n    // v3 MCQ + curated audit banks. Every migration is marker-gated and preserves\n    // archived/manual history; the live subscriptions reflect each write.",
)
replace_once(
    supervisor,
    "      await runMcqV2OperatingModelMigration();",
    "      await runMcqV2OperatingModelMigration();\n      await runObgynCurrentFloorBankMigration();",
)

claude = ROOT / 'CLAUDE.md'
replace_once(
    claude,
    '> **Last updated:** 2026-07-19 (',
    "> **Last updated:** 2026-07-19 (OB/GYN current-floor assessment bank v3 — the owner-confirmed Women's Health SOP v1.0 now drives a curated 24-item MCQ bank and 30-item Spot-the-Error bank; all 24 executable workflow rules and all 14 audit workflow types are covered; a marker-gated migration archives stale active non-manual OB/GYN content without deleting history or touching Pediatrics/manual drafts; exact SOP/rule/source provenance and deterministic one-Agent-error guards are enforced by tests) ·\n> **Prior same-day update:** 2026-07-19 (",
)
replace_once(
    claude,
    '### F14 — Question Bank + Gemini Scenario Generation (review gate)\n',
    "### F14 — Question Bank + Gemini Scenario Generation (review gate)\n- **Current-floor OB/GYN bank v3 (2026-07-19):** `src/data/questions-obgyn-current-floor-v3.js` provides 24 challenging, chart-first MCQs (4 per domain) pinned to `obgyn-current-floor-2026-07-17`, covering all 24 executable rules. `runObgynCurrentFloorBankMigration()` non-destructively archives stale active non-manual OB/GYN questions and activates the stable v3 IDs; Pediatrics, drafts, manual items, and archived history are preserved.\n",
)
replace_once(
    claude,
    '### F16 — "Spot the Error" QA Audit Assessment\n',
    "### F16 — \"Spot the Error\" QA Audit Assessment\n- **Curated current-floor OB/GYN bank v3 (2026-07-19):** 30 pre-authored audits (5 per domain) cover every one of the 14 existing OB/GYN audit workflow types. Each expands to exactly 10 alternating turns, carries current SOP/rule/source provenance, and has one context-verifiable Agent error; the same marker migration archives stale active non-manual OB/GYN audits and activates these stable IDs.\n",
)

history = ROOT / 'docs/HISTORY.md'
text = history.read_text(encoding='utf-8')
entry = """## 2026-07-19 — OB/GYN current-floor assessment bank v3

- Replaced the stale OB/GYN half of the MCQ bank with **24 challenging current-floor scenarios** (4 per domain), authored against the owner-confirmed Women's Health Patient Navigator SOP v1.0 effective 2026-07-17. The bank covers all 24 executable OB/GYN rules and removes old PSS OB/PSS Queue routing, navigator lab scheduling, forced Confirmation for reliable LMP, and other legacy assumptions.
- Added a **30-item curated Spot-the-Error bank** (5 per domain) covering all 14 OB/GYN audit workflow types. Every transcript has exactly 10 alternating turns, one indexed deterministic Agent violation, realistic chart facts, and exact SOP/rule/source provenance.
- Added `runObgynCurrentFloorBankMigration()`: a marker-gated, non-destructive Firestore migration that archives stale active **non-manual OB/GYN** questions and audits, upserts the v3 stable IDs as active, and preserves Pediatrics, drafts, supervisor-authored content, and all archived history.
- Wired the migration after seed/content-quality/MCQ-v2 initialization in `SupervisorApp`, avoiding a race with the older v2 migration.
- Added regression tests for balance, partial-credit scoring shape, all-rule coverage, all-workflow coverage, deterministic exactly-one-error validation, stale-rule absence, provenance, and archive-preservation planning.
- No direct production Firestore write or deployment was performed by this code change; the marker migration runs through the authenticated supervisor initialization path after merge/deploy.

"""
if entry.splitlines()[0] not in text:
    if text.startswith('# '):
        split = text.find('\n\n')
        if split == -1:
            raise SystemExit('Could not locate HISTORY title separator')
        text = text[:split + 2] + entry + text[split + 2:]
    else:
        text = entry + text
    history.write_text(text, encoding='utf-8')

# One-shot workflow cleanup. These files are removed in the same tested commit.
(ROOT / 'scripts/apply-obgyn-current-floor-bank-v3.py').unlink(missing_ok=True)
(ROOT / '.github/workflows/apply-obgyn-current-floor-bank-v3.yml').unlink(missing_ok=True)
