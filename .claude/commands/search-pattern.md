---
description: Search for code patterns across the Knowledge Check codebase
argument-hint: <pattern> [file-extension]
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

Search the codebase for a pattern. Useful before refactoring, before adding something that might already exist, or understanding usage.

## Usage

```
/search-pattern "scorePerDomain"        # find all callers
/search-pattern "useEffect" jsx         # hooks in components
/search-pattern "DOMAINS" js            # where the domain list is used
```

## Workflow

### 1. Parse Arguments
- `$1` = pattern (required)
- `$2` = file extension filter (optional: `js`, `jsx`, `css`, `md`)

### 2. Execute Search

Use the Grep tool:

| Scenario | Parameters |
|---|---|
| With extension filter | `pattern=$1, type=$2, output_mode="files_with_matches"` |
| No filter | `pattern=$1, output_mode="content", head_limit=50` |
| With context | `pattern=$1, output_mode="content"` with `-C 3` |

### 3. Useful Patterns for This Project

**Find where a domain ID is used:**
```
/search-pattern "domainId" jsx
```

**Find all Firestore writes (before adding a new one):**
```
/search-pattern "setDoc|updateDoc|addDoc" js
```

**Find all api/ callers from the client:**
```
/search-pattern "apiFetch\|/api/" jsx
```

**Find scoring function callers:**
```
/search-pattern "scorePerDomain\|scorePerCompetency\|buildMatrixRows" jsx
```

**Find CSS variable usage:**
```
/search-pattern "var(--" css
```

**Find environment variable usage:**
```
/search-pattern "VITE_\|process\.env" js
```

**Find TODO/FIXME markers:**
```
/search-pattern "TODO|FIXME|HACK|ponytail:"
```

### 4. Analyze Results

Report:
- Total files and matches
- Usage patterns noticed
- Whether what you're about to add already exists somewhere
- Refactoring opportunities if relevant

## Success Criteria
- ✅ Pattern located and usage understood
- ✅ "Does this already exist?" answered before writing new code
