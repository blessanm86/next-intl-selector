# Perf analysis — variants for `MessageKeys<NestedKeyOf<Messages>>` at scale

Source testbed: https://github.com/blessanm86/typescript-go-ts2590 (locally cloned to `/tmp/typescript-go-ts2590`).

**Setup**: `fixture.json` = 7,161 leaves, depth 9 (anonymized scramble of dash0's `en.json`). Each variant has identical usage shape: 100 typed-prop function declarations, 100 callsites passing concrete keys, 1 array literal of two key values (the original TS2590 trigger), 1 `[Key, Values]` tuple, 1 `useTranslations()` stub. Runs: 3 cold runs per variant per compiler, median reported. Compilers: `typescript@6.0.2` and `@typescript/native-preview@7.0.0-dev.20260421.2` (tsgo).

## Variants

- **baseline** — `BigUnion = MessageKeys<Messages, NestedKeyOf<Messages>>` (current production approach).
- **string** — `BigUnion = string` (lower bound: no type safety, tells us how much the type itself costs).
- **codegen** — flat literal union emitted from `fixture.json`: `type FlatKeys = "k0" | "k0.k1" | ...;`.
- **selector-generic** — `<R extends string>(selector: (m: Messages) => R) => string`.
- **selector-leaf** — non-generic: `(selector: (m: Messages) => string) => string`. Property access still type-checked through `Messages`; the `=> string` constraint forbids selectors landing on intermediate-object or non-string-leaf nodes.

## Numbers

### tsc 6.0.2 (median of 3 cold runs)

| Variant | Total | Check | Types | Instantiations | Memory | TS2590 |
|---|---:|---:|---:|---:|---:|---|
| baseline | 1.24 s | 1.18 s | 49,990 | 730,585 | 207 MB | passes (workaround in current ordering) |
| string | 0.08 s | 0.03 s | 4,503 | 15 | 45 MB | n/a |
| codegen | 0.12 s | 0.06 s | 18,482 | 15 | 53 MB | n/a |
| selector-generic | 1.16 s | 1.10 s | 4,628 | 324 | 77 MB | n/a |
| **selector-leaf** | **0.10 s** | **0.04 s** | **4,614** | **15** | **61 MB** | **n/a** |

### tsgo 7.0.0-dev (median of 3 cold runs)

| Variant | Total | Check | Types | Instantiations | Memory | TS2590 |
|---|---:|---:|---:|---:|---:|---|
| baseline | 0.19 s | 0.18 s | 50,253 | 728,557 | 38 MB | **fails** |
| string | 0.02 s | 0.007 s | 4,758 | 15 | 16 MB | n/a |
| codegen | 0.03 s | 0.018 s | 32,914 | 15 | 22 MB | n/a |
| selector-generic | 0.31 s | 0.30 s | 4,883 | 324 | 17 MB | n/a |
| **selector-leaf** | **0.017 s** | **0.008 s** | **4,869** | **15** | **17 MB** | **n/a** |

## Findings

1. **Confirms Ben's hypothesis** (Slack thread Sept 2025). Baseline runs **730,585 instantiations** for one file with 100 callsites. Switching to `string` drops that to 15 and total time by ~15×. The recursive type *is* the cost, not just the TS2590 ceiling. Multi-second `useTranslations` evaluations and IDE lag are direct downstream effects.

2. **Codegen flat union fixes TS2590 and most of the perf cost** (~10× faster on tsc, ~7× on tsgo). Drop-in replacement of just the type definition. Cost: a build script + sync guard. Scales linearly with key count (Types grew to 18k–33k for 7,087 literal members).

3. **Selector-generic (`<R extends string>`) is *not* a perf win.** Almost as slow as baseline (1.10s check vs 1.18s on tsc, 0.30s vs 0.18s on tsgo). The cost is per-callsite generic instantiation: 100 callsites × `<R extends string>` constraint validation. The i18next ecosystem's selector pattern is correct in *intent*, but the specific generic shape matters.

4. **Selector-leaf (`(m: Messages) => string`) wins decisively.**
   - **Total time on tsgo: 0.017s** — 11× faster than baseline, on par with `string` lower bound.
   - **No build step.** Just a TypeScript type definition.
   - **Same error coverage as the current type**: catches typos at root and deep in the chain (TS2339), and rejects intermediate-object selectors that don't land on a string leaf (TS2322 — "type '{...}' is not assignable to type 'string'").
   - **Scales with no marginal cost.** Adding 10,000 more keys to `en.json` doesn't change typecheck cost — the type does not enumerate keys.
   - **Fixes TS2590** at the original trigger and in tuple/deps positions, because no string-literal union is ever constructed.

## Comparison summary

| Property | baseline | codegen | selector-leaf |
|---|---|---|---|
| Fixes TS2590 | no | yes | yes |
| Total time vs. baseline | 1× | ~10× faster | ~15× faster |
| Build step needed | no | yes | no |
| Scales as `en.json` grows | bad | linear | flat |
| Catches typos | yes | yes | yes |
| Catches non-string leaf | yes | implicit (never emitted) | yes (`=> string`) |
| Drop-in vs. callsite migration | drop-in | drop-in | callsite migration |

## Recommendation

**Adopt selector-leaf.** Codegen is a viable fallback if the selector wrapper proves harder to integrate with `next-intl` runtime than expected, but the type-system-level evidence makes selector-leaf the structurally cleanest answer.

The remaining work moves to two questions the testbed cannot answer:

- **Runtime path resolution.** A Proxy-based wrapper around `next-intl`'s `t()` to convert `m => m.X.Y` to `"X.Y"` at call time. Needs benchmarking but well-understood pattern.
- **Codemod scope.** Mechanical rewrite of `t("X.Y")` → `t(m => m.X.Y)` across ~69 files in `components/ui/src/`.

## Reproduce

```bash
git clone https://github.com/blessanm86/typescript-go-ts2590.git
cd typescript-go-ts2590
pnpm install --ignore-workspace

# Generate the fixture-derived flat union and the variant scenes
node gen-flat-union.mjs
node gen-sample-keys.mjs
node gen-scenes.mjs
node gen-selector-simple.mjs   # creates repro-selector-simple.ts
node gen-selector-leaf.mjs     # creates repro-selector-leaf.ts

# Then per-variant tsconfigs and the measurement runner are committed alongside.
node run-measure.mjs
```

The scripts and per-variant tsconfigs are in the testbed repo. PERF-ANALYSIS.md mirrors this document.
