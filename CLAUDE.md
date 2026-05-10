# next-intl-selector

A thin `next-intl` wrapper that swaps string-key lookups for property selectors so TypeScript stops materializing `MessageKeys<NestedKeyOf<Messages>>`.

For users / consumers: see [`README.md`](./README.md).
For the architectural record: see [`docs/DECISION.md`](./docs/DECISION.md).

This file briefs an agent walking into the repo cold.

## Layout

```
src/
├── path-from-selector.ts    # pathFromSelector (Proxy → dot-path) + selectorFromPath (dot-path → selector)
├── wrap-base-translator.ts  # BaseTranslator → SelectorTranslator
├── types.ts                 # public types (BaseTranslator, MessageSelector, SelectorTranslator, TranslateArgs)
├── index.ts                 # main entry: useTranslations, createTranslator, pathFromSelector, selectorFromPath
├── server.ts                # server entry: getTranslations
└── testing.ts               # testing entry: mockSelectorTranslator
```

Tests are colocated as `*.test.ts(x)`. There's a parity-test pattern in `index.test.tsx` that asserts our output matches `use-intl`'s for the same inputs — preserve it when modifying `wrap-base-translator.ts`.

## Commands

- `pnpm install` — pnpm 10.x, pinned via `packageManager` field
- `pnpm run lint` — oxlint (config in `.oxlintrc.json`)
- `pnpm run typecheck` — `tsc --noEmit`
- `pnpm test` / `pnpm run test:watch` — vitest
- `pnpm run build` — tsdown → ESM-only `dist/`
- `pnpm run lint:package` — `publint` + `attw --profile=esm-only`
- `pnpm run prepublishOnly` — full pre-publish gate

## Load-bearing invariants

Things that look optional but will silently break the package:

- **Never import `next-intl`'s `Translator<Messages, Namespace>` type into our type surface.** It carries `MessageKeys<NestedKeyOf<>>` and reintroduces TS2590 at the wrapper boundary. We accept the structural `BaseTranslator` instead — see `src/types.ts`.
- **`NoInfer<R>` in `TranslateArgs<NoInfer<R>>` is required**, not stylistic. Without it, `t(m => m.WithName, { name: "Bob" })` infers `R = "name"` instead of `"Hello {name}"`, breaking ICU values typing. Type tests in `src/types.test.ts` will catch removal.
- **`t.has` is leaf-only by design** (string leaves only, returns false on object subtrees / numbers / null). Documented in the type and pinned by tests in `src/wrap-base-translator.test.ts`. Diverges from `next-intl`'s `t.has` — don't "fix" the divergence.
- **No namespace argument** on `useTranslations`, `createTranslator`, or `getTranslations`. Adding one re-introduces `NamespaceKeys<NestedKeyOf<>>` evaluation and risks TS2590.
- **ESM-only.** `package.json` ships `type: module` with no CJS entry. The build is configured for that. Don't add a CJS output without a strong reason.

## Release flow

- PR titles must be conventional commits (enforced by `.github/workflows/pr-title.yml`).
- CI runs lint + test + build + `publint` + `attw` on every PR (`.github/workflows/ci.yml`).
- Releases are manual: Actions → Release → run with `patch`/`minor`/`major`. `release-it` bumps the version, generates the changelog, tags, pushes, publishes to npm with provenance via OIDC (Trusted Publishing). No long-lived NPM token.
