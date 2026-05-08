# Decision and findings

This is the canonical record of the architectural decision behind
`next-intl-selector` and the research path that got us here. Read this
first before touching the library code or any of the supporting
research docs in this folder.

## TL;DR

**We're building a property-selector wrapper around `next-intl` with
full ICU value type safety preserved.** Concretely:

```ts
const t = useMessageT();

t(m => m.MainNavigation.items.home);            // plain leaf
t(m => m.Greeting, { name: "Bob" });            // typed values
t.rich(m => m.Welcome, { strong: c => <b>{c}</b> });
t.markup(m => m.Notice, { em: c => `*${c}*` });
t.hasLeaf(m => m.Some.Key);
t.hasLeafRaw(runtimeString);
```

Two things this gives us together that no single existing library
does:

1. **No TS2590 ceiling** — the property-selector pattern avoids the
   recursive-union construction that breaks `MessageKeys<NestedKeyOf<>>`
   at scale.
2. **Full ICU values typing** — derived from the resolved leaf string
   literal via `@schummar/icu-type-parser`, the same parser
   `next-intl` already uses internally.

## The decision: selector-icu (not selector-leaf)

There were two viable variants by the end of validation:

- **selector-leaf**: `(m: Messages) => string` — non-generic. Drops
  values typing entirely. Fastest typecheck.
- **selector-icu**: `<R extends string>(m: Messages) => R` plus
  `GetICUArgs<R>` for the values arg. Full values safety. ~25–30×
  slower in stress tests, ~1.6× slower at real production density.

We're going with **selector-icu**.

The reasoning, in one sentence: **selector-icu doesn't add new cost,
it preserves the values-safety contract `next-intl` users already
have today.** The "perf cost" only looks like a tax if you compare
to selector-leaf; compare to baseline next-intl and selector-icu is
the same shape, same parser, same instantiation cost — minus the
TS2590 ceiling.

## Why this is the right shape

### Inspiration lineage

The selector pattern itself comes from i18next's
[TypeScript Selector API](https://www.locize.com/blog/i18next-typescript-selector-api/),
which solved an identical problem in their ecosystem. They ship full
values typing on the same selector pattern via their
`InterpolationMap<ReturnType<Fn>>` helper.

next-intl independently solved values typing via
`@schummar/icu-type-parser` years ago, but uses it on top of the
recursive `MessageKeys<NestedKeyOf<Messages>>` union — which is
exactly what hits TS2590 at our catalog size.

**This library combines both moves.** Selector-API for catalog
addressing (i18next's idea), `GetICUArgs<R>` for values typing
(next-intl's existing approach). Each crucial insight is borrowed
from a library that already proved it works in production.

### What's actually happening at the type level

When the user writes `t(m => m.Greeting, { name: "Bob" })`:

1. The selector `m => m.Greeting` resolves to the leaf literal type
   `"Hello {name}"` via property access on `IntlMessages`.
2. The function signature is generic `<R extends string>(...) => R`,
   so TypeScript captures `R = "Hello {name}"`.
3. The values arg is typed `GetICUArgs<R>`, which parses ICU
   placeholders out of the literal into `{ name: string | number }`.
4. `{ name: "Bob" }` is checked against that derived shape.

next-intl's `createTranslator.d.ts` does the exact same dance starting
from `Messages[Key]` instead of `ReturnType<Selector>`. Same primitives,
same parser, same end state.

### What we owe `next-intl`

- Use `@schummar/icu-type-parser` directly (not a custom parser) —
  matches what `next-intl` ships, so we never diverge on which ICU
  features are supported.
- Mirror their `OnlyOptional` trick: if the leaf has no placeholders,
  `values` should be optional, not a required `{}`.
- Mirror their `ICUArgsWithTags` shape for `t.rich` and `t.markup`:
  the values arg should be the intersection of `GetICUArgs<R>` and
  `ICUTags<R, TagFn>` so rich-tag callbacks are inferred from the
  leaf's `<strong>`-style markers.
- Lean on next-intl's runtime — we wrap their translator, we don't
  replace it. The Proxy walks the selector to recover a dot-path
  string, then delegates to `t(path, values)`.

The library is intentionally a thin selector-API skin over next-intl's
existing translator. The smaller our surface, the less we own.

## Performance envelope

All numbers are tsgo (`@typescript/native-preview@7.0.0-dev.20260421.2`)
with `--extendedDiagnostics`, 3-run median, against a 7,300-leaf real
en.json. See `bench/` in
[blessanm86/typescript-go-ts2590](https://github.com/blessanm86/typescript-go-ts2590)
for the testbed.

| Variant | tsgo Total | Per-callsite | Notes |
|---|---:|---:|---|
| baseline `MessageKeys<NestedKeyOf<>>` | 0.18 s | — | hits TS2590, fails to compile |
| selector-leaf (no values typing) | 0.016 s | ~0.16 ms | what we're NOT shipping |
| **selector-icu (full values typing)** | **0.022 s — 0.47 s** | **~2 — 4 ms** | range = real-density (7 callsites) → stress (100 callsites) |

The 25–30× ratio in stress tests is misleading. ICU parsing has an
amortizing setup cost; doubling callsites doesn't double total time.
At production density (3–10 callsites/file), the ratio collapses to
~1.6×.

Project-scale extrapolation for a ~1,200-importing-files codebase at
~5 callsites/file: **~7 seconds** added to project-wide tsgo Check
time vs selector-leaf. **Roughly the same as what next-intl's existing
ICU value typing was already costing** before TS2590 started biting
— we just get to actually compile now.

CI-noticeable, IDE-imperceptible. Acceptable.

## What we deliberately ruled out

- **Conditional types over the whole catalog** to derive a per-key
  values map. Tested as `selector-generic` in the testbed; it's
  strictly dominated — pays the bigger cost (`<R extends string>`)
  with no safety win. Don't ship this.
- **Codegen of declared overloads** (one TypeScript overload per
  leaf, no union). Promising but unproven at 7,300+ overloads, and
  it pulls a build-step dependency we'd rather avoid for v1. Parked
  as a future experiment in
  [`docs/research/legacy-cleanup-audit.md`](./legacy-cleanup-audit.md)
  and the broader research thread — see
  `2026-04-29-001-feat-selector-api-validation-plan.md` background.
- **Catalog restructure** (split `en.json` into per-feature files
  small enough that native typing works). Architecturally cleanest
  long-term answer (this is what next-intl maintainers themselves
  recommend at scale), but it's an organizational refactor, not a
  library deliverable. Out of scope for this library.
- **Lighter ICU parser** (`{name}` only, fall back to permissive on
  plural/select). Explored as a possible "trilemma escape" — would
  diverge from next-intl's parser support, increasing maintenance
  cost. Not worth shipping unless we hit a perf wall in production.
- **Build-time type emission** like Vocab / typesafe-i18n. Different
  ecosystem position from "drop-in next-intl wrapper." Possible
  future companion product, not v1.

## Open experiments (not blockers for v1)

These are worth doing eventually if perf or DX becomes binding:

1. **Codegen declared overloads on a 500-leaf slice.** ~1 day spike.
   Validates whether a `messages.d.ts` of declared overloads
   typechecks faster than `GetICUArgs<R>` at scale. If yes, we have
   a build-time path that gives equal safety at the cost of a build
   step.
2. **Light ICU parser variant.** ~½ day. Single-arg `{name}`
   substitution only, `Record<string, unknown>` fallback for ICU
   plural/select. Worst case: 20% of catalog loses values typing.
   Best case: 80% drop in type-checker cost.
3. **`OnlyOptional` parity.** ~1 hour. Make `values` arg optional
   when `GetICUArgs<R>` returns `{}`. UX nicety, mirrors next-intl.
4. **Per-namespace selector binding.** `useMessageT("Some.Namespace")`
   returns a translator typed against that subtree only, mirroring
   next-intl's namespace-bound `useTranslations(ns)`. Useful for
   teams that want to scope a component's translations.

## What this library is not

- **Not a fork of next-intl.** Wrapper only. We delegate every
  runtime call to next-intl's translator.
- **Not an i18n framework.** No catalogs, no formatter config, no
  middleware. Just the typed selector API on top of next-intl's
  primitives.
- **Not a replacement for `next-intl`'s string-key API.** Both
  shapes can coexist in a project. We offer the selector form for
  users who hit TS2590 or who prefer the call shape.
- **Not opinionated about catalog structure.** Works against
  whatever `IntlMessages` augments to.

## Sources for the architectural decisions

The reasoning above is grounded in the supporting docs in this same
folder. If you need to dig deeper:

- **The pitch** — `selector-api-pitch.html` — single-page
  case-for-this-API at a presentation-ready level.
- **Why selector-leaf was the original answer** — `as-message-key-selector-api-requirements.md`
  and `as-message-key-selector-api-perf-analysis.md`. Captures the
  alternatives we explored (codegen, library swap, type compression)
  and the testbed measurements that led to the property-selector
  pattern.
- **Why we then upgraded to selector-icu** — this doc, plus the
  in-codebase findings in `selector-api-validation-findings.md` and
  `selector-api-validation-perf.md`. The crucial reveal that
  `next-intl` already uses `GetICUArgs<R>` internally is what made
  selector-icu the conservative choice rather than the expensive one.
- **i18next prior art** — `i18next-comparison-research.md`. They
  shipped values typing on the selector pattern in v25; their parser
  is simpler than full ICU but the architectural shape is identical.
- **Implementation-level spec** — `selector-api-handoff.md`. The
  hook surface (`useMessageT`, `useMessageObjectT`, `t.hasLeafRaw`,
  the `OnlyOptional` UX, etc.) is laid out there in detail. This is
  the closest to a checklist for v1 implementation.
- **Validation plan template** — `validation-plan-detailed.md` +
  `selector-api-validation.md`. The U1–U9 plan that proved the API
  surface against real production code in the source codebase.
  Re-runnable as a fitness gate when porting downstream consumers.
- **The legacy cleanup story** — `legacy-cleanup-audit.md`. Maps
  exactly which existing helpers/types in a real codebase get
  deleted alongside the migration. Useful as a real-world migration
  example.

## Implementation principles for v1

A short list of decisions we've made up-front so the agent doesn't
re-litigate them:

1. **Build the wrapper, not a fork.** Wrap `useTranslations` and
   `getTranslations` from next-intl directly.
2. **Selector returns `R extends string`** for the typed-value path.
   Non-generic `=> string` is what we tested as selector-leaf and
   chose not to ship.
3. **Use `@schummar/icu-type-parser` directly** — same as next-intl.
   Don't roll a custom ICU type parser.
4. **`useMessageObjectT` is the sister hook** for non-leaf reads
   (subtrees, arrays). Already type-constrained to reject string
   leaves — those belong on `useMessageT()` for ICU formatting.
5. **`.hasLeafRaw(path)` is the documented runtime-string escape
   hatch.** Lint-restrict its use; every callsite is a place where
   the type system stops protecting the catalog.
6. **Server-side async equivalents** — `getMessageT()` mirrors
   `getTranslations()`. `createMessageTranslator()` mirrors
   `createTranslator()`. Same selector API surface.
7. **Default-tag injection** — preserve next-intl's
   `defaultTranslationValues` for `t.rich` (em/strong/code/etc.)
   without forcing each callsite to merge them. The wrapper passes
   through to next-intl's existing rich machinery; nothing new
   needed.
8. **No backward-compat shim layer.** This is a new library, not a
   migration aid for an existing codebase. Migration patterns
   belong in the consumer codebase, not here.

## Sanity checks before shipping v1

Before tagging 1.0:

- Run the full validation plan (`validation-plan-detailed.md`,
  G1–G5) against a real `en.json` of >5,000 leaves.
- Confirm `--extendedDiagnostics` Check time is within 2× of
  next-intl's plain `t("foo.bar", { name })` at the same callsite
  density. (Should be — same parser underneath.)
- Confirm the 6 "API gaps" from the validation plan all have
  ergonomic answers: dynamic keys, runtime paths, object subtrees,
  rich tags, markup, prop-typed selectors.
- Confirm the `OnlyOptional` UX: a leaf with no placeholders does
  not require `values?: undefined` — it just doesn't take a values
  arg.
- Confirm rich-tag inference: `t.rich(m => m.Welcome, ...)` infers
  the tag callbacks from `<strong>` markers in the leaf, mirroring
  next-intl.

If any of those fails, stop and reconsider before publishing.
