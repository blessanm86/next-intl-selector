# next-intl-selector

A userland package that wraps [next-intl](https://github.com/amannn/next-intl) with a selector-based translation API, eliminating TypeScript performance bottlenecks at scale.

## Problem

next-intl's type system constructs `MessageKeys<NestedKeyOf<Messages>>` — a string-literal union of every dot-path in the message tree. At scale (~7,000+ leaf keys), this:

- Triggers **TS2590** ("Expression produces a union type that is too complex to represent")
- Generates ~730,000 type instantiations per file
- Causes multi-second IDE lag
- Fails under tsgo with `stableTypeOrdering: true`

## Solution

Replace string keys with **selector functions** that walk the typed Messages object one property at a time, never materializing the full union:

```ts
// Before (next-intl string-key API)
t("MainNavigation.items.home")

// After (selector API)
t(m => m.MainNavigation.items.home)
```

### Type design: selector-icu

The selector type is **generic**: `<R extends string>(m: Messages) => R`

This preserves **full ICU values typing** — the resolved leaf literal is captured as `R`, then `GetICUArgs<R>` (from `@schummar/icu-type-parser`, the same parser next-intl uses) derives the required interpolation values. This matches next-intl's existing values-safety contract.

An earlier variant ("selector-leaf") used non-generic `(m: Messages) => string` which was faster but dropped all values typing. selector-icu was chosen because it doesn't add new cost — it's the same parser, same instantiation cost as baseline next-intl, minus the TS2590 ceiling. At production density (3-10 callsites/file), the overhead vs selector-leaf is ~1.6×.

See `docs/DECISION.md` for the full rationale and benchmarks.

### Runtime mechanism

A Proxy records property accesses, converting `m => m.X.Y` into the dot-path string `"X.Y"`, then delegates to next-intl's existing `t(path)`. The package wraps next-intl — it does not replace or fork it.

## Origin

This package was suggested by the next-intl maintainer (amannn) in [issue #2314](https://github.com/amannn/next-intl/issues/2314) as a userland alternative to adding selector support to next-intl core.

Prior art: [i18next's TypeScript Selector API](https://www.i18next.com/overview/typescript#selector-based-type-safe-translations) (v25.4+) uses the same pattern.

## Target API surface

The package should wrap the full next-intl translation API:

| Operation | next-intl | This package |
|---|---|---|
| Basic translation | `t("Key")` | `t(m => m.Key)` |
| With values | `t("Key", { count: 3 })` | `t(m => m.Key, { count: 3 })` |
| Rich text (ReactNode) | `t.rich("Key", { strong })` | `t.rich(m => m.Key, { strong })` |
| Markup (string) | `t.markup("Key", { em })` | `t.markup(m => m.Key, { em })` |
| Existence check | `t.has("Key")` (returns bool) | `t.has(m => m.Key)` |
| Dynamic key escape hatch | N/A | `t.hasRaw("runtime.key")` |
| Hook (client) | `useTranslations()` | `useTranslations()` |
| Server sync factory | `createTranslator({...})` | `createTranslator({...})` |
| Server async | `getTranslations()` | `getTranslations()` |

### Selector as prop type

For prop/parameter positions (where you pass a selector but don't invoke it), the non-generic form is used:

```ts
type MessageSelector = (m: Messages) => string;

type Props = { label: MessageSelector };
// Multiple selectors in a tuple — no TS2590
```

The generic `<R extends string>` form is only needed at the translator call site where `R` must be captured for ICU argument derivation.

## Performance evidence

### selector-icu (what we ship) — tsgo benchmarks

Measured with tsgo (`@typescript/native-preview@7.0.0-dev.20260421.2`), 3-run median, 7,300-leaf real `en.json`:

| Variant | tsgo Total | Per-callsite | Notes |
|---|---:|---:|---|
| baseline `MessageKeys<NestedKeyOf<>>` | 0.18s | — | hits TS2590, fails to compile |
| selector-leaf (no values typing) | 0.016s | ~0.16ms | not shipping — drops ICU safety |
| **selector-icu (full values typing)** | **0.022s — 0.47s** | **~2 — 4ms** | range = real-density (7) → stress (100 callsites) |

At production density (3-10 callsites/file), selector-icu is ~1.6× selector-leaf. CI-noticeable, IDE-imperceptible.

### Earlier tsc validation (selector-leaf, Dash0 proof-of-concept)

- **Per-file**: 15x faster than baseline (0.10s vs 1.24s tsc)
- **Project-wide tsgo**: 14.8% reduction (7.1s -> 6.1s) from porting just 8 files
- **Worst hotspots**: 62-97% reduction (e.g. 8.7s -> below threshold)

Details: `docs/DECISION.md`, `docs/selector-api-validation-perf.md`, `docs/as-message-key-selector-api-perf-analysis.md`

## Project status

This repo is in the **research/design phase**. No source code yet — only the `docs/` folder containing research, validation findings, and API design from an internal proof-of-concept at Dash0. The architectural decision (selector-icu with full ICU values typing) is settled — see `docs/DECISION.md`.

### Decided

- **Type variant**: selector-icu (`<R extends string>` + `GetICUArgs<R>`). Full ICU values typing preserved.
- **Messages type**: Piggyback on next-intl's `AppConfig.Messages` augmentation — users already set this up.
- **Minimum next-intl version**: >=4.0.0 (requires `AppConfig` augmentation pattern).
- **ICU parser**: `@schummar/icu-type-parser` directly — same as next-intl, no custom parser.
- **Not a fork**: Wrapper only. Delegates every runtime call to next-intl's translator.
- **Same names as next-intl, different import path**: `useTranslations`, `createTranslator`, `getTranslations` — users import from `next-intl-selector` instead of `next-intl`. Same names keep the learning curve minimal and migration mechanical (change import path + change call sites). No dual-mode overloading — our package only accepts selectors, not string keys. Mixing string-key overloads would reintroduce `MessageKeys<NestedKeyOf<>>` into the type, risking TS2590. Users who want string keys in some files keep importing from `next-intl` directly. ESLint `no-restricted-imports` can enforce migration.
- **No namespace parameter**: All three factories (`useTranslations`, `createTranslator`, `getTranslations`) take no namespace argument. Selectors encode the full path (`m => m.Logs.title.default`), avoiding `NamespaceKeys<NestedKeyOf<>>` evaluation which risks TS2590.
- **`BaseTranslator` structural type**: The wrapper accepts a minimal structural type (`{ (key: string, values?): string; rich; markup; has; raw }`) rather than importing next-intl's generic `Translator<Messages, Namespace>`, which carries the full `IntlMessages` union.
- **`useMessageObjectT` descoped from v1**: Non-leaf reads (sub-trees, arrays) and runtime-string lookups are covered by next-intl's existing `useMessages()`. No need for a dedicated hook in the userland package.
- **Single wrapping function**: `wrapBaseTranslator(baseT, options?)` is shared by all three entry points, with an `injectDefaults` flag controlling `defaultTranslationValues` merge in `t.rich`.

- **Package structure follows next-intl's layering**: Main entry (`.`) imports from `use-intl` — works for both `use-intl` and `next-intl` users. Server entry (`./server`) imports from `next-intl/server` — Next.js only. Peer deps: `use-intl >=4.0.0` (required), `next-intl` (optional, for `./server`), `react`.

- **Build tooling**: tsdown (VoidZero/Rolldown-based library bundler). ESM-only output, `.d.ts` generation, peer deps externalized. Two entry points: `src/index.ts` (main) and `src/server.ts` (`./server`). No `react-server` conditional exports needed — the environment forking happens inside `next-intl`/`use-intl` peer dependencies, not in our wrapper layer. Client components use `useTranslations()`, server components use `getTranslations()`.
- **Testing**: Vitest (matches next-intl's test framework). Hybrid strategy — unit tests for our layer, parity tests against next-intl.
- **Package validation**: `publint` + `arethetypeswrong` as pre-publish gates.

### Test strategy

Hybrid approach — test what we own, plus parity checks against next-intl:

1. **Unit: `pathFromSelector`** — selector-to-dot-path conversion, edge cases (single level, deeply nested, symbols)
2. **Unit: `wrapBaseTranslator`** — each method delegates correctly to `BaseTranslator`, `t.has`/`t.hasRaw` leaf-only semantics
3. **Integration: parity** — for a shared message fixture, assert `our t(m => m.Key)` === `next-intl t("Key")` across all methods (plain, rich, markup, raw, has). Catches wrapping bugs without duplicating next-intl's test logic.
4. **Type-level** — `@ts-expect-error` tests: typos error, non-leaf selectors error, ICU values inferred correctly, `MessageSelector` works in prop positions

## Documentation

The `docs/` folder contains the full research record from the Dash0 proof-of-concept:

| Document | What it covers |
|---|---|
| `DECISION.md` | **Canonical architectural decision record** — selector-icu rationale, perf envelope, ruled-out alternatives, implementation principles |
| `selector-api-pitch.html` | Visual pitch deck (the gist shared externally) |
| `as-message-key-selector-api-requirements.md` | Original problem statement and requirements |
| `as-message-key-selector-api-perf-analysis.md` | Benchmarks of 5 type variants |
| `selector-api-handoff.md` | Implementation spec for the internal migration |
| `selector-api-validation.md` | Phase 1 validation scope and plan |
| `validation-plan-detailed.md` | 9-unit implementation breakdown |
| `selector-api-validation-findings.md` | Validation results and recommendations |
| `selector-api-validation-perf.md` | Quantitative perf measurements |
| `dynamic-key-audit.md` | Audit of 54 runtime-dynamic key sites |
| `i18next-comparison-research.md` | i18next selector API comparison |
| `legacy-cleanup-audit.md` | Deprecated symbol inventory |

## External references

- **Upstream issue**: https://github.com/amannn/next-intl/issues/2314
- **Perf reproduction repo**: https://github.com/blessanm86/typescript-go-ts2590
- **i18next selector docs**: https://www.i18next.com/overview/typescript#selector-based-type-safe-translations
- **Internal proposal PR**: https://github.com/dash0hq/dash0/pull/12061

## Source structure

```
src/
├── index.ts                    # Main entry: useTranslations, createTranslator, type re-exports
├── index.test.tsx              # Hook + factory tests, parity tests against next-intl
├── server.ts                   # Server entry: getTranslations
├── server.test.tsx             # Server parity tests
├── path-from-selector.ts       # Proxy-based selector → dot-path conversion
├── path-from-selector.test.ts  # Edge cases: single level, deep nesting, symbols
├── wrap-base-translator.ts     # BaseTranslator → SelectorTranslator wrapping
├── wrap-base-translator.test.ts # Method delegation, t.has/t.hasRaw leaf-only semantics
├── types.ts                    # MessageSelector, SelectorTranslator, BaseTranslator
└── types.test.ts               # @ts-expect-error: typos, non-leaf, ICU values inference
```

## Commands

- `pnpm install` — install dependencies (pnpm 10.x)
- `pnpm run lint` — type-check the project (`tsc --noEmit`)
- `pnpm test` — run the Vitest suite once
- `pnpm run test:watch` — watch mode for Vitest
- `pnpm run build` — build the package via tsdown to `dist/` (ESM + `.d.ts`)
- `pnpm run lint:package` — `publint` + `arethetypeswrong` against the packed tarball
- `pnpm run prepublishOnly` — full pre-publish gate: build + package validation
