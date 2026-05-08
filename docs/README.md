# Research context

Background docs carried over from the in-codebase validation that produced
this library. They explain *why* the selector API exists, what alternatives
were rejected, what the perf numbers actually look like, and what shape the
production migration takes.

Most of these reference each other via `parent:` frontmatter — filenames are
preserved from the source repo so the cross-links keep working.

## START HERE

- **`DECISION.md`** — the canonical record of what we're building and why.
  Settles the open questions left by the research below (selector-leaf vs
  selector-icu, parser choice, performance envelope, what's deliberately
  out of scope for v1). **Read this first.** Everything else is supporting
  evidence.

## The pitch

- **`selector-api-pitch.html`** — the single-page case for the API. Hero
  numbers, before/after, decisions, rollout. Open in a browser.
- **`perf-delta.svg`** / **`perf-delta.png`** — the chart used in the pitch.

## Foundational decisions

- **`as-message-key-selector-api-requirements.md`** — the original problem
  frame. What the recursive `MessageKeys<NestedKeyOf<>>` type was costing,
  the alternatives explored (codegen, library swap, type compression), and
  why selector-API won.
- **`as-message-key-selector-api-perf-analysis.md`** — the standalone
  testbed measurements that justified the choice. Reproducible repo:
  https://github.com/blessanm86/typescript-go-ts2590

## Implementation spec

- **`selector-api-handoff.md`** — the scoped implementation spec
  (what exactly to build, the hook surface, the type contracts).
- **`selector-api-validation.md`** — Phase 1 validation scope. What had to
  be proved on real data before committing to a migration.
- **`validation-plan-detailed.md`** — the step-by-step validation plan
  (U1–U9). Useful as a template for the next validation pass.

## Validation evidence

- **`selector-api-validation-findings.md`** — what worked, what didn't,
  every API gap that surfaced during the port.
- **`selector-api-validation-perf.md`** — measured perf delta from porting
  8 files (`-14.8%` project-wide tsgo Check time, 5-run averages).

## Prior art

- **`i18next-comparison-research.md`** — comparison with i18next's
  TypeScript Selector API (the closest existing prior art) plus
  per-feature parity notes.

## Production migration patterns (Dash0-specific examples)

Real-world examples from the source repo. Useful as reference for what a
migration actually looks like, not as instructions for users of this
library.

- **`dynamic-key-audit.md`** — every site in a real codebase where the
  translation key is built at runtime, bucketed by treatment
  (restructurable, genuinely runtime, test fixture).
- **`legacy-cleanup-audit.md`** — symbol-by-symbol audit of the deprecated
  helpers + types that get deleted alongside the migration. Includes
  sequencing (pre-flight PR vs migration PR vs follow-up).

---

## Suggested reading order

1. **`DECISION.md`** — the canonical record (what we're building, what
   we ruled out, performance envelope, principles for v1)
2. `selector-api-pitch.html` — for the elevator pitch
3. `as-message-key-selector-api-requirements.md` — for the *why*
4. `selector-api-handoff.md` — for the *what to build*
5. `selector-api-validation-findings.md` — for the *gotchas*
6. Everything else as reference
