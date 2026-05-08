---
date: 2026-04-29
topic: selector-api-handoff
parent: as-message-key-selector-api-requirements.md
---

# Selector-API translator: implementation handoff

This is the **scoped implementation spec** for replacing the recursive `AsMessageKey` translation-key type with a selector-leaf API around `next-intl`. The decision phase is complete; everything below is execution.

If you find yourself wanting to re-evaluate the approach (codegen vs selector vs library swap), stop and read the parent brainstorm first — those alternatives were explored and rejected with empirical evidence.

---

## The decision (settled — do not re-litigate without checking parent doc)

Replace `AsMessageKey = MessageKeys<IntlMessages, NestedKeyOf<IntlMessages>>` with a **non-generic selector-leaf** shape:

```ts
export type MessageSelector = (m: IntlMessages) => string;
export type SelectorTranslator = (selector: MessageSelector, values?: TranslationValues) => string;
```

Concrete signature for the translator function:

```ts
declare function t(selector: (m: IntlMessages) => string, values?: TranslationValues): string;
```

Why **non-generic** matters: the obvious-looking `t<R extends string>(selector: (m) => R)` form runs almost as slow as the recursive baseline because of per-callsite generic instantiation. The leaf-typed form `(m: IntlMessages) => string` is what hits the `string` lower bound on perf. See `docs/brainstorms/as-message-key-selector-api-perf-analysis.md` for numbers.

Runtime: thin wrapper around `next-intl`'s `t()`. Selector is run against a Proxy that records the property chain into a dot-path; that string is forwarded to the underlying `t(path, values)`.

---

## Already done in the previous worktree

**Brainstorm** at `docs/brainstorms/as-message-key-selector-api-requirements.md` — full decision record, requirements, scope boundaries.

**Perf analysis** at `docs/brainstorms/as-message-key-selector-api-perf-analysis.md` — numbers from the controlled testbed.

**Testbed** at https://github.com/blessanm86/typescript-go-ts2590 (PR #1) — five variants compared, hard numbers under tsc 6.0.2 and tsgo 7.0.0-dev.

**Spike** at `components/ui/src/lib/i18n-selector/`:

- `path-from-selector.ts` — Proxy-based path capture
- `path-from-selector.test.ts` — 4 unit tests, all passing
- `use-message-translator.ts` — `useMessageT()` hook + `MessageSelector` / `SelectorTranslator` types
- `example.tsx` — three illustrative components, never imported

Verified clean on `pnpm exec tsc --noEmit`, `pnpm exec tsgo --noEmit`, `pnpm exec eslint`, and `pnpm exec vitest run path-from-selector.test.ts` (4/4 pass).

The spike's public names are intentionally illustrative (`useMessageT`, not `useTranslations`). Decide final names before migrating — see remaining work R1.

---

## Remaining work

### Naming and surface area

- R1. Decide the public name of the new hook (`useTranslations` itself, replacing the `next-intl` import? `useT`? Keep `useMessageT`?). Same call: `const t = useX()` followed by `t(m => m.X.Y)`. Trade-off: replacing `useTranslations` minimises the codemod (only the import path changes) but causes a larger semantic shift in mental model.
- R2. Decide the prop type alias name to use across the codebase (currently `MessageSelector` in the spike; today's equivalent is `AsMessageKey`).
- R3. Decide whether to expose a non-hook variant for module-scope translators (next-intl uses `createTranslator` for this — see `components/ui/src/lib/intl/metadata.ts`). The spike does not cover this yet.

### Wrapping the rest of the next-intl surface

- R4. `t.rich(selector, tags)` — for translations that include JSX. Currently `t.rich("X.Y", { strong: chunks => <strong>{chunks}</strong> })`. Spike does not cover.
- R5. `t.markup(selector, tags)` — same pattern, returns string. Spike does not cover.
- R6. `t.has(selector)` — checks if a key exists. Spike does not cover.
- R7. `useTranslations(prefix)` — today devs scope a translator to a subtree. Decide the policy: support via `useT(m => m.Some.Prefix)` (a "translator factory selector") or forbid prefixed scopes entirely (Ben's preference in the original Slack thread). Out of scope to *forbid* prefix scopes here; in scope to provide a path that works.
- R8. `getTranslations` (server-side, see `getTranslations.d.ts` from `next-intl/server`). Identify whether the UI uses it; if so, parallel selector wrapper.

### Migration

- R9. Two known workaround sites must be cleaned up:
  - `components/ui/src/infrastructure/gcp/shared/gcp-resource-detail-page.tsx` (lines ~92–125): drop the three `as string` casts in the `useMemo` deps array and the `eslint-disable react-hooks/use-memo, react-hooks/exhaustive-deps` block.
  - `components/ui/src/lib/utils/i18n.test.ts` (lines ~17–21): merge the element-by-element assertions back into a single `expect(result).toEqual([msg, values])`.
- R10. Codemod across `components/ui/src/` to rewrite `t("Foo.Bar")` → `t(m => m.Foo.Bar)` and `t("Foo.Bar", values)` → `t(m => m.Foo.Bar, values)`. Confirm dynamic-key call sites (`t(someStringVar)`) are surfaced for human review, not silently rewritten.
- R11. Migrate prop-typed components (`label: AsMessageKey` → `label: MessageSelector`) and their callers.
- R12. Decide the fate of the deprecated helpers in `components/ui/src/lib/utils/i18n.ts` per helper:
  - `AsMessageKeyWithValues = AsMessageKey | [AsMessageKey, TranslationValues]` — likely delete; selector form makes this unnecessary.
  - `getTranslationProps` — likely delete.
  - `useTranslationsObject` / `getTranslationsObject` — review usage; selector form may need a different shape if any callers actually need the object/array node, not a string.
  - `useIsAsMessageKey` — review usage.

### Cleanup

- R13. Remove `AsMessageKey` and `AsNamespacedMessageKey` from `components/ui/src/types/i18n.ts`. Verify zero remaining references.
- R14. Replace the "Using `AsMessageKey` without tripping TS2590 (tsgo)" section in `components/ui/CLAUDE.md` with selector-API guidance.
- R15. After full migration, re-run `pnpm run verify` under tsgo and confirm: no TS2590 anywhere, no `as string` casts in any deps array, perf hot spots Ben identified are gone (a quick `--extendedDiagnostics` spot-check on a representative file is enough).

---

## Open questions to resolve during planning

These were marked deferred during brainstorming and should be answered before the migration sequence is locked.

- [Affects R7] How should prefixed scopes work? Options: (a) `useT(m => m.Some.Prefix)` returns a translator pre-bound to that subtree, (b) forbid prefixed scopes and migrate every `useTranslations("X")` to a non-prefixed `useT()` call, (c) keep both supported for transition. Spike does not cover this yet.
- [Affects R10] Codemod implementation: jscodeshift, ts-morph, or a one-off TypeScript Compiler API script. The transform is mechanical (string → arrow function with property chain) but needs to handle ICU placeholder values, multi-line keys, and `t.rich` / `t.markup` variants.
- [Affects R12] Per-helper review of the deprecated zone — depends on actual current usage in the codebase.
- [Affects R7, R3] Whether `useTranslations` and the new selector hook should coexist during migration or be swapped atomically. Coexistence is safer but means the recursive type stays loaded for longer.
- [Affects R10] Memoization at the call site. Each render creates a new selector function literal, so the `useCallback` inside `useMessageT` doesn't memoize per-key — that's fine for `t()` correctness but means `useMemo([..., t(m => m.X)])` re-runs every render. Confirm this is acceptable or document the workaround.

---

## Don't re-explore (rejected with evidence)

- **Codegen flat literal union** — works but adds a build step + sync guard, scales linearly with key count, and is slightly slower than selector-leaf. See parent brainstorm § Empirical Validation and the testbed.
- **Generic selector `<R extends string>`** — same call site as selector-leaf, but per-callsite generic instantiation costs almost as much as the recursive baseline. See `docs/brainstorms/as-message-key-selector-api-perf-analysis.md` table row "selector-generic".
- **Tagged template `t\`Foo.Bar\`** — would need a custom TS plugin or build-time AST transform. Carrying cost out of proportion to value.
- **Library swap (i18next, typesafe-i18n)** — out of scope. Stay on `next-intl`.
- **Modularising `en.json`** — separate maintainability initiative. Tracked elsewhere; do not bundle here.
- **Forbidding `useTranslations(prefix)` entirely** — Ben raised this in the Slack thread; it's a separate developer-ergonomics decision after this migration lands.
- **Surrendering to `BigUnion = string`** — Ben verified it makes the IDE pleasant but loses typo and refactor safety; selector-leaf gives the same perf with full safety preserved.

---

## Reference material

- **Parent brainstorm**: `docs/brainstorms/as-message-key-selector-api-requirements.md` — full decision record
- **Perf analysis**: `docs/brainstorms/as-message-key-selector-api-perf-analysis.md` — numbers and methodology
- **Testbed PR**: https://github.com/blessanm86/typescript-go-ts2590/pull/1 — five variants under tsc and tsgo
- **Slack thread (Sept 2025)**: `https://dash0-workspace.slack.com/archives/C07A3GU5NQY/p1759121477007489` — Ben Blackmore's original perf profiling, Thiemo's namespace-split idea, Raphael's colocated-messages prior art
- **Current workaround documentation**: `components/ui/CLAUDE.md` — "Using `AsMessageKey` without tripping TS2590 (tsgo)" section, replaced by R14
- **Deprecated helpers** (slated for review in R12): `components/ui/src/lib/utils/i18n.ts`
- **Existing types** (slated for removal in R13): `components/ui/src/types/i18n.ts`
- **Translator metadata path** (relevant to R3): `components/ui/src/lib/intl/metadata.ts`

---

## Next step

`-> /ce-plan` — produce a sequenced migration plan covering R1–R15, with the open questions above resolved as the plan opens.
