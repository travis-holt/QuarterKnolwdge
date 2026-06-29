---
name: senior-developer
description: Engineering judgment framework for architectural decisions, trade-off evaluation, code quality standards, and knowing when to ask vs proceed. Use when making design decisions, evaluating approaches, or assessing thoroughness.
metadata:
  version: "1.0.0"
---

# Senior Developer Guidelines

> **Engineering judgment → thoughtful decisions → quality code.**

## `<when_to_use>`
* Making architectural or design decisions
* Evaluating trade-offs between approaches
* Determining appropriate level of thoroughness
* Assessing when code needs refactoring
* Deciding when to ask vs proceed independently
* Balancing speed, quality, and maintainability

**NOT for:** mechanical tasks, clear-cut decisions, following explicit instructions
`</when_to_use>`

---

## Core Engineering Judgment Framework

### User Preferences Trump Defaults
`CLAUDE.md`, project rules, and existing patterns always override skill suggestions. Read them first.

### Simplest Thing That Works
Start with a straightforward solution. Add complexity only when requirements demand it.
* Boring solutions for boring problems
* Proven libraries over custom implementations
* Progressive enhancement over big rewrites

### Read Before Write
Understand existing codebase patterns before modifying.
* Check how similar features are implemented
* Follow established conventions
* Maintain consistency with surrounding code

### Small, Focused Changes
One idea per commit, typically 20–100 effective LOC, touching 1–5 files.
* Easy to review and understand
* Lower risk of introducing bugs
* Simpler to revert if needed
* Faster feedback cycles

### Security Awareness
Don't introduce vulnerabilities through careless implementation.
* Validate all external input
* Use parameterized queries
* Handle authentication/authorization properly
* No secrets in code or logs
* Consider attack vectors

### Know When to Stop
Ship working code, don't gold-plate.
* Implement requirements, not assumptions
* No unrequested features
* No speculative abstraction
* Refactor when needed, not preemptively

---

## `<type_safety>`
*Type safety principles that apply across languages.*

### Make Illegal States Unrepresentable
The type system should prevent invalid data at compile time, not runtime.

**Type safety hierarchy:**
1. **Correct** — type-safe, no runtime type errors
2. **Clear** — self-documenting through types
3. **Precise** — exact types, not overly broad

### Parse, Don't Validate
Transform untyped data into typed data at system boundaries. Once parsed into a type, trust the type throughout.

### Result Types Over Exceptions
Make errors explicit in function signatures. Don't hide failures in thrown exceptions.

### Discriminated Unions for State
Model mutually exclusive states as union types with a discriminator field.

### Runtime Validation at Boundaries
External data (APIs, files, user input) enters untyped. Validate and parse at the boundary, then work with typed data internally.

`</type_safety>`

---

## `<decision_framework>`

### Understand Before Deciding
* What problem is being solved?
* What constraints exist? (time, tech, team)
* What's already in the codebase?
* What patterns does the project use?

### Consider Trade-offs
No perfect solutions, only trade-offs:
* Speed vs robustness
* Simplicity vs flexibility
* Consistency vs optimization
* Time to implement vs time to maintain

### Recognize Good-Enough
* Does it meet requirements?
* Is it maintainable by the team?
* Is it tested adequately?
* Can it be improved incrementally?
* **If yes to all — ship it.**

### Document Significant Choices
When making non-obvious decisions: comment **why**, note trade-offs, flag assumptions.

`</decision_framework>`

---

## `<when_to_ask>`

### Proceed independently when:
* Task is clear and well-defined
* Approach follows existing patterns
* Changes are small and localized
* No security or data integrity risks

### Ask questions when:
* Requirements are ambiguous or incomplete
* Multiple approaches with unclear trade-offs
* Changes affect system architecture
* Security or compliance implications
* Unfamiliar domain or technology

### Escalate immediately when:
* Security vulnerabilities discovered
* Data corruption or loss risk
* Breaking changes to public APIs
* Compliance violations possible

**Don't guess on high-stakes decisions. Ask.**

`</when_to_ask>`

---

## `<code_quality>`

### Error Handling
Every error path needs handling — make failures explicit, don't swallow errors silently.

### Naming
* **Functions:** verbs (`calculateTotal`, `validateEmail`)
* **Variables:** nouns (`userId`, `orderTotal`)
* **Booleans:** questions (`isValid`, `hasPermission`)
* **Constants:** `SCREAMING_SNAKE_CASE`

### Function Design
* Single responsibility, focused scope
* 10–30 lines typical, max 50
* 3 parameters ideal, max 5
* Pure when possible

### Comments
Explain **why**, not what. If the name explains it, don't add a comment.

`</code_quality>`

---

## Refactoring

### Refactor when:
* Adding a feature reveals poor structure
* Code duplicated 3+ times
* Function exceeds 50 lines
* Tests are difficult to write
* Bug pattern is repeating

### Don't refactor when:
* Code works and won't be touched again
* Time-critical delivery in progress
* No test coverage to verify behavior
* It's scope creep from the main task

### Guidelines:
* Have tests first (or write them)
* One refactoring at a time
* Keep tests passing throughout
* Commit refactors separately from features — never mix

---

## Testing Philosophy

### Test the right things:
* Public interfaces, not implementation
* Edge cases and error paths
* Critical business logic
* Integration points

### Don't over-test:
* No tests for trivial getters/setters
* Don't test framework behavior
* Avoid brittle tests coupled to implementation

### Coverage targets:
* Critical paths: **90%+**
* Business logic: **80%+**
* Overall project: **70%+**

---

## `<anti_patterns>`

* **Over-engineering:** Building features "we might need", premature abstraction. *Fix: YAGNI.*
* **Under-engineering:** No error handling, no input validation, copy-paste instead of function. *Fix: Basic quality standards aren't optional.*
* **Scope creep:** "While I'm here, let me also…" *Fix: Stay focused. File issues for unrelated improvements.*
* **Guess-and-check:** Trying random solutions without understanding root cause. *Fix: Systematic debugging.*
* **Analysis paralysis:** Endless design discussions, waiting for perfect solution. *Fix: Good enough + shipped > perfect + delayed.*

`</anti_patterns>`

---

## 🚨 Golden Rules

### ALWAYS
✅ Read `CLAUDE.md` and project rules first
✅ Follow existing codebase patterns
✅ Make small, focused changes
✅ Validate external input
✅ Handle errors explicitly
✅ Test critical paths
✅ Ask when uncertain on high-stakes issues

### NEVER
❌ Add features not in requirements
❌ Ignore error handling
❌ Skip input validation
❌ Commit secrets or credentials
❌ Guess on security decisions
❌ Refactor without tests
❌ Optimize without measuring
❌ Over-engineer simple solutions
