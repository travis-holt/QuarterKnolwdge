---
name: testing-patterns
description: Testing patterns for Knowledge Check — Vitest setup, mocking Firebase, component testing, when to write tests and what to test. Use when adding tests or when code changes require test updates.
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash
---

# Testing Patterns — Knowledge Check

## Test Stack

- **Runner**: Vitest 4 (requires Node 20+)
- **Components**: `@testing-library/react` + `@testing-library/jest-dom` + `jsdom`
- **Setup file**: `src/test-setup.js` (jest-dom extension + `afterEach(cleanup)`)
- **Run**: `npm test` (one-shot), `npm run test:watch` (interactive)

## When to Write a Test

**Write a test when**:
- New pure function in `scoring.js` (all exports are tested)
- New `db.js` export
- New API handler pure-function export (e.g., `validateAuditResponse`)
- New stateful component behaviour (not just render)
- A bug is fixed — add the regression test first

**Skip tests (YAGNI) when**:
- Trivial one-liner (a rename, a constant)
- Pure render with no logic or branching
- Config data changes

## File Placement

| What you're testing | Test file |
|---|---|
| `src/lib/scoring.js` | `src/lib/scoring.test.js` |
| `src/lib/session.js` | `src/lib/session.test.js` |
| `src/lib/db.js` | `src/lib/db.test.js` |
| `api/*.js` pure exports | `api/api-handlers.test.js` or `api/<handler>.test.js` |
| `src/components/*.jsx` | `src/components/components.test.jsx` |

## Pure Function Tests (scoring.js pattern)

```js
import { describe, it, expect } from 'vitest';
import { scorePerDomain, scoreToLevel } from './scoring.js';
import { DOMAINS, SEED_QUESTIONS } from '../data/questions.js';
import { THRESHOLDS } from '../data/config.js';

describe('scorePerDomain', () => {
  it('returns 100 for all-correct answers', () => {
    const answers = Object.fromEntries(
      SEED_QUESTIONS.filter(q => q.department === 'pediatrics')
        .map(q => [q.id, q.correctOptionId])
    );
    const scores = scorePerDomain(answers, SEED_QUESTIONS);
    Object.values(scores).forEach(pct => expect(pct).toBe(100));
  });

  it('defaults answers to {} without crashing', () => {
    expect(() => scorePerDomain(undefined, SEED_QUESTIONS)).not.toThrow();
  });
});
```

**Key pattern**: test relative to `THRESHOLDS`, not hard-coded numbers — the tests survive config changes.

## Firestore Mocking (db.test.js pattern)

```js
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Must use vi.hoisted() — Firebase imports must be mocked before module load
const mockSetDoc = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetDoc = vi.hoisted(() => vi.fn());

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(() => 'mock-collection'),
  doc: vi.fn((_db, _col, id) => ({ id })),
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
  // ... other methods used by db.js
}));

vi.mock('../lib/firebase.js', () => ({
  db: {},
  isFirebaseConfigured: true,
}));
```

## Component Tests (jsdom pattern)

```js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './EmptyState.jsx';

describe('EmptyState', () => {
  it('renders the message', () => {
    render(<EmptyState message="No data yet" />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });
});
```

The `// @vitest-environment jsdom` pragma is required — don't forget it.

## API Handler Tests (pure export pattern)

Handlers export their internal pure functions for testability:

```js
// In api/generate-audit.js
export function validateAuditResponse(parsed) { ... }

// In api/generate-audit.test.js
import { validateAuditResponse } from './generate-audit.js';

describe('validateAuditResponse', () => {
  it('accepts valid shape', () => {
    const valid = { transcript: [...], errorIndex: 2, hint: '...', modelExplanation: '...' };
    expect(validateAuditResponse(valid)).toEqual({ data: valid });
  });
  it('rejects missing transcript', () => {
    expect(validateAuditResponse({})).toMatchObject({ error: expect.any(String) });
  });
});
```

## Running Tests

```bash
npm test                    # all tests, CI mode
npm run test:watch          # watch mode for development
npx vitest run src/lib/scoring.test.js   # single file
```

Current count: **158 tests across 7 files**. Never let this go red before committing.
