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

### Critical type constraint

The selector type MUST be **non-generic leaf-typed**: `(m: Messages) => string`

A generic version like `<R extends string>(m: Messages) => R` triggers per-callsite instantiation and is just as expensive as the current approach. This was empirically validated — see `docs/as-message-key-selector-api-perf-analysis.md`.

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
| Existence check | `t.has("Key")` (returns bool) | `t.hasLeaf(m => m.Key)` |
| Dynamic key escape hatch | N/A | `t.hasLeafRaw("runtime.key")` |
| Hook (client) | `useTranslations()` | `useMessageT()` |
| Object retrieval | N/A (custom) | `useMessageObjectT()` |
| Server sync factory | `createTranslator({...})` | `createMessageTranslator({...})` |
| Server async | `getTranslations()` | `getMessageT()` |

### Selector as prop type

```ts
type MessageSelector = (m: Messages) => string;

type Props = { label: MessageSelector };
// Multiple selectors in a tuple — no TS2590
```

## Performance evidence

Validated in a production codebase (Dash0, 7,300-leaf `en.json`, 327 callsites):

- **Per-file**: 15x faster than baseline, matches `string` lower bound (0.10s vs 1.24s tsc)
- **Project-wide tsgo**: 14.8% reduction (7.1s -> 6.1s) from porting just 8 files
- **Worst hotspots**: 62-97% reduction (e.g. 8.7s -> below threshold)
- **Zero TS2590 errors** introduced; all workarounds (`as string` casts) drop cleanly
- **Projected full migration**: 20-25% total typecheck improvement

Details: `docs/selector-api-validation-perf.md`, `docs/as-message-key-selector-api-perf-analysis.md`

## Project status

This repo is in the **research/design phase**. No source code yet — only the `docs/` folder containing research, validation findings, and API design from an internal proof-of-concept at Dash0.

### Key open questions for the userland package

1. **Package name and scope** — e.g. `next-intl-selector`, `@next-intl-selector/core`
2. **How users configure their Messages type** — augmentation vs generic parameter vs config file
3. **Namespace support** — next-intl's `useTranslations("Namespace")` scopes to a subtree; how does the selector equivalent work?
4. **Test strategy** — can we leverage next-intl's own test suite to prevent regressions?
5. **Minimum next-intl version** — which versions does this wrap?
6. **React Server Components** — server-side patterns (`getTranslations`) need to work in RSC context
7. **Bundle size** — the Proxy wrapper should add minimal overhead

## Documentation

The `docs/` folder contains the full research record from the Dash0 proof-of-concept:

| Document | What it covers |
|---|---|
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

## Commands

None yet — project has no source code. Will be updated as package scaffolding is added.
