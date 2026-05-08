---
date: 2026-04-28
topic: as-message-key-selector-api
---

# Replace `AsMessageKey` recursive type with selector-API translation calls

## Problem Frame

Today the UI types translation keys as `AsMessageKey = MessageKeys<IntlMessages, NestedKeyOf<IntlMessages>>` (defined in `components/ui/src/types/i18n.ts`). `IntlMessages` is `typeof import("../messages/en.json")`. With `en.json` at 11,472 lines / ~7,300 leaf keys and growing, this recursive conditional type causes two compounding problems:

1. **Type-checking performance everywhere it appears.** Ben Blackmore's profiling (Sept 2025 thread, channel `C07A3GU5NQY`) showed multi-second `useTranslations` evaluations and identified the recursive `MessageKeys<NestedKeyOf<>>` as the core cost. Setting `AsMessageKey = string` made the IDE/CI experience pleasant again — confirming the type itself is the bottleneck, not just one symptom.
2. **TS2590 ("union type too complex to represent")** under tsgo (TS 7 beta) and tsc 6 with `stableTypeOrdering: true` whenever `AsMessageKey` appears in a tuple-literal position: e.g. multiple keys in a `useMemo` deps array (`gcp-resource-detail-page.tsx`), or `[messageKey, values]` tuples in tests (`i18n.test.ts`). The previous compiler ordering happened to dodge this; the new deterministic ordering surfaces a structural ceiling.

The team has been mitigating by deprecating helpers that compose the type (`AsMessageKeyWithValues`, `getTranslationProps`, `useTranslationsObject`, `useIsAsMessageKey`, `StringLiteral` — all in `components/ui/src/lib/utils/i18n.ts` and `components/ui/src/types/utils.ts`) and adding `as string` casts + eslint-disables at hot spots. This is a treadmill: every new translation key tightens the noose, and every new compose pattern produces another deprecation.

The i18next ecosystem has already solved this at the same scale via a **selector API** (i18next v25.4+ `enableSelector: "optimize"`, default in v26, string-key API deprecated in v27). Instead of `t("Foo.Bar")`, callsites use `t(m => m.Foo.Bar)`. TypeScript navigates the message object via property access — **no string-literal union is ever constructed**. This eliminates TS2590 *and* the broader perf cost in one move.

This brainstorm chose to follow that lead: build a thin selector-API wrapper around next-intl, codemod existing call sites, and remove the recursive type machinery.

## Empirical Validation

Ran a controlled testbed (https://github.com/blessanm86/typescript-go-ts2590) on a 7,161-leaf shape-equivalent fixture, with 100 typed call sites + the original TS2590 trigger + a `[Key, Values]` tuple. Three cold runs per variant per compiler, median:

| Variant | tsc total | tsgo total | TS2590 | Instantiations | Notes |
|---|---:|---:|---|---:|---|
| baseline (`MessageKeys<NestedKeyOf<>>`) | 1.24 s | 0.19 s | **fails on tsgo** | 730,585 | current production |
| `BigUnion = string` (lower bound) | 0.08 s | 0.02 s | n/a | 15 | Ben's "100% pleasant" floor |
| codegen flat union | 0.12 s | 0.03 s | passes | 15 | drop-in, build script needed |
| selector with `<R extends string>` | 1.16 s | 0.31 s | passes | 324 | **same speed as baseline** — generic constraint is the cost |
| **selector-leaf `(m) => string`** | **0.10 s** | **0.017 s** | **passes** | **15** | **winner** |

Findings:

- Baseline does **730,585 type instantiations** for 100 call sites — the dominant cost Ben identified is real and quantified.
- The naive selector form (`<R extends string>`) is **not** a win — per-callsite generic instantiation costs almost as much as the recursive type. The i18next pattern is correct in intent but the specific generic shape matters.
- **Selector-leaf** (`(m: Messages) => string`, no generic) is ~15× faster than baseline, matches the `string` lower bound, requires no build step, and **catches the same errors** as the current type: typos (TS2339) and selectors landing on intermediate objects or array leaves (TS2322 "not assignable to type 'string'").
- Codegen flat union is a viable fallback: ~10× faster than baseline, drop-in (just change the type), but adds a build step and scales linearly with key count (selector-leaf scales flat).

Full analysis at `docs/brainstorms/as-message-key-selector-api-perf-analysis.md`.

---

## Requirements

**Type system**

- R1. Remove `AsMessageKey = MessageKeys<IntlMessages, NestedKeyOf<IntlMessages>>` and `AsNamespacedMessageKey<Prefix>` from `components/ui/src/types/i18n.ts`. No string-literal union over translation keys exists in compiled output.
- R2. Provide a selector-shaped API for typed translation calls. Argument is a function `(m: IntlMessages) => string` — the **leaf-typed, non-generic form**. `m.Foo.Bar` is type-checked via property access against `IntlMessages`; the `=> string` return constraint forbids selectors landing on intermediate object nodes or non-string leaves. **No generic parameter** (`<R extends string>`) — the testbed showed per-callsite generic instantiation costs almost as much as the recursive type it replaces.
- R3. Mistyped paths (`m.NoSuchKey`) produce a TypeScript error at the callsite.
- R4. Multiple selector-typed values in tuple literals (deps arrays, `[message, values]` pairs, test assertions) compile cleanly under tsgo and under tsc 6 with `stableTypeOrdering: true`.

**Runtime**

- R5. The wrapper resolves a selector to the same dot-path string the underlying `next-intl` `t()` expects, so runtime translation behavior, ICU pluralization, and interpolation are unchanged.
- R6. The wrapper supports the existing optional values argument (e.g. `t(m => m.X, { count })`).
- R7. The wrapper performs no measurable per-call regression versus the current `t("X")` calls. Path resolution that walks a Proxy on every call must be benchmarked or memoized.

**Migration**

- R8. A codemod (script) rewrites every `t("Foo.Bar")` and `t("Foo.Bar", values)` callsite to the selector form across `components/ui/src/`. The codemod must handle template-literal keys and computed keys explicitly (not silently skip them).
- R9. After migration, all 69 files currently referencing `AsMessageKey` / `AsNamespacedMessageKey` either compile against the new API or are flagged as cases the codemod could not auto-translate (with a list).
- R10. Helpers deprecated due to this issue (`AsMessageKeyWithValues`, `getTranslationProps`, `useTranslationsObject`, `useIsAsMessageKey` in `components/ui/src/lib/utils/i18n.ts`) are either removed, un-deprecated with selector signatures, or replaced with selector-shaped equivalents — explicit decision per helper.
- R11. The two known workaround sites (`components/ui/src/infrastructure/gcp/shared/gcp-resource-detail-page.tsx` lines ~92–125, `components/ui/src/lib/utils/i18n.test.ts` lines ~17–21) drop their `as string` casts, eslint-disables, and element-by-element assertion patterns.

**Documentation**

- R12. The "Using `AsMessageKey` without tripping TS2590 (tsgo)" section in `components/ui/CLAUDE.md` is replaced with selector-API guidance: how to write a typed `t()` call, how to type a translation prop, what to do when the path is dynamic.

---

## Acceptance Examples

- AE1. **Covers R2, R3.** Given the new selector API, when a developer writes `t(m => m.Infrastructure.GoogleCloud.tabs.overview)`, autocomplete suggests `Infrastructure`, then `GoogleCloud`, etc. via property access. Writing `t(m => m.Infrastructure.NoSuchKey)` is a TypeScript error.
- AE2. **Covers R4, R11.** Given the GCP detail page after migration, when three tab labels are passed to `useMemo` deps, the file compiles under tsgo with no `as string` casts and no eslint-disables.
- AE3. **Covers R4, R11.** Given the i18n test after migration, `expect(result).toEqual([message, values])` compiles cleanly without splitting into element-by-element assertions.
- AE4. **Covers R5, R6.** Given a key with ICU pluralization (e.g. `"{count, plural, one {# item} other {# items}}"`), when called via `t(m => m.Path.To.Plural, { count: 3 })`, the rendered output matches what the previous `t("Path.To.Plural", { count: 3 })` produced.
- AE5. **Covers R8.** Given a callsite with a dynamic key like `t(someStringVar)`, the codemod does not silently rewrite it; it surfaces it for human review.

---

## Success Criteria

- A full `pnpm run verify` in `components/ui` passes under tsgo with no `AsMessageKey`-related TS2590 errors and no `as string` casts in deps arrays anywhere in `src/`.
- Ben's perf concern from the original Slack thread (`https://dash0-workspace.slack.com/archives/C07A3GU5NQY/p1759121477007489`) is measurably better: `useTranslations` no longer appears as a top hot spot in TS profiling.
- A new developer adding a translation key in 6 months does not encounter the deprecated-helpers pattern, the eslint-disable workaround, or the `AsMessageKey` viral-type advice.
- `ce-plan` can pick this up without inventing product behavior — the selector-API shape, migration scope, and treatment of deprecated helpers are settled here.

---

## Scope Boundaries

- **Modularization of `en.json`** (Thiemo / Matthias's suggestion in the Slack thread) is a separate initiative. It is a maintainability concern, not a type-system concern; mixing it in inflates this PR and couples two unrelated risks. Track separately and revisit after this lands.
- **Forbidding `useTranslations("some.prefix")`** (Ben's stronger proposal) is out of scope here. The selector API removes the *type* cost of prefixed scopes, but whether to deprecate the prefix usage entirely is a developer-ergonomics question best decided after the new API is in hand.
- **Switching i18n libraries** (e.g., to i18next or typesafe-i18n). next-intl stays. We adopt only the selector *pattern*, behind a thin wrapper, while keeping next-intl as the runtime.
- **Argument-shape type safety** (typed `values` per key, e.g. enforcing that a key with `{count}` requires `{ count: number }`). The selector API gives key-path safety; argument-shape safety is an additional capability some libraries provide via codegen. Not pursued in v1.
- **Server-side / next-intl middleware translation calls.** If any server-side `t()` exists in the UI repo, in scope; if any other repo uses `AsMessageKey`, out of scope here.

---

## Key Decisions

- **Selector API, not codegen flat union.** Codegen would have been a smaller change but only addresses TS2590; the testbed showed it still costs more than selector-leaf and requires a build step. Selector-leaf eliminates the union entirely with no build step.
- **Selector-leaf, not selector-generic.** The naive `<R extends string>(selector: (m: Messages) => R)` form is *not* a perf win — testbed showed it ran almost as slow as baseline due to per-callsite generic instantiation. The non-generic `(m: Messages) => string` form is what we adopt.
- **Wrapper around next-intl, not library swap.** Keep all next-intl runtime behavior (loaders, ICU formatter, hydration, etc.). The wrapper is purely the call-site shape and a Proxy-based path resolver.
- **Codemod, not gradual migration.** Mixed-API state during a slow rollout means the recursive type would have to coexist for months, blocking the perf win. One PR with the codemod + manual cleanup is the cleaner shape.
- **Defer `useTranslations("prefix")` policy.** Decide after the new API exposes how often prefixed scopes are actually useful.

---

## Dependencies / Assumptions

- `next-intl`'s public `t` API accepts a string dot-path and is stable; the wrapper depends on this contract.
- A Proxy-based path resolver in the wrapper has acceptable runtime cost. If benchmarks show otherwise during planning, fallbacks (memoization, build-time selector-to-string transform) need to be considered.
- ICU pluralization and rich-text/JSX values (`t.rich`) follow the same dot-path resolution and can be wrapped by the same shape.
- The codemod can handle the bulk of mechanical rewrites; a residual of ~tens of dynamic-key call sites will need manual conversion.

---

## Outstanding Questions

### Resolve Before Planning

(None — direction and scope are settled.)

### Deferred to Planning

- [Affects R5][Technical] Path-capture mechanism: `Proxy` walking the selector, AST-based build-time extraction (Babel plugin / SWC visitor), or hybrid (Proxy in dev, codegen in prod). Each has different runtime/build-time cost and debug-tooling tradeoffs.
- [Affects R6][Technical] How to wrap `t.rich`, `t.markup`, and `t.has` from next-intl, and whether `useFormatter` / `getMessages` need any wrapping.
- [Affects R10][Needs research] Per-helper decision for `AsMessageKeyWithValues`, `getTranslationProps`, `useTranslationsObject`, `useIsAsMessageKey`: does each have a sensible selector-shaped equivalent, or are they obsolete once the typed-tuple problem disappears?
- [Affects R8][Technical] Codemod implementation: jscodeshift, ts-morph, or a one-off TypeScript Compiler API script. i18next's `@i18next-selector/codemod` is for a different runtime but its transform shape may be referenceable.
- [Affects R12][Needs research] What's the right pattern for a translation prop on a component (today: `label: AsMessageKey`)? Options: `label: (m: IntlMessages) => string`, or pass the resolved string and require the caller to translate, or a branded `ResolvedTranslation` value.
- [Affects R7][Technical] Whether the wrapper should memoize selector → path translation per render (selector identity changes per call) or per call site (requires a `useMemo` or codegen).

### Resolved by testbed (no longer outstanding)

- ~~[Affects R4][Needs verification] Confirm selector compiles cleanly under tsgo for the worst current case~~ — verified on testbed; selector-leaf passes tsgo at 0.017s for the same shape that fails baseline.
- ~~Selector vs codegen vs baseline perf comparison~~ — measured; selector-leaf wins ~15× over baseline, ~1.5× over codegen, with no build step. See `docs/brainstorms/as-message-key-selector-api-perf-analysis.md`.

---

## Next Steps

`-> /ce-plan` for structured implementation planning. Plan should resolve the Deferred questions above before sequencing work.
