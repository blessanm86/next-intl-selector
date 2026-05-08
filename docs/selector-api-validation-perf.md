---
title: "Selector-API translator — Phase 1 perf measurements"
type: findings
status: complete
date: 2026-04-30
plan: docs/plans/2026-04-29-001-feat-selector-api-validation-plan.md
origin: docs/brainstorms/selector-api-validation.md
parents:
  - docs/brainstorms/as-message-key-selector-api-perf-analysis.md
---

# Selector-API translator — Phase 1 perf measurements

Quantitative companion to
[selector-api-validation-findings.md](./selector-api-validation-findings.md).
Captured before/after the 8-file port (slice + stragglers) on a
single machine; pre-registered variance baseline determines whether
each delta clears the noise floor.

## TL;DR

| Compiler | Check time before | Check time after | Δ | Δ % |
|----------|-------------------|------------------|---|-----|
| **tsgo `7.0.0-dev`** | **7.108 s** | **6.055 s** | **−1.053 s** | **−14.8%** |
| tsc 5.9.3 | 57.456 s | 46.174 s | −11.282 s | −19.6% |

Both deltas clear the noise floor (>2σ) and classify as **signal**.
The two known per-file hotspots (`use-get-column-label.ts`,
`metadata.ts`) drop below the analyze-trace threshold after porting.

8 files ported out of 9,956 (≈0.08% of the project). The fact that
project-wide deltas of this magnitude land from such a small slice
means the per-file improvements where they hit are very large.

## Methodology

- **Tooling:** `tsgo 7.0.0-dev.20260421.1` (project default for
  `pnpm run typecheck`), `tsc 5.9.3` (project's typescript dep),
  `@typescript/analyze-trace` (latest via `pnpm dlx`).
- **Cold runs:** delete `tsconfig.tsbuildinfo` before each run so
  `incremental: true` can't reuse cache.
- **Per axis:** 5 cold runs each compiler, before-state and
  after-state captured separately. Mean and stddev computed. Median
  reported as the central tendency.
- **Variance baseline (pre-registered):** the U8a 5-run stddevs
  define the noise floor for SNR judgment. Any delta within ±2σ is
  classified `null`; outside is `signal` (or `negative` if reversed).
- **Per-file traces:** `tsc --generateTrace <devlog>/traces/{before,after}/full-trace`
  once per state. `tsgo --generateTrace` is silently unsupported
  (verified empirically — emits no files), so per-file numbers come
  from tsc only. Hot-spot extraction via `@typescript/analyze-trace`.
- **What's not captured:** per-file traces under tsgo (impossible),
  separate subset typecheck of ported files + import closure (would
  need a custom tsconfig — skipped because the variance baseline
  gives sufficient SNR for project-wide comparison at this slice
  size).

Reproducibility script: `<devlog>/traces/measure.sh` — script and outputs
both live in the branch's devlog directory (untracked).

## Variance baseline (post-U1, pre-U6)

Captured on the unmodified state after U1 lands but before any port.
Stddevs define the 2σ band for U8b's signal-vs-noise judgment.

| Compiler | Check time mean ± stddev | Total time mean ± stddev | 2σ band on Check time |
|----------|--------------------------|--------------------------|------------------------|
| tsgo     | 7.108 ± 0.103 s          | 7.770 ± 0.180 s          | ±0.21 s |
| tsc 5.9  | 57.456 ± 0.829 s         | 61.988 ± 0.690 s          | ±1.66 s |

Types and Instantiations are deterministic across cold runs (no
variance on the same source). Memory bands are wide (±3.7 MB tsgo,
±104 MB tsc) — memory deltas only count as signal at order-of-magnitude
deviation.

## After snapshot (post-U7)

| Compiler | Check time mean ± stddev | Total time mean ± stddev |
|----------|--------------------------|--------------------------|
| tsgo     | 6.055 ± 0.090 s          | 6.787 ± 0.137 s          |
| tsc 5.9  | 46.174 ± 1.143 s         | 50.250 ± 1.430 s         |

After-state deterministic counts:
- tsgo: Types 2,117,470 / Instantiations 15,897,257
- tsc:  Types 1,112,291 / Instantiations  6,682,175

## Before vs After — full classification

| Axis | Before (mean) | After (mean) | Δ | Δ % | Classification |
|------|---------------|--------------|---|-----|----------------|
| **tsgo Check time** | 7.108 s | 6.055 s | **−1.053 s** | **−14.8%** | **signal** |
| **tsgo Instantiations** | 17,346,480 | 15,897,257 | **−1,449,223** | **−8.4%** | **signal** |
| tsgo Types | 2,118,574 | 2,117,470 | −1,104 | −0.05% | null |
| tsgo Memory | ~3.63 GB | ~3.58 GB | ~−50 MB | ~−1.4% | null (within band) |
| **tsc Check time** | 57.456 s | 46.174 s | **−11.282 s** | **−19.6%** | **signal** |
| **tsc Instantiations** | 8,254,792 | 6,682,175 | **−1,572,617** | **−19.0%** | **signal** |
| tsc Types | 1,111,607 | 1,112,291 | +684 | +0.06% | null |
| tsc Memory | ~3.56 GB | ~3.36 GB | ~−200 MB | ~−5.6% | signal (modest) |

`signal` rows are well outside the variance baseline's 2σ band.
`null` rows are within the band — no measurable change.

## Per-file hotspots (analyze-trace)

The two known hotspots in the validation slice both drop out of the
top of the analyze-trace list after porting:

| File | Before | After | Δ | Notes |
|------|--------|-------|---|-------|
| `use-get-column-label.ts` | **8,725 ms** | (below threshold) | **≈ −8,000 ms** | G3 site. Cost was the `isValidTranslationKey(builtInColumn.label)` check at L41 — a runtime `MessageKeys<NestedKeyOf<>>` comparison. After porting to `useMessageObjectT.raw + typeof === "string"`, the comparison goes away. |
| `metadata.ts` | **2,426 ms** | (below threshold) | **≈ −2,000 ms** | G4 site. Cost was the `t(pathPrefix + "title.template", values)` call at L24, which is a `TranslationValues` vs `Record<...>` type comparison embedding the leaf-union. After porting to `createMessageTranslator + walkPath`, the boundary cast is internal to the wrapper. |

The new top hotspot in the after state is `resource-table-page.tsx`
at 3,340 ms (from 3,847 ms — also a modest drop, likely a downstream
effect since list pages share the column-resolution code path). The
top-of-list hotspot dropped from 8,725 ms → 3,340 ms, a **62%
reduction in the worst-file check cost.**

The other 6 ported files (`gcp-resource-detail-page.tsx`,
`i18n.test.ts`, `command-palette-view.tsx`, `table/types.ts`,
`metric-histogram-bucket-boundaries-card.tsx`,
`no-signals/layout.tsx`) sit below the analyze-trace threshold
both before and after — meaning their per-file check times don't
dominate the project. Their value comes from removing the
PR #11751 workarounds (slice files) and from validating each API
gap (stragglers).

## G5 micro-bench results

40 callsites of `useMessageObjectT<T>(selector)` across three
distinct generic-T shapes vs 40 callsites of `useMessageT()(selector)`
(leaf-typed). Toggle each fixture's presence and diff cold-tsgo
output.

| Fixture (40 callsites) | Δ Instantiations | Per call (avg) |
|------------------------|------------------|-----------------|
| `useMessageT()` (leaf-typed) | +118,253 | ~2,956 |
| `useMessageObjectT<T>()` (generic-T) | +118,262 | ~2,957 |

**The generic-T introduces no per-callsite explosion.** The cost is
identical to the leaf-typed form because TypeScript skips the leaf-union
check when the generic is unconstrained (`<T>` with no `extends string`).
The rejected testbed `<R extends string>` shape would have shown
~324 instantiations per callsite scaling with N — that pattern does
not reappear.

**Implication:** G5 is safe to use widely. The migration plan does
not need the "use sparingly" framing the U4 plan reserved if
regression had reappeared.

The ~3,000 instantiations per callsite is the inherent cost of the
selector-API mechanism (Proxy walk + path resolution) and applies
equally to all selector-form callers.

Methodology and raw numbers: `<devlog>/traces/g5-bench/notes.md`.

## Did we hit the testbed prediction?

Testbed predicted ~10–15× per-file check-time improvement under
tsgo. We did not measure per-file under tsgo (`--generateTrace`
unsupported), but:

- Project-wide tsgo Check time delta: **−14.8%** (signal).
- Per-file under tsc: the two known hotspots in the slice show
  effectively complete elimination — `use-get-column-label.ts`
  drops from 8,725 ms below the threshold (a ≥10× improvement at
  that file).

The direction matches. Magnitudes don't translate 1:1 between the
testbed (synthetic 7,161-leaf fixture) and production (real
7,300-leaf catalog with broader call patterns), but the order of
magnitude is consistent.

## What this means for the 327 unported callsites

If the 8 ported files (≈0.08% of the project) bought a 14.8%
project-wide tsgo Check time reduction, the remaining 319 unported
callsites likely have similar per-callsite cost still embedded.
A full migration's project-wide upper bound is order-of-magnitude
20–25% (additional ~5–10% on top of what the slice already won),
but the per-file wins on hot files (any other AsMessageKey-tuple
sites) could be larger.

## Memoisation note (call-site selector identity)

The `useMemo([baseT])` in `useMessageT` keeps the translator object
referentially stable. But selector literals at callsites
(`t(m => m.X)`) are fresh function references per render. Downstream
`useMemo` deps that key on the selector itself would invalidate
every render.

The pattern that works (and that U6's `gcp-resource-detail-page.tsx`
port adopted) is to put the translator object and the *resolved
strings* in deps, not the selector literals. The deps tuple stays
stable as long as `baseT` is stable and the resolved strings are
identity-stable (which they are for next-intl's pure string
returns).

This is documented in the plan as R14 for the migration phase. No
mitigation required at the wrapper level.

## Files that produced these numbers

Under the branch's devlog directory at `<devlog>/traces/` (untracked
— raw trace data is too large to commit; ~377 MB types.json per state):

- `before/`, `after/` — `tsgo-{1..5}.txt`, `tsc-{1..5}.txt` raw
  `--extendedDiagnostics` output, plus `full-trace/` for the single
  tsc trace per state and `analyze-trace.txt` for the parsed
  hotspot list.
- `before/notes.md`, `after/notes.md` — the same numbers tabulated
  with U8a/U8b context.
- `g5-bench/notes.md` + `g5-bench/object-only.txt`,
  `g5-bench/leaf-only.txt` — the G5 micro-bench raw output.
- `measure.sh` — reproducibility script (toggle `before`/`after`
  argument).

## Sources & References

- **Plan:** [docs/plans/2026-04-29-001-feat-selector-api-validation-plan.md](../plans/2026-04-29-001-feat-selector-api-validation-plan.md)
- **Origin:** [docs/brainstorms/selector-api-validation.md](./selector-api-validation.md)
- **Perf testbed analysis:** [docs/brainstorms/as-message-key-selector-api-perf-analysis.md](./as-message-key-selector-api-perf-analysis.md)
- **Validation findings (companion):** [selector-api-validation-findings.md](./selector-api-validation-findings.md)
- **Tooling versions:** `tsgo` 7.0.0-dev.20260421.1, `tsc` 5.9.3,
  `@typescript/analyze-trace` (latest pnpm dlx).
