---
title: "feat: Selector-API translator — Phase 1 validation"
type: feat
status: active
date: 2026-04-29
deepened: 2026-04-29
origin: docs/brainstorms/selector-api-validation.md
---

# feat: Selector-API translator — Phase 1 validation

## Overview

Validate that a non-generic, leaf-typed selector API around `next-intl` covers
the five enumerated API gaps (G1–G5) used by the UI codebase, before committing
to a 327-callsite migration. The output is a single PR that lands the spike, closes
the API gaps so the new shape covers everything `next-intl` exposes today,
ports a deliberate slice + stragglers, measures TypeScript performance, and
publishes two findings docs.

The two APIs (legacy `useTranslations` and new `useMessageT`) coexist for the
duration. This is **validation**, not migration: existing string-keyed callers
elsewhere are untouched.

---

## Problem Frame

`AsMessageKey = MessageKeys<IntlMessages, NestedKeyOf<IntlMessages>>` is a
recursive conditional type over a 7,300-leaf message catalog. It causes
multi-second `useTranslations` evaluations, hot symbols in TS profiling, and
TS2590 ("union type too complex") under tsgo / tsc 6 with
`stableTypeOrdering: true` whenever multiple keys appear in a tuple position.

A perf testbed (5 variants, tsc + tsgo, 7,161 leaf fixture) showed selector-leaf
`(m: IntlMessages) => string` is ~15× faster than baseline, matches the
`string` lower bound, requires no build step, and preserves typo + non-string-leaf
errors. The selector-generic `<R extends string>` form runs almost as slow as the
baseline because of per-callsite generic instantiation. Codegen flat union is a
viable but slower fallback that adds a build step.

The decision is settled. What's not settled is whether the spike's API surface
covers `t.rich`, `t.markup`, `t.has`, server-side `createTranslator`, and the
`useTranslationsObject` pattern — and whether the testbed's per-file numbers
hold on real `en.json` data. This phase answers both before a migration plan
gets written.

(see origin: `docs/brainstorms/selector-api-validation.md`)

---

## Requirements Trace

- R1. Land the spike at `components/ui/src/lib/i18n-selector/`.
- R2. Close the five API gaps (G1–G5 from origin) so the new shape covers the enumerated `next-intl` surfaces. Surfaces explicitly *not* exercised this phase (`useFormatter`, `getMessages`, `next-intl/middleware`) stay on the legacy API; if migration touches them, the migration plan must add wrappers (cross-referenced in System-Wide Impact).
- R3. Port a small, deliberate set of files (slice + stragglers) to the new API; existing callers elsewhere stay on `useTranslations`.
- R4. Measure TypeScript performance before/after on the ported files, project-wide, and on a representative GCP detail page flame trace.
- R5. Produce two findings docs: `selector-api-validation-findings.md` and `selector-api-validation-perf.md`.
- R6. The two known TS2590 workaround sites (`gcp-resource-detail-page.tsx`, `i18n.test.ts`) drop their `as string` casts, `eslint-disable` blocks, and split assertions.
- R7. Ported files compile cleanly under `tsc` *and* `tsgo` with `--noEmit`; `pnpm run verify` passes.
- R8. Each API gap (G1–G5) has at least one ported caller and unit-test coverage.
- R9. An opt-in `no-restricted-imports` rule, scoped to the ported files only, confirms no fallback to the old API in the validation slice.

---

## Scope Boundaries

- **Migration of the rest of the codebase** — sequenced separately after validation results inform the plan.
- **Removing `StringLiteral<T>` entirely** — separate initiative, 13 non-i18n consumers (filter operators, palettes, schema-derived enums).
- **Forbidding `useTranslations(prefix)` formally** — already lint-banned for the hook; broader policy decision deferred.
- **Modularising `en.json`** — separate maintainability initiative.
- **Argument-shape type safety** (typed `values` per key) — not pursued in v1.
- **Final names of public hooks/types** for the migration phase — validation locks in the spike's names (`useMessageT`, `MessageSelector`, `createMessageTranslator`, `useMessageObjectT`); renaming is part of the migration plan, not this phase.

---

## Context & Research

### Relevant Code and Patterns

- **Spike (to land in U1):** `stash@{0}` on `next-intl-Perf-Fix`, third-parent commit `eadb7113ee` (untracked-files tree). Four files under `components/ui/src/lib/i18n-selector/`:
  - `path-from-selector.ts` — Proxy-based path capture, ~25 lines.
  - `path-from-selector.test.ts` — 4 vitest cases, all passing.
  - `use-message-translator.ts` — `useMessageT()` hook + `MessageSelector` and `SelectorTranslator` types. Wraps `next-intl`'s `useTranslations()`; casts at the boundary.
  - `example.tsx` — illustrative, never imported.
- **Legacy helpers** (`components/ui/src/lib/utils/i18n.ts`): `AsMessageKeyWithValues`, `getTranslationProps`, `getTranslationsObject`, `useTranslationsObject<T>`, `useIsAsMessageKey<T>`. All deprecated; the validation slice ports the relevant ones to selector equivalents.
- **Legacy types** (`components/ui/src/types/i18n.ts`): `AsMessageKey`, `AsNamespacedMessageKey`. Stay in place for non-validation callers; not removed.
- **Module-scope translator** (`components/ui/src/lib/intl/metadata.ts`): uses `createTranslator({ locale, messages })` with two `// @ts-expect-error` annotations and a `StringLiteral<AsMessageKey>` argument. Drives G4's synchronous factory design. **Caller surface:** `generateMetadataFromIntl(pathPrefix, values?)` is called from 10+ files in `app/(core)/...`, `app/(onboarding)/...`, `app/(integrations)/...`, etc. with prefix strings like `"Hub"`, `"Traces.Explorer"`, `""`. U7's port keeps the exported signature stable and changes only the internal call to `createMessageTranslator`.
- **ESLint rule** (`components/ui/eslint.config.mjs:121`): `dash0/use-translations-no-namespace` at `error`. Restricts `useTranslations(prefix)` for the hook only — confirm in U7 whether it covers `getTranslations`; flag in findings if not.
- **Server-side caller** (`components/ui/src/app/(core)/(logs)/logs/no-signals/layout.tsx`): uses `getTranslations("Logs")` with a namespace. Validates G4 in a server context.
- **Slice files** with TS2590 workarounds (PR #11751):
  - `components/ui/src/infrastructure/gcp/shared/gcp-resource-detail-page.tsx` — three `as string` casts in `useMemo` deps + `eslint-disable react-hooks/use-memo, react-hooks/exhaustive-deps` at lines ~92–125.
  - `components/ui/src/lib/utils/i18n.test.ts` — element-by-element assertions instead of `toEqual([msg, values])` at lines ~17–21.
- **Stragglers** (six files):
  - `components/ui/src/lib/intl/metadata.ts` — `createTranslator` + `StringLiteral<AsMessageKey>` + `// @ts-expect-error`. (G4)
  - `components/ui/src/components/commands/command-palette-view.tsx` — `useTranslationsObject`, `getTranslationProps`, `AsMessageKey` cast in one file. (G5 + values + cast)
  - `components/ui/src/components/ui/table/table-definition/use-get-column-label.ts` — only `useIsAsMessageKey` caller. (G3 via `t.hasLeaf`)
  - `components/ui/src/components/ui/table/types.ts` — `label?: StringLiteral<AsMessageKey> | HardCodedLabel`. Tests `MessageSelector` as a prop type.
  - One `t.rich`-heavy file (selected in U2). Candidates: `components/ui/src/components/onboarding-flow/scaffolds/subscription-active.tsx` and similar; the broader codebase has 60+ `t.rich` callers across alerting and commands. (G1)
  - `components/ui/src/app/(core)/(logs)/logs/no-signals/layout.tsx` — server-side `getTranslations("Logs")`. (G4 server)
- **Perf testbed:** `https://github.com/blessanm86/typescript-go-ts2590` PR #1 — 5 variants under tsc 6.0.2 and tsgo 7.0.0-dev. Selector-leaf clocked ~10–15× check-time improvement under tsgo.

### Institutional Learnings

- The recursive `MessageKeys<NestedKeyOf<IntlMessages>>` is the documented bottleneck (Slack thread `C07A3GU5NQY`, Sept 2025). Setting `AsMessageKey = string` made the IDE pleasant — confirming the type itself, not a downstream symptom, is the cost.
- The naive `<R extends string>` selector form is *not* a perf win — testbed showed ~324 instantiations and tsgo time within 1.5× of baseline. Plans must keep the spike's leaf-typed, non-generic shape.
- `useTranslations` on tuple positions (`useMemo` deps, `[msg, values]`) is the deterministic TS2590 trigger under tsgo / tsc 6 with `stableTypeOrdering: true`. Both slice files exercise this.

### External References

- `next-intl` API surface for `t.rich`, `t.markup`, `t.has`, `createTranslator`, and `getTranslations` — the wrapper must mirror their public contract so runtime ICU pluralisation, JSX rendering, and existence checks remain unchanged. Verify against `next-intl@<version-in-use>` types during U2.
- i18next selector pattern (`enableSelector: "optimize"`, default in v26) — prior art that motivated the leaf-typed selector form. Not used at runtime; cited only for design lineage.

---

## Key Technical Decisions

- **Coexist, don't replace.** `useTranslations` keeps working everywhere outside the validation slice. The new APIs live entirely under `components/ui/src/lib/i18n-selector/`, and the boundary cast (legacy `t` typed against `MessageKeys<>` → `(key: string, values?) => string`) is contained in three modules (`use-message-translator.ts`, `create-message-translator.ts`, and `get-message-t.ts`). The `useMessageObjectT` hook reads messages directly so it doesn't need the cast.
- **Preserve spike public names for validation.** Use `useMessageT`, `MessageSelector`, `SelectorTranslator`, `createMessageTranslator`, `getMessageT`, `useMessageObjectT`. Final naming (`useTranslations` vs `useT` vs `useMessageT`) is a migration-phase decision; locking it in here would re-litigate parent R1 without new evidence. The exception is `t.hasLeaf` (vs the spike's earlier `t.has`) — that rename is justified by the semantic divergence from `next-intl`'s native `t.has` and is locked in now to prevent migration-phase confusion.
- **Object-selector via separate hook.** G5 ships as `useMessageObjectT()` returning `<T>(s: (m: IntlMessages) => T) => T` (origin "option A"). Mirrors `next-intl`'s factoring, independently lint-restrictable, and keeps the per-call type narrow. No type-narrowing on the object shape — caller asserts via the generic.
- **`t.hasLeaf`, not `t.has`.** Expose the existence check as `t.hasLeaf(selector)` — returns `true` only when the selector lands on a string leaf, matching the legacy `useIsAsMessageKey` semantics it replaces. The rename is deliberate: `next-intl`'s native `t.has` returns `true` for any path (including object subtrees), so naming the wrapper `t.has` would silently mislead migration-phase callers who carry the `next-intl` mental model. Reserve `t.has` for a future direct mirror of `next-intl`'s semantics if a need arises.
- **`t.rich` selector type.** Selector still returns `string` even though the value renders as JSX. `next-intl`'s `t.rich` reads the same dot-path; the `=> string` constraint preserves leaf-typing and lets the same Proxy walk apply. This needs explicit validation during U2 against ICU+rich-text fixtures.
- **Two server-friendly entry points: `createMessageTranslator` and `getMessageT`.** `createMessageTranslator({ locale, messages })` is synchronous, takes already-resolved messages, returns the same `SelectorTranslator` shape plus `.rich`, `.markup`, `.hasLeaf`. No React dependency. `getMessageT(namespace?)` is async, wraps `next-intl/server`'s `getTranslations(namespace?)`, and is the drop-in replacement for server callers like `no-signals/layout.tsx` that rely on next-intl's server-context cache. The `namespace?` parameter lives on `getMessageT` — not on `createMessageTranslator` — because validation slice consumers of the synchronous factory don't need it, and putting it on the wrong factory leaks unscoped surface (origin defers prefix policy).
- **Opt-in lint scope via override.** Add a `files: [...validation slice + stragglers]` block to `eslint.config.mjs` with `no-restricted-imports` for `useTranslations` and `getTranslations` from `next-intl`. The new wrapper itself imports them with a single `eslint-disable-next-line no-restricted-imports` (already present in spike).
- **Perf measurement is point-in-time, not gated — but pre-register signal-vs-noise.** No PR-blocking threshold; the findings doc reports numbers and the team decides downstream. To prevent capturing noise and calling it a result, U8 pre-registers the variance baseline before measuring (5+ cold runs of the unmodified branch typecheck on this machine) and the findings doc explicitly states whether per-file deltas exceed the variance band. Project-wide is reported alongside the variance baseline so readers can distinguish signal from instrumentation drift.

---

## Open Questions

### Resolved During Planning

- **Names of new APIs for validation:** Use the spike names as-is (`useMessageT`, `MessageSelector`, `createMessageTranslator`, `useMessageObjectT`). Migration-phase rename is a separate decision.
- **Whether to remove legacy helpers in this phase:** No. `i18n.ts` deprecated helpers stay; only the *ported files* stop importing them. Mass cleanup happens in the migration phase.
- **Whether to remove `AsMessageKey`/`AsNamespacedMessageKey`:** No. Out of scope for validation — 69 files still reference them. Only the eight ported files drop the import.
- **`useTranslations(prefix)` policy:** Defer per origin "Resolved questions". Existing `dash0/use-translations-no-namespace` stays at `error`. No prefix-selector factory built.
- **Memoization of selector → path:** Defer; benchmark in U8 alongside the perf measurement. Each render creates a new selector function literal — the wrapper's translator object is memoised per `baseT` via a single `useMemo`, but selector identity itself changes per call. Document call-site selector identity in the perf findings doc for migration-phase R14.

### Deferred to Implementation

- **`t.rich` straggler file selection.** Pick during U2 from the 60+ candidates. Bias toward a file with both ICU pluralisation *and* a rich tag, ideally already touched by tsgo migration. `subscription-active.tsx` is a candidate but final pick is implementation-time.
- **Whether `dash0/use-translations-no-namespace` covers `getTranslations`.** Read the rule source during U7; if it covers only the hook, flag in findings — do not extend the rule in this phase.
- **`t.hasLeaf` post-filter strategy.** Implementation-time check against the installed `next-intl` version's `.d.ts`: if `next-intl`'s underlying `t.has` returns `true` for non-string leaves, `t.hasLeaf` adds a `typeof === "string"` guard via `getMessages()`; if it's already string-only, the wrapper is a thin pass-through.
- **Exact wrapper shape for `t.rich` tag values.** `next-intl`'s `RichTranslationValues` permits `(chunks: ReactNode) => ReactNode` plus primitives. Confirm during U2 that the wrapper passes them through unchanged.
- **Whether the GCP detail page truly stops being a hot symbol after porting.** Hypothesis from testbed; verify in U8b's flame-trace spot-check.

### Deferred from document review (2026-04-29)

These four were surfaced during the plan's document-review pass and deferred for in-flight resolution. They are real gaps; the plan ships without locking the answer because either multiple options are genuinely tenable or the answer requires implementation-time discovery.

- **`metadata.ts` selector shape — three options on the table.** `generateMetadataFromIntl` is called with a prefix string (incl. empty `""`) and concatenates two leaves via `pathPrefix + ".title.template"`. A `MessageSelector = (m: IntlMessages) => string` cannot encode a prefix; the empty-prefix case has no selector equivalent. Three real options: (a) split into two selector arguments `generateMetadataFromIntl(template: MessageSelector, default_: MessageSelector)`; (b) parent selector + child key `(parent: (m) => SubObject, child: "template" | "default")`; (c) keep `metadata.ts` on legacy `createTranslator` for this validation phase and move G4 coverage entirely to `no-signals/layout.tsx`. F2's "keep signature stable, swap internal createTranslator only" decision (applied above) makes (c) the easiest path, but (a) or (b) are also defensible — pick during U7.
- **8-file slice may not validate `t.rich` ergonomics.** G1 has 60+ callers across alerting, subscriptions, websites, tracing, and synthetics with varied tag shapes (`<strong>`, `<Link>`, custom components, ICU pluralisation combined with rich tags, conditional rendering inside chunks). The plan picks ONE `t.rich`-heavy straggler. Two paths: (i) enumerate the rich-tag shape inventory in `en.json` and require the picked straggler to exercise each shape, or (ii) port 3–5 `t.rich` callers covering distinct shapes and accept exceeding the 8-file ceiling. Decide during U2's straggler selection; document in findings.
- **G2 (`t.markup`) has no ported callsite.** Origin acceptance criteria require "Each API gap (G1–G5) has at least one ported caller and unit tests"; the plan builds and tests `t.markup` but no codebase grep surfaced an existing caller. Two paths: (i) grep harder during U2 and add the first caller found to the slice, or (ii) explicitly narrow R8 to "G1, G3, G4, G5 each have at least one ported caller; G2 is built/tested but the codebase has zero callers — validated only by unit tests" and surface in findings.
- **`t.hasLeaf` constraint blocks dynamic-key callers.** Legacy `useIsAsMessageKey` accepted any string and reported leaf-existence at runtime; `t.hasLeaf(selector)` requires a compile-time-known path, defeating the original use case if the single caller (`use-get-column-label.ts`) passes a runtime string. Audit that file during U7 — if dynamic, either keep `useIsAsMessageKey` for runtime-string cases or specify a separate `t.hasLeafRaw(path: string)` escape hatch.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

The validation API surface, after U2–U6 land, looks like:

```text
components/ui/src/lib/i18n-selector/
├── path-from-selector.ts          (spike — Proxy walk → dot path)
├── use-message-translator.ts      (spike — useMessageT)
│                                  (extended — t.rich, t.markup, t.hasLeaf)
├── create-message-translator.ts   (G4 — synchronous factory, mirrors createTranslator)
├── get-message-t.ts               (G4 — async server wrapper around getTranslations)
├── use-message-object-t.ts        (G5 — separate hook, generic object selector)
└── *.test.ts                      (per-module unit tests)
```

`useMessageT()` returns a `SelectorTranslator` with attached methods,
roughly:

```text
type SelectorTranslator = {
  (selector: MessageSelector, values?: TranslationValues): string;
  rich: (selector: MessageSelector, values?: RichTranslationValues) => ReactNode;
  markup: (selector: MessageSelector, values?: MarkupTranslationValues) => string;
  hasLeaf: (selector: MessageSelector) => boolean;
};
```

All four call shapes use the same Proxy walk to resolve the selector, then
forward to `next-intl`'s underlying `t`, `t.rich`, `t.markup`, and (for
`hasLeaf`) a `typeof === "string"` post-filter on `getMessages()` if needed.
The wrapper name is `hasLeaf`, not `has`, to make the leaf-only divergence
from `next-intl`'s native `t.has` (which is any-path) explicit at every call
site.

`createMessageTranslator({ locale, messages })` returns the same shape but is
synchronous and React-free; used by `metadata.ts` after U7. `getMessageT(namespace?)`
is the async server wrapper around `next-intl/server`'s `getTranslations`,
used by `no-signals/layout.tsx`. The `namespace?` parameter lives on
`getMessageT` only — `createMessageTranslator` takes already-resolved messages
and namespace scoping happens via the selector itself.

`useMessageObjectT()` is a parallel hook returning a single function
`<T>(selector: (m: IntlMessages) => T) => T`. It's deliberately separate —
attaching it to `SelectorTranslator` would either widen the leaf return type
(losing the perf win) or require a generic on the call signature (regressing
to the rejected `<R extends string>` shape).

Lint scope is controlled by an override block in `eslint.config.mjs`:

```text
{
  files: [
    "src/lib/i18n-selector/**",
    "src/lib/intl/metadata.ts",
    "src/lib/utils/i18n.test.ts",
    "src/infrastructure/gcp/shared/gcp-resource-detail-page.tsx",
    ...stragglers...
  ],
  rules: {
    "no-restricted-imports": [...next-intl: useTranslations, getTranslations...]
  }
}
```

The wrapper modules add a single `eslint-disable-next-line no-restricted-imports`
where they intentionally import the underlying `next-intl` symbols.

---

## Implementation Units

- [ ] U1. **Land the spike**

**Goal:** Pop `stash@{0}` to disk so the validation PR has the spike as its first commit and the rest of the work has a base to extend.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Create: `components/ui/src/lib/i18n-selector/path-from-selector.ts`
- Create: `components/ui/src/lib/i18n-selector/path-from-selector.test.ts`
- Create: `components/ui/src/lib/i18n-selector/use-message-translator.ts`
- Create: `components/ui/src/lib/i18n-selector/example.tsx`

**Approach:**
- **Pre-flight check before pop:** `git grep "type IntlMessages" components/ui/src/` and confirm the global `IntlMessages` declaration still exists on this branch (typical next-intl declaration-merging setup). If absent, the spike's `MessageSelector = (m: IntlMessages) => string` will fail tsc; add an explicit import to `use-message-translator.ts` before stash-pop.
- `git stash pop stash@{0}` (or apply via `git stash apply`) to populate the four files. Fallback if pop conflicts: `git checkout eadb7113ee -- components/ui/src/lib/i18n-selector/`.
- Verify the four files compile and tests pass with no edits beyond the optional `IntlMessages` import.
- Extend the spike's `pathFromSelector` test file with **adversarial path-capture cases** to harden the boundary cast (the wrapper's only place where TypeScript stops checking the wiring): array-index access (`m.list[0]`), numeric-prefixed keys, keys whose value contains a dot, Symbol access, and `in` checks. Each case should compare the captured path string to the dot-path next-intl actually consumes.
- Add a **runtime guard in `pathFromSelector`** (or in `useMessageT`'s call sites): if the resolved path is the empty string `""`, throw in dev (`process.env.NODE_ENV !== "production"`) with a "selector returned the messages root — must terminate at a string leaf" message. The leaf-only contract is enforced at compile time, but with the boundary cast erasing type-checking, an `as string`-laundered non-leaf is a plausible runtime path.
- Do not import `example.tsx` from anywhere; it stays as a standalone editor demo. (FYI: spike commit ships `path-from-selector.test.ts` only — `useMessageT` itself is untested in the spike; that's covered by U2.)
- Keep the file-level `eslint-disable-next-line no-restricted-imports` already in `use-message-translator.ts` — it's the boundary import.

**Patterns to follow:**
- Existing `components/ui/src/lib/...` module layout. Co-located vitest spec files.

**Test scenarios:**
- Happy path: `pnpm exec vitest run src/lib/i18n-selector/path-from-selector.test.ts` — original 4 spike tests pass (single-segment, deep nested, realistic translation paths, selector-returns-self).
- Edge case (new): `pathFromSelector(m => m.items[0])` returns `"items.0"` (or whatever next-intl expects for array indices — verify against `next-intl`'s `t("items.0")` behaviour in a runtime smoke test).
- Edge case (new): `pathFromSelector(m => (m as any)["123"])` for numeric-prefixed keys returns `"123"`.
- Edge case (new): keys whose value contains a dot — capture the captured path verbatim and assert next-intl resolves it correctly.
- Error path (new): in dev, calling `useMessageT()(m => m)` throws with the "messages root" message; in prod, it forwards `""` to next-intl unchanged (current behavior).
- Happy path: `pnpm exec tsc --noEmit` and `pnpm exec tsgo --noEmit` succeed across `components/ui` after the spike lands.
- Happy path: `pnpm exec eslint src/lib/i18n-selector/` clean.

**Verification:**
- The four files are present at `components/ui/src/lib/i18n-selector/`.
- `pnpm run verify` in `components/ui` passes.
- Adversarial path-capture cases all pass; the dev-only empty-path guard fires when intentionally triggered in a unit test.
- Stash entry can be dropped (`git stash drop stash@{0}`) once the commit lands.

---

- [ ] U2. **Extend `useMessageT` with `t.rich`, `t.markup`, `t.hasLeaf` (G1–G3)**

**Goal:** Make the spike's translator object cover `t.rich(selector, tags)`, `t.markup(selector, tags)`, and `t.hasLeaf(selector)` so JSX-returning, markup-string-returning, and existence-check call sites can be ported.

**Requirements:** R2 (G1, G2, G3), R8

**Dependencies:** U1

**Files:**
- Modify: `components/ui/src/lib/i18n-selector/use-message-translator.ts`
- Create: `components/ui/src/lib/i18n-selector/use-message-translator.test.ts`

**Approach:**
- Extend `SelectorTranslator` to a callable + properties shape:
  - `t(selector, values?) => string` (already in spike)
  - `t.rich(selector, values?) => ReactNode`
  - `t.markup(selector, values?) => string`
  - `t.hasLeaf(selector) => boolean`
- **Construct the full translator inside a single `useMemo([baseT])`, not by mutating a `useCallback` result.** The spike's `useCallback` returns a memoised function; calling `Object.assign(t, { rich, markup, hasLeaf })` per render with fresh closures defeats referential stability and breaks downstream `useMemo` deps that key on `t` — exactly the deps-tuple instability pattern PR #11751 was patching around. The single `useMemo` returns a fully-formed callable-with-properties object whose identity is stable as long as `baseT` is stable.
- Wrap each next-intl method via the same `pathFromSelector`. Keep the boundary cast pattern from the spike (cast `baseT` at the use site, not at the type level).
- For `t.rich`, the return type should match next-intl's actual return type (`ReactNode` or `string | ReactElement | ReactNodeArray` depending on installed version) — read the d.ts during implementation.
- `t.hasLeaf` checks leaf-only existence (string leaf), matching the legacy `useIsAsMessageKey` semantics it replaces. Implementation-time check: if `next-intl`'s underlying `t.has` returns `true` for non-string leaves, post-filter with a `typeof === "string"` check on the resolved value via `getMessages()`; if it's already string-only, the wrapper is a thin pass-through. Either way the public name is `t.hasLeaf` so migration-phase callers don't conflate it with `next-intl`'s `t.has`.
- During this unit, finalise the choice of `t.rich`-heavy straggler. Pick one with both ICU and a rich tag. Record the choice in the open-questions section of the findings doc when written in U9. **Coverage decision:** if the codebase's `t.rich` callers span clearly distinct tag shapes (`<strong>`, `<Link>`, custom components, ICU+tag combos), prefer porting 3–5 callers covering the inventory (per "8-file slice may not validate `t.rich` ergonomics" in Open Questions) over a single straggler — exceeding the 8-file ceiling is acceptable here.

**Execution note:** Test-first for the three new methods. Each has a clear contract against next-intl behavior, and the implementer benefits from having concrete failing tests before wiring through the Proxy walk.

**Patterns to follow:**
- `useMemo` returning a callable-with-properties object — see existing examples of memoised utility-bundle hooks in the codebase if applicable; otherwise the pattern is straightforward (`useMemo(() => Object.assign(t, { rich, markup, hasLeaf }), [baseT])` constructs the bundle exactly once per `baseT` change).
- `next-intl` source for return-type fidelity (`@types/next-intl` or installed `.d.ts`).

**Test scenarios:**
- *Happy path* — Covers AE4 / R5 (ICU pass-through): `t.rich(m => m.Some.Path, { strong: chunks => <strong>{chunks}</strong> })` returns the same `ReactNode` shape that `useTranslations()(...).rich("Some.Path", ...)` returns for the same fixture key.
- *Happy path*: `t.markup(m => m.Some.Path, { em: chunks => `<em>${chunks}</em>` })` returns the equivalent string for the same fixture key.
- *Happy path*: `t.hasLeaf(m => m.Existing.String.Leaf)` returns `true`.
- *Edge case*: `t.hasLeaf(m => m.NonExistent.Path)` returns `false`.
- *Edge case*: `t.hasLeaf(m => m.Object.Subtree)` returns `false` (matches `useIsAsMessageKey` leaf-only contract — even if `next-intl`'s native `t.has` returns `true` for the same path).
- *Happy path* — Covers AE1: typing `m.NoSuch.Path` is a TypeScript error in the test file; typing a path landing on a non-string leaf is also a TypeScript error.
- *Integration*: rendered output of `<>{t.rich(m => m.Real.Key, tags)}</>` matches a `useTranslations()` baseline render under a `NextIntlClientProvider` wrapping a fixture catalog with ICU pluralisation.
- *Referential stability* (regression-prevention): `useMessageT()` returns the same object identity across re-renders when `baseT` is stable. A `renderHook` test re-rendering 5 times asserts `t === t_prev` and `t.rich === t.rich_prev` for each pair.

**Verification:**
- `pnpm exec vitest run src/lib/i18n-selector/use-message-translator.test.ts` passes.
- `pnpm exec tsc --noEmit` and `pnpm exec tsgo --noEmit` clean.
- The exported `SelectorTranslator` type has callable + `.rich`/`.markup`/`.hasLeaf` properties typed with `MessageSelector`-shaped arguments.
- The translator object's identity is stable across re-renders (caught by the referential-stability test).

---

- [ ] U3. **Add `createMessageTranslator` factory and `getMessageT` server wrapper (G4)**

**Goal:** Provide two server-friendly entry points: a synchronous, React-free factory that mirrors `next-intl`'s `createTranslator`, and an async wrapper around `next-intl/server`'s `getTranslations` so server callers (RSC layouts, `generateMetadata`-adjacent code) get the same selector ergonomics without manually resolving `{ locale, messages }`.

**Requirements:** R2 (G4), R8

**Dependencies:** U2 (so both factories can attach the same `.rich`/`.markup`/`.hasLeaf` methods)

**Files:**
- Create: `components/ui/src/lib/i18n-selector/create-message-translator.ts`
- Create: `components/ui/src/lib/i18n-selector/create-message-translator.test.ts`
- Create: `components/ui/src/lib/i18n-selector/get-message-t.ts`
- Create: `components/ui/src/lib/i18n-selector/get-message-t.test.ts`

**Approach:**
- Export `createMessageTranslator({ locale, messages }): SelectorTranslator` that internally calls `next-intl`'s `createTranslator(...)` and wraps the same way `useMessageT` does — `pathFromSelector` + boundary cast + `.rich/.markup/.hasLeaf` attachment. **No `namespace` parameter.** The synchronous factory takes already-resolved messages; namespace scoping happens upstream when callers slice the messages tree, or via the selector itself by writing `t(m => m.Some.Namespace.key)`. Origin defers prefix-scope policy; adding a `namespace` parameter here would silently re-introduce that surface.
- Export `async function getMessageT(namespace?: string): Promise<SelectorTranslator>` that wraps `next-intl/server`'s `getTranslations(namespace?)`. The optional `namespace` is the only place that surface lives — server callers like `no-signals/layout.tsx` rely on next-intl's server-context resolution and cannot reasonably resolve `{ locale, messages }` themselves. The wrapper applies the same `pathFromSelector` Proxy on top of the returned `t`, attaches `.rich/.markup/.hasLeaf`, and returns a plain `SelectorTranslator` (no `useMemo` because there's no React render cycle to memoise against).
- Single `eslint-disable-next-line no-restricted-imports` on each `next-intl` / `next-intl/server` import, matching the wrapper convention.

**Execution note:** Test-first using a static fixture catalog (no React, no `NextIntlClientProvider`).

**Patterns to follow:**
- Spike's wrapper pattern in `use-message-translator.ts` (after U2's `useMemo` refactor lands).
- `next-intl`'s `createTranslator.d.ts` and `next-intl/server`'s `getTranslations.d.ts` signatures for argument compatibility.

**Test scenarios:**
- *Happy path*: `createMessageTranslator({ locale: "en", messages: fixture })((m) => m.Foo.Bar)` returns the same string as `createTranslator({ locale, messages })("Foo.Bar")`.
- *Happy path* — Covers AE4: ICU pluralisation via `t(m => m.Plural.Key, { count: 3 })` matches next-intl's underlying output.
- *Happy path*: `.rich`, `.markup`, `.hasLeaf` work identically to U2's tests against the static catalog.
- *Happy path*: `await getMessageT()((m) => m.Foo.Bar)` resolves to the same string as `(await getTranslations())("Foo.Bar")` under a server-context fixture.
- *Happy path*: `await getMessageT("Logs")((m) => m.heading)` resolves to the same string as `(await getTranslations("Logs"))("heading")`.
- *Edge case*: typo in selector path → TypeScript error; non-string leaf → TypeScript error.
- *Integration*: when `createMessageTranslator` is called with the real `en.json` import (as `metadata.ts` does today after U7's port), produces metadata-shape strings matching the legacy `createTranslator` output.
- *Integration*: when `getMessageT("Logs")` is used in `no-signals/layout.tsx` (after U7), produces the same rendered output as the legacy `getTranslations("Logs")` baseline.

**Verification:**
- Both vitest files pass.
- `createMessageTranslator`'s type signature does not require any React types.
- `getMessageT`'s signature is `async (namespace?: string) => Promise<SelectorTranslator>`.

---

- [ ] U4. **Add `useMessageObjectT` hook (G5)**

**Goal:** Provide a separate hook returning a generic object-selector translator, replacing `useTranslationsObject<T>` for ported files.

**Requirements:** R2 (G5), R8

**Dependencies:** U1

**Files:**
- Create: `components/ui/src/lib/i18n-selector/use-message-object-t.ts`
- Create: `components/ui/src/lib/i18n-selector/use-message-object-t.test.ts`

**Approach:**
- Export `useMessageObjectT(): <T>(selector: (m: IntlMessages) => T) => T`.
- Internally read messages via `next-intl`'s `useMessages()` (or reproduce `useTranslationsObject`'s underlying access) and use `pathFromSelector` to walk into the live messages tree, returning the resolved subtree typed as `T` — caller asserts shape via the generic.
- Why a separate hook: attaching the generic to `SelectorTranslator`'s callable would either widen the return type (losing the leaf-typed perf win) or reintroduce per-callsite generic instantiation (rejected by testbed). See origin "Resolved questions — option A".
- Lint-restrictable independently of `useMessageT` for downstream policy decisions.

**Patterns to follow:**
- Existing `useTranslationsObject<T>` in `components/ui/src/lib/utils/i18n.ts:86–105` — same internal shape, different argument form (selector instead of dot-path).

**Test scenarios:**
- *Happy path*: `const getObj = useMessageObjectT(); getObj<{ a: string; b: string }>(m => m.Subtree)` returns the live messages subtree object.
- *Happy path*: returning a string leaf via the same hook also works (selector return type drives `T`).
- *Edge case*: undefined / missing path returns the same fall-through that `useTranslationsObject` does today (verify by reading current behavior; document if changed).
- *Integration*: drop-in replacement for `useTranslationsObject` in `command-palette-view.tsx`'s test scenario produces identical rendered output (verified in U9).
- *Perf micro-bench (regression check on rejected `<R extends string>` shape)*: write a synthetic test fixture with 30–50 callsites of `useMessageObjectT<...>(m => m.Subtree)` covering at least three distinct generic-`T` shapes (string leaf, two-key object, deeper nested object). Run `pnpm exec tsc --generateTrace .traces/g5-bench --noEmit` and the same under `tsgo`. Compare instantiation counts against the same shape using leaf-typed `useMessageT()(m => m.Some.Leaf)` × the same callsite count. Record both numbers in the perf findings doc (U9). If the G5 fixture's instantiation count grows roughly per-callsite while the leaf-typed fixture stays flat, the testbed-rejected `<R extends string>` cost reappeared — document explicitly and frame G5 in findings as "use sparingly", not "lint-restrictable independently".

**Verification:**
- `pnpm exec vitest run src/lib/i18n-selector/use-message-object-t.test.ts` passes.
- `pnpm exec tsc --noEmit` and `pnpm exec tsgo --noEmit` clean.
- The G5 micro-bench traces exist under `.traces/g5-bench/` and the instantiation comparison is captured for U9.

---

- [ ] U5. **Add opt-in `no-restricted-imports` lint rule scoped to validation files**

**Goal:** Prove the validation slice has no escape hatches into the legacy `useTranslations` / `getTranslations` API.

**Requirements:** R9

**Dependencies:** None (can run in parallel with U2–U4; ordered after U1 because the rule needs the wrapper to exist for the override block to point to it)

**Files:**
- Modify: `components/ui/eslint.config.mjs`

**Approach:**
- Append a new `files: [...]` override block listing the eight ported files plus all files under `components/ui/src/lib/i18n-selector/` (use a glob like `src/lib/i18n-selector/**/*.{ts,tsx}` rather than enumerating the exact file count — U2/U3/U4 add modules and tests beyond the spike's original four). Inside, set `no-restricted-imports` to disallow `useTranslations` from `next-intl` and `getTranslations` from `next-intl/server` named imports.
- The wrapper modules (`use-message-translator.ts`, `create-message-translator.ts`, `get-message-t.ts`, `use-message-object-t.ts`) keep their `eslint-disable-next-line no-restricted-imports` line on their `next-intl` / `next-intl/server` import — that's the only legitimate escape hatch.
- Read the existing `dash0/use-translations-no-namespace` rule source to determine whether it covers `getTranslations` from `next-intl/server`; if it covers the hook only, log a one-line note in U9's findings doc. Do not extend the rule in this phase.

**Patterns to follow:**
- Existing `eslint.config.mjs` override blocks.
- Standard ESLint `no-restricted-imports` shape (per-name `paths` config).

**Test scenarios:**
- *Happy path*: After U6–U9 complete, `pnpm exec eslint <ported files>` exits 0.
- *Error path*: A test fixture (or a dry-run revert) where one ported file imports `useTranslations` from `next-intl` triggers the rule and fails the lint pass.
- *Edge case*: Files outside the `files: [...]` glob can still import `useTranslations` freely (lint stays green for the rest of the codebase).

**Verification:**
- `pnpm exec eslint .` passes overall.
- The override block's `files` glob covers the validation slice + stragglers + the entire `i18n-selector/` directory (verified by adding a temporary `useTranslations` import to a stray test file under `i18n-selector/` and confirming the rule fires).

---

- [ ] U6. **Port the slice — drop the two TS2590 workarounds**

**Goal:** Port the two files PR #11751 had to patch around `AsMessageKey` TS2590 errors. After this unit, the `as string` casts, `eslint-disable` block, and split assertions are gone, and tsgo stops complaining at those sites.

**Requirements:** R3, R6, R7

**Dependencies:** U1 (only `t(selector, values)` needed)

**Files:**
- Modify: `components/ui/src/infrastructure/gcp/shared/gcp-resource-detail-page.tsx`
- Modify: `components/ui/src/lib/utils/i18n.test.ts`

**Approach:**
- `gcp-resource-detail-page.tsx` (~lines 92–125):
  - Replace `useTranslations()` import with `useMessageT()`.
  - Convert each `t("Path.To.Key")` → `t(m => m.Path.To.Key)`.
  - Drop the three `as string` casts in the `useMemo` deps array.
  - Remove the `eslint-disable react-hooks/use-memo, react-hooks/exhaustive-deps` block. Keep the original `useMemo` shape; the deps array now contains real strings (the resolved labels) instead of `AsMessageKey`-tuple-typed values.
- `i18n.test.ts` (~lines 17–21):
  - Convert the `[messageKey, values]`-asserting test(s) to use selector form for the inputs where applicable.
  - Merge the element-by-element assertion back to a single `expect(result).toEqual([msg, values])`.
  - If the test is specifically testing the legacy `getTranslationProps` helper, port the test's *own* translation calls only — the helper itself stays. (Confirm during implementation; the helper is not removed in this phase.)

**Patterns to follow:**
- Spike's `useMessageT()` import pattern (`@ui/lib/i18n-selector/use-message-translator`).
- Existing test structure in `i18n.test.ts`.

**Test scenarios:**
- *Happy path* — Covers AE2 / R6: `gcp-resource-detail-page.tsx` compiles under both `tsc --noEmit` and `tsgo --noEmit`. No `as string` casts remain in the file. No `eslint-disable react-hooks/*` block remains.
- *Happy path* — Covers AE3 / R6: `i18n.test.ts` uses a single `toEqual([msg, values])` assertion (or equivalent merged form) and passes under `pnpm exec vitest run src/lib/utils/i18n.test.ts`.
- *Integration*: Render-test the GCP detail page with three tabs (existing test or a new RTL test) — the rendered tab labels match the pre-port output.
- *Error path*: Verifying a typo in any of the ported selectors produces a TypeScript error (`m.Infrastructure.NoSuch.Tab`).

**Verification:**
- `pnpm exec tsgo --noEmit` shows zero TS2590 errors anywhere in `components/ui/src/`.
- `pnpm run verify` in `components/ui` passes.
- `git grep "as string" -- 'components/ui/src/infrastructure/gcp/shared/gcp-resource-detail-page.tsx'` returns no matches in deps-array context.

---

- [ ] U7. **Port the stragglers — exercise every API gap**

**Goal:** Port the six straggler files chosen so the validation exercises every uncovered surface (G1–G5) and every i18n deprecation. Surface real-world ergonomic issues with the new API.

**Requirements:** R3, R7, R8

**Dependencies:** U2 (G1, G3 stragglers — `t.rich`, `t.hasLeaf`), U3 (G4 stragglers — `createMessageTranslator`, `getMessageT`), U4 (G5 stragglers — `useMessageObjectT`)

**Files:**
- Modify: `components/ui/src/lib/intl/metadata.ts`
- Modify: `components/ui/src/components/commands/command-palette-view.tsx`
- Modify: `components/ui/src/components/ui/table/table-definition/use-get-column-label.ts`
- Modify: `components/ui/src/components/ui/table/types.ts`
- Modify: one `t.rich`-heavy file (selected during U2; bias toward `subscription-active.tsx` or similar)
- Modify: `components/ui/src/app/(core)/(logs)/logs/no-signals/layout.tsx`

**Approach:**
- `metadata.ts`: **Keep `generateMetadataFromIntl`'s exported signature stable.** Convert only the *internal* `createTranslator` call to `createMessageTranslator` so the two `// @ts-expect-error` blocks go away — the `pathPrefix` parameter and its 10+ call sites are unchanged. The internal calls become two selector-shaped lookups via the prefix string (e.g., `t(m => walkPath(m, pathPrefix + ".title.template"))` or equivalent helper); see "metadata.ts selector shape" in Open Questions for the three real options if a cleaner shape emerges during implementation. This preserves the API contract without exploding scope to all 10+ callers.
- `command-palette-view.tsx`: replace `useTranslationsObject` with `useMessageObjectT`, replace `getTranslationProps` call with direct `t(selector, values)`, drop the `as AsMessageKey` cast.
- `use-get-column-label.ts`: replace `useIsAsMessageKey` with `t.hasLeaf(selector)`. **Audit the caller's actual call shape first** — if the consumer passes a runtime string (the legacy `useIsAsMessageKey` accepted any string), the selector form requires a compile-time-known path and isn't a 1:1 replacement. In that case either keep `useIsAsMessageKey` for the dynamic-string case or specify a separate `t.hasLeafRaw(path: string)` escape hatch (track in Open Questions). If the caller passes a known path, the swap is direct. Adjust the call site within the same file or its single caller; coordinate change with type prop in `table/types.ts` (next bullet).
- `table/types.ts`: change `label?: StringLiteral<AsMessageKey> | HardCodedLabel` to `label?: MessageSelector | HardCodedLabel`. This validates `MessageSelector` as a prop type (origin AE: pass `<X label={m => m.Some.Key} />`).
- `t.rich` file: convert each `t.rich("Path.To.Key", tags)` to `t.rich(m => m.Path.To.Key, tags)`. Confirm rendered output unchanged via existing tests or a quick render test.
- `no-signals/layout.tsx`: replace `getTranslations("Logs")` with `await getMessageT("Logs")` (the U3 server wrapper). The wrapper preserves next-intl's server-context resolution semantics so the file does not need to manually thread `{ locale, messages }`. Convert string-keyed calls to selector form. If the existing `dash0/use-translations-no-namespace` rule covers `getTranslations` from `next-intl/server` and now flags this caller, document and proceed; if not, the U5 lint override catches it.

**Execution note:** Bias toward small, isolated commits per straggler so failures are easy to bisect.

**Patterns to follow:**
- Spike's `useMessageT()` and `MessageSelector` usage as in `example.tsx`.
- Existing prop-typed component patterns in `table/types.ts` for the `MessageSelector` prop adoption.

**Test scenarios:**
- *Happy path* — each ported file compiles under `tsc --noEmit` and `tsgo --noEmit`.
- *Happy path*: existing tests for these files pass without modification.
- *Integration*: rendered output of the command palette matches pre-port output (existing tests or RTL spot-check).
- *Integration*: server-side `metadata.ts` produces the same `Metadata` shape (title.template / title.default strings) as before.
- *Integration*: `useGetColumnLabel` returns the same labels (or `false`-equivalent) for the same column shape.
- *Edge case* — Covers AE5: `t(someStringVar)` patterns *not* present in stragglers (verify by grep); if any, surface for human review per origin AE5.
- *Edge case*: `use-get-column-label.ts` audit — confirm caller passes a compile-time-known path (selector form works) or a runtime string (Open Question on `t.hasLeafRaw` escape hatch applies).
- *Error path*: typo in any ported selector produces a TypeScript error (`m.NoSuch.Path`).
- *Error path*: a non-string leaf selector (`m.SomeObject.Subtree`) produces a "not assignable to type 'string'" error, except in the `useMessageObjectT` call site (where it's intentional).

**Verification:**
- All eight ported files (slice + stragglers) compile clean under `tsc` and `tsgo`.
- `pnpm exec eslint <ported files>` passes (the U5 override block is now exercised).
- `pnpm run verify` in `components/ui` passes.

---

- [ ] U8a. **Measure perf — capture variance baseline + before snapshot**

**Goal:** Capture the variance baseline of the unmodified branch and the per-file/project-wide/GCP "before" measurements, all from the pre-port HEAD (just after U1 lands and before U6 starts). Splitting this from U8b makes the sequencing explicit so a parallel executor cannot land U6/U7 before the baseline is captured.

**Requirements:** R4

**Dependencies:** U1 (must run before U6)

**Approach:**
- **Variance baseline (pre-registration):** run `pnpm exec tsc --noEmit --extendedDiagnostics` 5 times cold on the unmodified branch. Compute mean and stddev for `Check time`, `Types`, `Instantiations`, `Memory used`. Repeat under `tsgo`. Record both stddev numbers — they define the noise floor for U8b's signal-vs-noise judgment.
- **Per-file traces (before):** for each of the eight ported files, `pnpm exec tsc --generateTrace .traces/before/<file> --noEmit`. Repeat under `tsgo`. Capture `instantiations` and `check time` per file from the trace JSON.
- **Project-wide (before):** 3 cold runs of `tsc --noEmit --extendedDiagnostics` and `tsgo --noEmit --extendedDiagnostics`. Median values for the same axes plus `TS2590` count.
- **GCP detail page (before):** `pnpm exec tsc --generateTrace .traces/before/gcp` for `gcp-resource-detail-page.tsx`. Note `useTranslations` hot-symbol presence in the flame.
- **Subset typecheck (alternative SNR sample):** also capture project-wide for *just* the ported files + their import closure (`tsc --noEmit -p tsconfig.subset.json` if practical, else manually). The 8/177-file ratio means full-project deltas may be noise-dominated; the subset gives a meaningful comparison band.

**Patterns to follow:**
- Existing perf testbed methodology (`as-message-key-selector-api-perf-analysis.md`).

**Test scenarios:**
- Test expectation: none — measurement task. Verification is data capture, not behavior.

**Verification:**
- `.traces/before/` exists with traces for the 8 files × 2 compilers + the GCP page.
- Variance baseline (mean ± stddev × 2 compilers) is recorded in a notes file alongside the traces.
- Subset typecheck before-time is captured.

---

- [ ] U8b. **Measure perf — capture after snapshot, tabulate, judge signal vs noise**

**Goal:** With the slice + stragglers ported (U6 + U7 complete), capture the "after" measurements, tabulate before/after, and explicitly judge each delta against the U8a variance baseline. Confirm or refute the testbed prediction (~10–15× tsgo check-time improvement on per-file).

**Requirements:** R4

**Dependencies:** U6, U7, U8a

**Approach:**
- Repeat the U8a measurement procedure under the same machine and environment (`.traces/after/...`).
- Tabulate before/after for each axis: per-file (tsc/tsgo × instantiations + check time), project-wide (median of 3, all axes), subset typecheck, GCP flame.
- **Pre-registered SNR judgment:** for each delta, classify as `signal` if it exceeds 2× the U8a stddev, `null` if within ±1× stddev, `negative` if reversed beyond 1× stddev. Record the classification — not just the number — for U9.
- Confirm `useTranslations` is no longer a hot symbol in the GCP detail page flame (or note if it still is).

**Test scenarios:**
- Test expectation: none — measurement task.

**Verification:**
- `.traces/after/` exists with traces for the 8 files × 2 compilers + GCP.
- A summary table for U9 is built with: per-file `instantiations` + `check time` × tsc/tsgo × before/after × signal-classification; project-wide and subset medians × tsc/tsgo × before/after × signal-classification.
- A screenshot or text dump of the GCP `useTranslations` flame is captured for the after state.

---

- [ ] U9. **Write findings docs**

**Goal:** Produce the two artefacts the team uses to decide whether to greenlight migration — a validation findings doc and a perf findings doc.

**Requirements:** R5

**Dependencies:** U2–U8b

**Files:**
- Create: `docs/brainstorms/selector-api-validation-findings.md`
- Create: `docs/brainstorms/selector-api-validation-perf.md`

**Approach:**
- `selector-api-validation-findings.md`:
  - One paragraph framing.
  - Per-API-gap (G1–G5) — what was built, who ports it in the slice, what (if anything) surprised us.
  - Per-deprecation-row (the table in origin "Deprecation coverage") — did each row work as predicted?
  - List of the 13 non-i18n `StringLiteral<T>` consumers with `file:line` (residual scope, no follow-up proposed).
  - Note on whether `dash0/use-translations-no-namespace` covers `getTranslations` (per U5 finding).
  - Recommendation: greenlight migration / iterate on API / change direction.
- `selector-api-validation-perf.md`:
  - The four numbers (per-file × tsc/tsgo × before/after) as a table, each delta classified `signal` / `null` / `negative` against the U8a variance baseline.
  - Project-wide before/after and subset-typecheck before/after, both with the same SNR classification.
  - The U8a variance baseline (mean ± stddev) reported up front so readers can interpret the deltas.
  - GCP detail page flame trace before/after (image or text dump).
  - Whether per-file numbers match the testbed's predicted ~10–15× check-time improvement under tsgo.
  - G5 (`useMessageObjectT`) micro-bench results from U4: instantiation counts at 30–50 callsites vs leaf-typed equivalent. If the G5 fixture grows roughly per callsite, frame the migration recommendation explicitly.
  - Memoisation note: call-site selector identity changes per render; the U2 `useMemo` keeps the translator object stable but selector literals do not memoise per-key; document downstream R14 implication.

**Patterns to follow:**
- Origin doc and parent brainstorms for tone, length, and frontmatter shape.

**Test scenarios:**
- Test expectation: none — documentation deliverable.

**Verification:**
- Both files exist under `docs/brainstorms/`.
- Each links back to origin (`selector-api-validation.md`) and parent (`selector-api-handoff.md`, `as-message-key-selector-api-requirements.md`, `as-message-key-selector-api-perf-analysis.md`).
- Findings doc explicitly answers: did each deprecation table row work as predicted, and what (if anything) surprised us.
- Perf doc shows the four numbers and the trace screenshot.

---

## System-Wide Impact

- **Interaction graph:** The new wrapper sits between application code and `next-intl`. The boundary cast (legacy `t` → string-keyed callable) is contained in three modules under `i18n-selector/`. The legacy `useTranslations` path is unchanged for non-validation callers.
- **Error propagation:** TypeScript errors at selector callsites surface as `Property 'X' does not exist on type {...}` (typo) or `Type '{...}' is not assignable to type 'string'` (non-string leaf). Runtime errors (missing keys at translation time) propagate identically to current `next-intl` behaviour — the wrapper does not catch or remap them.
- **State lifecycle risks:** None — `useMessageT()` returns a `useMemo`d translator object whose identity is stable as long as `baseT` is stable, so `useMemo` deps that key on the translator itself work correctly. Selector function literals (e.g., `m => m.X`) are still fresh per render — that's a per-key memoisation question, not a wrapper-state question, and is documented for the migration phase.
- **API surface parity:** The validation slice exercises every uncovered surface (G1–G5) at least once. Surfaces *not* exercised — `useFormatter`, `getMessages`, `next-intl/middleware` — stay on the legacy API; if migration touches them, the migration plan must add wrappers.
- **Integration coverage:** Render-test the GCP detail page and the command palette under their existing tests; `metadata.ts` requires a server-context or unit test. Unit-only coverage of the wrapper would not have caught the `as string` deps-array workaround — so U6 explicitly verifies the workaround is gone, not just that the file compiles.
- **Unchanged invariants:** `AsMessageKey` and `AsNamespacedMessageKey` remain in `components/ui/src/types/i18n.ts`. `i18n.ts` deprecated helpers (`getTranslationProps`, `useTranslationsObject`, `useIsAsMessageKey`) remain available for non-validation callers. `dash0/use-translations-no-namespace` ESLint rule stays at `error` workspace-wide. The 13 non-i18n `StringLiteral<T>` consumers are untouched. **`generateMetadataFromIntl`'s exported signature is preserved** — its 10+ callers in `app/(core)/...`, `app/(onboarding)/...`, `app/(integrations)/...` are not modified, only the internal translator implementation changes.

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| `t.rich` selector return type doesn't compose with next-intl's actual `RichTranslationValues` shape, forcing wrapper-side reshaping. | U2 reads next-intl's installed `.d.ts` first; tests exercise both ICU and rich-tag forms against fixture catalogs; document any required reshape in findings. |
| `useMessageObjectT`'s generic-`T` selector regresses tsgo time at object-shape callsites because the type parameter is per-callsite again. | U4 ships an explicit 30–50-callsite micro-bench comparing G5 instantiation counts against the leaf-typed equivalent (`tsc --generateTrace .traces/g5-bench`). U9's perf findings doc reports the result; if regression is measurable, frame G5 in findings as "use sparingly" and let the migration plan decide whether to keep it. |
| Migration-phase callers conflate `t.hasLeaf` with `next-intl`'s `t.has` semantics. | Public API is named `t.hasLeaf` (not `t.has`) so the divergence is explicit at every call site. `t.has` is reserved for a future direct mirror of `next-intl` semantics if a real need arises. Decision and rationale are in Key Technical Decisions; findings doc surfaces the rename. |
| Per-file perf numbers don't match the testbed prediction (~10–15× under tsgo). | This is the *purpose* of validation. U8a captures a pre-registered variance baseline so U8b's deltas are classified `signal` / `null` / `negative` rather than read as raw numbers; a miss does not block this PR but is surfaced explicitly in U9's findings. |
| Project-wide perf delta is dominated by run-to-run noise (8/177 ported files ≈ 4.5% of typecheck surface). | U8a captures stddev across 5 cold runs; U8b also reports a "subset typecheck" of ported files + their import closure, where the SNR is meaningful. Project-wide is reported alongside the variance baseline so the reader can distinguish signal from drift. |
| Boundary cast (`baseT as unknown as (key: string) => string`) silently breaks if next-intl's runtime contract or path shape diverges (array indices, dot-in-key, etc.). | U1 extends `pathFromSelector` tests with adversarial cases (array index, numeric keys, dot-in-key, Symbol). U1's runtime guard throws in dev when the resolved path is empty, catching `as string`-laundered non-leaf returns. Both cases land before U2 attaches `.rich`/`.markup`/`.hasLeaf` to the same Proxy walk. |
| The `t.rich`-heavy straggler picked in U2 turns out to be too small to be representative. | U2's selection criterion (ICU + rich tag + already touched by tsgo migration) biases toward representativeness; if still thin, U7 can add a second `t.rich` straggler — but stay within ~8 total files to keep manual review tractable. |
| `metadata.ts`'s string-concatenation pattern (`pathPrefix + ".title.template"`) doesn't translate cleanly to a selector. | Implementation-time decision in U7 — likely shape: pass two selectors, or accept a parent selector + child key. Document the chosen shape in findings as a real-world ergonomic finding. |
| Stash pop conflicts with files written since `eadb7113ee`. | The four spike files are all new (no overlap with main branch state per `git stash show stash@{0} --include-untracked --stat`). If conflict, fall back to copying the files from the third-parent commit directly. |

---

## Documentation / Operational Notes

- No CLAUDE.md changes in this phase. The "Using `AsMessageKey` without tripping TS2590 (tsgo)" section in `components/ui/CLAUDE.md` stays — it's still accurate for the 319 unported callsites. Replacement is migration-phase R14.
- No runtime / monitoring impact. The wrapper produces identical dot-path strings and forwards to the same `next-intl` calls.
- The PR description should explicitly call out: this is validation, not migration; both APIs coexist; existing callers are untouched.

---

## Sources & References

- **Origin document:** [docs/brainstorms/selector-api-validation.md](../brainstorms/selector-api-validation.md)
- **Parent brainstorm:** [docs/brainstorms/selector-api-handoff.md](../brainstorms/selector-api-handoff.md)
- **Decision record:** [docs/brainstorms/as-message-key-selector-api-requirements.md](../brainstorms/as-message-key-selector-api-requirements.md)
- **Perf testbed analysis:** [docs/brainstorms/as-message-key-selector-api-perf-analysis.md](../brainstorms/as-message-key-selector-api-perf-analysis.md)
- **Spike commit:** `eadb7113ee` (untracked-files tree from `next-intl-Perf-Fix`); accessible via `git stash@{0}`.
- **tsgo migration PR:** https://github.com/dash0hq/dash0/pull/11751 — source for the slice's two files (`gcp-resource-detail-page.tsx`, `i18n.test.ts`).
- **Testbed PR:** https://github.com/blessanm86/typescript-go-ts2590/pull/1 — five variants under tsc 6.0.2 and tsgo 7.0.0-dev.
- **Slack thread:** `https://dash0-workspace.slack.com/archives/C07A3GU5NQY/p1759121477007489` — Ben Blackmore's original perf profiling.
- **ESLint rule:** `components/ui/eslint.config.mjs:121` — `dash0/use-translations-no-namespace` at `error`.
- **Spike location:** `components/ui/src/lib/i18n-selector/` (created by U1).
