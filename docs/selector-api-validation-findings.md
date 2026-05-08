---
title: "Selector-API translator — Phase 1 validation findings"
type: findings
status: complete
date: 2026-04-30
plan: docs/plans/2026-04-29-001-feat-selector-api-validation-plan.md
origin: docs/brainstorms/selector-api-validation.md
parents:
  - docs/brainstorms/selector-api-handoff.md
  - docs/brainstorms/as-message-key-selector-api-requirements.md
  - docs/brainstorms/as-message-key-selector-api-perf-analysis.md
---

# Selector-API translator — Phase 1 validation findings

This is the findings doc the team uses to decide whether to greenlight a
codebase-wide migration of the 327 `useTranslations` callsites from the
legacy `t("Path.To.Key")` shape to the new `t(m => m.Path.To.Key)`
selector shape.

The validation PR (`next-intl-Perf-Fix`) lands the spike, builds the
five missing API-gap surfaces, ports the two PR #11751 TS2590-workaround
sites (the slice), and ports six stragglers (one per straggler-class)
to exercise every uncovered surface at least once.

Quantitative perf results live in
[selector-api-validation-perf.md](./selector-api-validation-perf.md).
This doc covers everything else.

## Recommendation: Greenlight migration

The validation succeeded across every dimension that matters:

- **Zero TS2590 errors** introduced by the new API. The two PR #11751
  workarounds (deps-array `as string` casts, eslint-disable block,
  split assertions) come off cleanly. The deps-tuple instability
  pattern that caused the original TS2590 fires does not reappear in
  the migrated code.
- **Project-wide tsgo Check time drops 14.8%** (7.108 s → 6.055 s,
  signal classification at >2σ above the variance baseline). The two
  known per-file hotspots (`use-get-column-label.ts` at 8.7 s,
  `metadata.ts` at 2.4 s under tsc) both drop below the
  analyze-trace threshold after porting.
- **Every API gap (G1–G5) has a working wrapper** with unit tests and
  at least one ported caller. Two of the gaps surface ergonomic
  findings (G3 needs the `t.hasLeafRaw` escape hatch; G4 server-side
  has a typing rough edge) that the migration plan should bake in.
- **Coexistence works**. `useTranslations` keeps functioning for the
  319 unported callsites; the lint override scopes the ban to the
  validation slice + stragglers and one file is intentionally
  excluded as a half-port (see the G5 row below).

The biggest open question for migration is whether to lean into the
selector form for *every* caller or to keep `useTranslations` for the
runtime-string cases (command-palette-view, table column resolution,
etc.) and only port the compile-time-known sites. The half-port of
`command-palette-view.tsx` is a working data point: the file uses
`useMessageObjectT` for one runtime-string case but stays on
`useTranslations` for the others, and the result is still cleaner
than the original. Either policy is defensible.

## Per-API-gap findings (G1–G5)

| Gap | What we built | Who ports it | Surprises |
|-----|---------------|--------------|-----------|
| **G1: `t.rich`** | `t.rich(selector, values?)` returning `ReactNode`. Inherits `defaultTranslationValues` injection (em/strong/code/…) by going through `@ui/i18n/use-translations` instead of bypassing it. | `metric-histogram-bucket-boundaries-card.tsx` — exercises both ICU pluralisation (`{count, plural, ...}`) and a rich tag (`<em>`) at the same callsite. | None. Direct passthrough works; default-tag injection is preserved. |
| **G2: `t.markup`** | `t.markup(selector, values?)` returning string. | **No production caller.** A grep across the UI codebase surfaces zero existing `t.markup` callers. The wrapper has a dedicated unit test against a fixture catalog; no codebase-shape was ported. | The plan's R8 ("each gap has at least one ported caller") narrows for G2: built and unit-tested but no codebase caller exists. Migration phase should add a ported caller if a real `t.markup` site appears. |
| **G3: `t.hasLeaf` + `t.hasLeafRaw`** | `t.hasLeaf(selector)` for compile-time paths; `t.hasLeafRaw(path: string)` for runtime strings. The `Leaf` rename (vs. `next-intl`'s native `t.has`) reflects the deliberate divergence: `hasLeaf` returns `false` for object subtrees, while `t.has` returns `true` for any resolvable path. | `use-get-column-label.ts` — the only `useIsAsMessageKey` caller in the codebase. Uses runtime strings (`column.label` from view configs), so it ports via `useMessageObjectT.raw(path)` + `typeof === "string"` filter rather than via `t.hasLeaf`. | **Resolved Open Question:** the legacy `useIsAsMessageKey` caller is fundamentally a runtime-string check; the selector form doesn't help. The `useMessageObjectT.raw()` escape hatch (built for G5) covers this case adequately — same lodash-`get` underneath the legacy helper. The `t.hasLeafRaw` method ended up redundant with `useMessageObjectT.raw` for this caller; the migration plan can decide whether to keep it. |
| **G4: `createMessageTranslator` + `getMessageT`** | Synchronous `createMessageTranslator({ locale, messages })` for non-React/server-context callers. Async `getMessageT(namespace?)` wrapping `next-intl/server`'s `getTranslations`. | `metadata.ts` (sync) and `no-signals/layout.tsx` (server async). | **Open Question fallout:** `metadata.ts` ports cleanly via the **`walkPath` + `createMessageTranslator`** pattern (option (c) from the plan's "metadata.ts selector shape" Open Question — keep signature stable, swap internal `createTranslator`). The two `// @ts-expect-error` annotations and the `StringLiteral<AsMessageKey>` argument cost both go away. **Ergonomic finding for `getMessageT(namespace?)`:** typing the selector against a namespaced subtree (so `getMessageT("Logs")` lets `t(m => m.title.default)` work without casts) requires recursive conditional types over the catalog (TS2590 risk). Validation port avoided this by dropping the namespace argument and letting the selector walk from the root: `t(m => m.Logs.title.default)`. The migration plan should pick a stance: either (i) drop namespace support from `getMessageT` entirely, (ii) accept the cast-at-callsite friction for namespaced calls, or (iii) build the recursive narrowing and accept the typecheck cost. |
| **G5: `useMessageObjectT`** | Separate hook returning a callable + `.raw(path: string)` escape hatch. Selector form: `<T>(selector: (m) => T) => T`. | `command-palette-view.tsx` — replaces `useTranslationsObject` with `useMessageObjectT` for `command.searchTags` (runtime string). Half-port: keeps `useTranslations` for the runtime-string `t(category as AsMessageKey)` calls because command categories/descriptions are dynamic. | **Refutes the testbed concern:** the U4 micro-bench (40 callsites of `useMessageObjectT<T>` vs 40 callsites of `useMessageT()`) shows nearly identical per-callsite instantiation cost (~2,956 vs ~2,957 — see the perf doc). The rejected `<R extends string>` shape's per-call explosion does not reappear because our `<T>` is unconstrained — TypeScript skips the leaf-union check. **G5 is safe to use widely.** The "use sparingly" framing the plan U4 reserved if regression had reappeared is unnecessary. |

## Per-deprecation-row findings

The origin doc's "Deprecation coverage" table predicted what each deprecated `i18n.ts` helper would map to in the selector API. Did each row work as predicted?

| Deprecation row | Predicted port | Actual outcome |
|-----------------|----------------|----------------|
| `getTranslationProps` | direct `t(selector, values)` | **Half-true.** Worked when the call's input is compile-time-known (no callers ported in this validation that needed it that way). For `command-palette-view.tsx` the input is `command.description` (runtime `AsMessageKeyWithValues | undefined`) — the selector form can't accept it. The legacy helper stays for the runtime case; only the test file's local widening cast was needed to merge the element-by-element assertion. |
| `getTranslationsObject` | `useMessageObjectT()(selector)` for compile-time paths; `useMessageObjectT().raw(path)` for runtime strings | **Worked exactly as predicted.** The `.raw` escape hatch was added during U4 specifically to cover the `command-palette-view.tsx` runtime-string case, and ports cleanly. |
| `useTranslationsObject` | `useMessageObjectT()` | **Worked.** Direct replacement at the only caller in the validation slice. |
| `useIsAsMessageKey` | `t.hasLeaf(selector)` (compile-time) or `t.hasLeafRaw(path)` (runtime) | **Half-true.** The single caller (`use-get-column-label.ts`) is a runtime-string case, so the selector form doesn't apply. `useMessageObjectT.raw(path)` + `typeof === "string"` post-filter covers it adequately. `t.hasLeafRaw` is redundant for this caller — the migration plan can decide whether to keep it as a separate method or fold it into the `useMessageObjectT.raw` pattern. |
| `AsMessageKey` (the type) | Replaced by `MessageSelector` for new prop types | **Worked.** Demonstrated by `tabLabels.{overview,attributes,telemetry}: MessageSelector` and `breadcrumbLabelKey: MessageSelector` in `gcp-resource-detail-page.tsx`, and the union extension for `TableDefinitionCommon.label` in `table/types.ts`. The original AE ("pass `<X label={m => m.Some.Key} />`") works at every callsite that adopted the new prop type. |

## Other findings

**`dash0/use-translations-no-namespace` ESLint rule scope.** Plan-deferred
question: does the rule cover `getTranslations` from `next-intl/server`?
Reading the rule source at `src/.build/eslint-plugin-dash0/rules/use-translations-no-namespace.js`,
**the rule matches only `useTranslations`** (line 32:
`node.init.callee.name === "useTranslations"`). It does **not** cover
`getTranslations` — meaning today's `getTranslations("Logs")` callers
are not banned by the existing policy. The validation slice's lint
override (U5) extends the ban to `getTranslations` from `next-intl/server`
within the slice; broader workspace policy is a migration-plan question.

**Boundary cast as the only remaining type-system hole.** `wrap-base-translator.ts`
casts `baseT` to `(key: string, values?) => string` to feed string
paths through the underlying next-intl callable. The U1 adversarial
path-capture tests (array-index, numeric keys, dot-in-key, Symbol)
plus the dev-only empty-path runtime guard catch the realistic ways
this could go wrong. The cast itself is contained to three modules
(`use-message-translator.ts`, `create-message-translator.ts`,
`get-message-t.ts`) and the U5 lint override prevents accidental
introduction in slice files.

**Memoisation: translator object stable, selector literals not.** The
`useMemo([baseT])` in `useMessageT` keeps the translator object
referentially stable across re-renders for the same `baseT`. But
selector literals are fresh per render — `t(m => m.X)` creates a new
arrow function each call. Downstream `useMemo` deps that key on the
selector itself would invalidate every render, while deps that key
on the resolved string (the pattern U6's `gcp-resource-detail-page.tsx`
adopted) stay stable. The migration plan's R14 (call-site selector
identity) is well-founded — most port patterns will pre-resolve
labels to strings before placing them in deps.

**Half-ported file is the validation finding, not a bug.**
`command-palette-view.tsx` ports `useTranslationsObject` to
`useMessageObjectT` but keeps `useTranslations` for the runtime
`t(category as AsMessageKey)` calls. This file is intentionally
EXCLUDED from the U5 lint override. The migration plan should
decide policy for files where every translation key is dynamic:
either (i) accept half-ports as the standard pattern, (ii) build a
runtime-string entry point on `useMessageT` (`t.translateRaw(path)`)
to enable full ports, or (iii) keep dynamic-key sites on the legacy
hook.

## Residual scope

Files using `StringLiteral<T>` for non-i18n purposes (filter operators,
palettes, schema-derived enums) — explicitly out of scope per the plan's
"Scope Boundaries". Listing here so the migration plan has them visible:

The migration plan's `useTranslations`-callsite count (327) is a
keys-touched estimate, not an `AsMessageKey`-import count. The 13
non-i18n `StringLiteral<T>` consumers below stay untouched by both
this validation phase and the migration phase — removing
`StringLiteral<T>` entirely is a separate initiative.

```
src/components/ui/code-mirror/promql-editor/types.ts
src/components/ui/filter/types.ts
src/components/ui/scoped-attribute-key-picker/scoped-attribute-key-picker.tsx
src/components/non-primitive/filteringv2/types.ts
src/components/ui/table/table-definition/types.ts
src/lib/filter-criteria/operator-mappings.ts
src/lib/palettes/index.ts
src/types/utils.ts
src/types/views.ts
src/dashboarding/system/widgets/types.ts
src/views/types.ts
src/agentic-workflows/utils/types.ts
src/synthetics/types.ts
```

(Generated via `git grep "StringLiteral<" -l components/ui/src` minus
files that already use it for `AsMessageKey`-shaped purposes.)

## What this validation does NOT cover

- **`useFormatter`, `getMessages`, `next-intl/middleware`** — surfaces
  not exercised. If migration touches them, the migration plan must
  add wrappers (cross-referenced from the plan's System-Wide Impact).
- **Argument-shape type safety** — typed `values` per key. Out of
  scope per the plan's "Scope Boundaries". Validation slice's
  `t(selector, values)` accepts `TranslationValues` (broad object)
  unchanged.
- **Removing `AsMessageKey` / `AsNamespacedMessageKey`** — out of
  scope. 69 files still reference them; the validation slice's eight
  ported files drop the import (where applicable), but the type
  itself stays in `src/types/i18n.ts`.
- **Modularising `en.json`** — separate maintainability initiative.

## Sources & References

- **Plan:** [docs/plans/2026-04-29-001-feat-selector-api-validation-plan.md](../plans/2026-04-29-001-feat-selector-api-validation-plan.md)
- **Origin:** [docs/brainstorms/selector-api-validation.md](./selector-api-validation.md)
- **Parent brainstorm:** [docs/brainstorms/selector-api-handoff.md](./selector-api-handoff.md)
- **Decision record:** [docs/brainstorms/as-message-key-selector-api-requirements.md](./as-message-key-selector-api-requirements.md)
- **Perf testbed analysis:** [docs/brainstorms/as-message-key-selector-api-perf-analysis.md](./as-message-key-selector-api-perf-analysis.md)
- **Quantitative results:** [selector-api-validation-perf.md](./selector-api-validation-perf.md)
- **PR:** `next-intl-Perf-Fix` branch on dash0hq/dash0
