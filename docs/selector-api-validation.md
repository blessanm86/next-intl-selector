---
date: 2026-04-29
topic: selector-api-validation
parent: selector-api-handoff.md
---

# Selector-API translator: Phase 1 — validation

This doc scopes the **validation phase** that precedes any migration. The goal is to prove the spike's selector API actually handles every translation shape the codebase uses today — and to confirm the testbed's perf numbers hold on real `en.json` data — before committing to a 327-callsite migration.

The decision phase (selector-leaf vs codegen vs library swap) is settled in `as-message-key-selector-api-requirements.md` and the perf testbed. This phase only validates **runtime + ergonomic** fitness against real call sites.

Migration planning is **explicitly out of scope here**. After validation lands, a separate brainstorm captures whatever the findings change, and `/ce-plan` produces the migration plan from that.

---

## Phase 1 deliverable

A single validation PR that:

1. Lands the spike (popped from `stash@{0}`) at `components/ui/src/lib/i18n-selector/`.
2. Closes the four API gaps so the new shape covers everything `next-intl` exposes today (see § API gaps).
3. Ports a small, deliberate set of files (slice + stragglers) to the new API. Existing string-keyed `useTranslations` callers everywhere else are untouched — the two APIs coexist for the duration.
4. Measures TypeScript performance before/after on the ported files (see § Perf protocol).
5. Produces two findings docs: `selector-api-validation-findings.md` and `selector-api-validation-perf.md`.

The PR itself is the validation artefact. After review, the team decides whether to greenlight the migration plan, iterate on the API, or change direction.

---

## API gaps to close before porting

The spike covers `t(selector, values)` only. These are net-new and must be designed before the slice can be ported:

- **G1.** `t.rich(selector, tags)` — JSX-returning translation. 60+ callers in the codebase; the slice must include at least one.
- **G2.** `t.markup(selector, tags)` — string-returning rich variant.
- **G3.** `t.has(selector)` — existence check. Replaces `useIsAsMessageKey`.
- **G4.** Module-scope translator: `createMessageTranslator(...)` wrapping `next-intl`'s `createTranslator`. For `lib/intl/metadata.ts` and any future server-side use.
- **G5.** Object-returning sibling hook: `useMessageObjectT()` returning `<T>(s: (m: IntlMessages) => T) => T`. Replaces `useTranslationsObject<T>`. Decided as **separate hook** (option A) — mirrors next-intl's factoring and is independently lint-restrictable.

Plus an opt-in eslint rule (off by default, on inside the validation slice only): `no-restricted-imports` for `useTranslations` / `getTranslations` from `next-intl`. Confirms the validation slice has no escape hatches into the old API.

---

## Slice

Two files, both empirically chosen — they're the only files in `src/` that PR #11751 (tsgo migration) had to patch around `AsMessageKey` TS2590 errors:

- `components/ui/src/infrastructure/gcp/shared/gcp-resource-detail-page.tsx` — deps-array workaround (`as string` casts + `eslint-disable react-hooks/use-memo, react-hooks/exhaustive-deps`).
- `components/ui/src/lib/utils/i18n.test.ts` — assertion-tuple workaround (element-by-element instead of `toEqual([msg, values])`).

Porting these proves the new API removes the workarounds and makes tsgo stop complaining at the two known sites.

## Stragglers

Six files chosen so the validation exercises every uncovered surface and every i18n deprecation:

- `components/ui/src/lib/intl/metadata.ts` — `createTranslator` + `StringLiteral<AsMessageKey>` + `// @ts-expect-error`. Validates G4.
- `components/ui/src/components/commands/command-palette-view.tsx` — uses `useTranslationsObject`, `getTranslationProps`, and an `AsMessageKey` cast. Single straggler hits three deprecations.
- `components/ui/src/components/ui/table/table-definition/use-get-column-label.ts` — the only `useIsAsMessageKey` caller. Validates G3.
- `components/ui/src/components/ui/table/types.ts` — translation-prop pattern: `label?: StringLiteral<AsMessageKey> | HardCodedLabel`. Tests `MessageSelector` as a prop type.
- One `t.rich`-heavy file (TBD during step 1; candidate: `subscription-active.tsx`, 4 `t.rich` calls). Validates G1.
- One server-side `getTranslations` caller, e.g. `app/(core)/(logs)/logs/no-signals/layout.tsx`. Validates G4 in a server context. Note: this file uses `getTranslations("Logs")` with a namespace; check whether the existing `dash0/use-translations-no-namespace` lint rule covers `getTranslations` or only `useTranslations` — flag in findings if not.

Total: 8 files. Manual review tractable.

---

## Perf measurement protocol

Run before *and* after the port, capture the diff in the perf findings doc. Three layers:

**Per-file traces** (the 8 ported files):
- `pnpm exec tsc --generateTrace .traces/before/<file> --noEmit` and same for `after/`.
- Compare instantiations + check time per file.

**Project-wide** (whole `components/ui` typecheck):
- `pnpm exec tsc --noEmit --extendedDiagnostics` and `pnpm exec tsgo --noEmit --extendedDiagnostics`.
- 3 cold runs each, median, both compilers, both before/after.
- Capture: Total time, Check time, Types, Instantiations, Memory peak, TS2590 count.
- Project-wide improvement is bounded by the small port footprint — read it as trend signal, not the migration's expected payoff.

**Spot-check on the GCP detail page**:
- One `--generateTrace` flame before vs after. Confirm `useTranslations` is no longer a hot symbol on real data, matching the testbed prediction.

Output: `docs/brainstorms/selector-api-validation-perf.md` with the four numbers (per-file × tsc/tsgo × before/after) plus the trace screenshot.

---

## Deprecation coverage

What this validation phase actually addresses, and what it explicitly does not:

| Symbol | Location | Addressed by validation? |
|---|---|---|
| `AsMessageKey` | `types/i18n.ts` | ✅ ported sites stop using it |
| `AsNamespacedMessageKey` | `types/i18n.ts` | ✅ already lint-banned, ported sites are namespace-free |
| `AsMessageKeyWithValues` + `getTranslationProps` | `lib/utils/i18n.ts` | ✅ ported via `t(selector, values)` |
| `useTranslationsObject` / `getTranslationsObject` | `lib/utils/i18n.ts` | ✅ ported via `useMessageObjectT` (G5) |
| `useIsAsMessageKey` | `lib/utils/i18n.ts` | ✅ ported via `t.has(selector)` (G3) |
| `StringLiteral<AsMessageKey>` consumers (2 of 15) | `metadata.ts`, `table/types.ts` | ✅ ported |
| `StringLiteral<T>` itself | `types/utils.ts` | ❌ **out of scope** — 13 non-i18n consumers (filter operators, palettes, schema-derived enums). Removing `StringLiteral<T>` is a separate initiative. |

The findings doc lists the 13 non-i18n consumers with file:line so the residual scope is documented, but does not propose follow-up.

---

## Resolved questions

- **Prefixed scopes** — defer formal policy. Existing `dash0/use-translations-no-namespace` ESLint rule stays at `error`. No prefix-selector factory.
- **Codemod tool (for migration phase)** — ts-morph. Out of scope for validation.
- **Per-helper review** — already settled by the deprecation table above.
- **Atomic vs coexist (for migration phase)** — atomic via codemod in one PR. Out of scope for validation.
- **Memoization** — wrapper-internal Proxy walk is benchmarked under § Perf protocol; only memoize if numbers warrant. Call-site selector identity documented for downstream R14 (migration phase).
- **Object-selector shape (G5)** — separate hook (`useMessageObjectT`), option A.

---

## Explicitly out of scope

- **Migration of the rest of the codebase** — sequenced separately after validation results inform the plan.
- **Removing `StringLiteral<T>` entirely** — separate initiative, 13 non-i18n consumers.
- **Forbidding `useTranslations(prefix)` formally** — already lint-banned for the hook; broader policy decision deferred.
- **Modularising `en.json`** — separate maintainability initiative.
- **Argument-shape type safety** (typed `values` per key) — not pursued.

---

## Acceptance criteria

- All 8 ported files compile clean under `tsc` *and* `tsgo` with `--noEmit`.
- The two known TS2590 workaround sites no longer have `as string` casts, `eslint-disable` comments, or split assertions.
- `pnpm run verify` passes.
- The four API gaps (G1–G5) each have at least one ported caller plus unit tests.
- The opt-in `no-restricted-imports` rule, scoped to the ported files, is clean — no fallback to the old API.
- Perf findings doc shows whether the per-file numbers match the testbed's predicted ~10–15× check-time improvement under tsgo.
- Findings doc explicitly answers: did each deprecation table row work as predicted, and what (if anything) surprised us.

---

## Reference material

- **Parent brainstorm**: `docs/brainstorms/as-message-key-selector-api-requirements.md`
- **Migration handoff (post-validation)**: `docs/brainstorms/selector-api-handoff.md`
- **Perf testbed analysis**: `docs/brainstorms/as-message-key-selector-api-perf-analysis.md`
- **Spike**: `stash@{0}` on this branch, third parent commit `eadb7113ee` (untracked-files tree). Pop into `components/ui/src/lib/i18n-selector/` as the validation PR's first commit.
- **tsgo migration PR**: https://github.com/dash0hq/dash0/pull/11751 — source for the slice's two files.

---

## Next step

`-> /ce-plan` against this doc. Plan should sequence: spike commit → API gaps (G1–G5) → port slice → port stragglers → measure perf → write findings.
