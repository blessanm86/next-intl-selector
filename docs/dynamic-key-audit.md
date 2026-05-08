# Dynamic translation-key audit

Companion to [`selector-api-pitch.md`](./selector-api-pitch.md). Catalogues every site in `components/ui/src` where a translation key is *not* a compile-time literal at the call site, so the migration plan knows up front what to restructure and what needs an escape hatch.

The grep used: `as AsMessageKey` (case-sensitive). 54 instances total — 11 in test/storybook fixtures, 43 in production code. The 43 production sites bucket cleanly into three groups.

---

## TL;DR

| Bucket | Sites | Files | What to do |
|---|---|---|---|
| **Restructurable (case c)** | ~33 | ~13 | Refactor the API shape so the selector lives at the static-typing boundary. Most of these are one repeated pattern — see "PageLayoutAction button family" below. |
| **Genuinely runtime (case a)** | 4 | 2 | Add `t.translateRaw(path: string)` escape hatch on the wrapper. Lint-restrict its use. |
| **Test/storybook fixtures** | 11 | 5 | Trivial codemod or leave alone. Not load-bearing. |

The codemod from the migration plan handles the simple syntactic ports (`t("X.Y")` → `t(m => m.X.Y)`). It cannot handle the restructures — those need a small pre-flight refactor before the codemod runs.

---

## Bucket A — genuinely runtime, no compile-time path

These two files have inputs that really only exist at runtime. The selector form fundamentally cannot model them.

### `infrastructure/gcp/shared/metric-label-key.ts`

```ts
export function resolvePercentileLabelKey(metric: string): AsMessageKey {
  for (const suffix of PERCENTILE_SUFFIXES) {
    if (metric.endsWith(suffix)) {
      return `Metrics.short.${suffix.slice(1)}` as AsMessageKey;
    }
  }
  return `Metrics.short.${metric}` as AsMessageKey;
}
```

`metric` is a runtime string (e.g. `gcp_cloud_run_request_latency_p99`) coming from the GCP metric SDK. Two sites here.

### `metrics/.../duration-metric-details.tsx`

```tsx
{tAggregations(config.getTranslationKey(selectedAggregation) as AsMessageKey)}
```

`config.getTranslationKey(aggregation)` is a config-provided function that maps a string aggregation name to a path. The function's caller doesn't know what string will come back. Two sites.

(The function *could* be restructured to return a `MessageSelector` instead of a string — bumping this into bucket (c) — but that's a bigger config-API change. Easier to escape-hatch the two sites.)

### Migration recipe

Add a runtime-string escape hatch on the new translator:

```ts
type SelectorTranslator = {
  // existing methods...

  /**
   * Runtime-string escape hatch. Use only when the path is genuinely
   * not knowable at compile time (e.g. coming from a third-party SDK).
   * Lint-restricted; a per-file `eslint-disable-next-line` is required.
   */
  translateRaw(path: string, values?: TranslationValues): string;
};
```

Behavior is the same as the legacy `t(string)` — wrap `baseT` and forward. Add the lint rule under `eslint-plugin-dash0` to require an opt-in disable. Goal: ~5 disable comments in the entire codebase.

---

## Bucket B — restructurable (case c)

The path *is* statically constructible. The cast exists because the path is being built across a component or function boundary using a string template, and the template loses TypeScript's type info on the way through.

### B1. PageLayoutAction button family — 21 sites across 7 files

The single biggest restructure target. All seven buttons (`edit`, `discard`, `create`, `delete`, `save`, `clone`, `share`) follow the same pattern:

```tsx
// Today — inside each button:
useKeyboardShortcut({
  category:    `Commands.${commandNamespace}.category`           as AsMessageKey,
  description: `Commands.${commandNamespace}.edit.description`   as AsMessageKey,
  searchTags:  `Commands.${commandNamespace}.edit.searchTags`    as AsMessageKey,
  // ...
});
```

`commandNamespace` is typed `AsNamespacedMessageKey<"Commands">` — a literal union of valid Commands paths. So the values are static at every real call site (`commandNamespace="alerting.synthetics"`, `commandNamespace="Dashboard"`, etc.) — but TypeScript can't prove that the *built path* exists for every member of the union (different namespaces have different action subsets), so the cast papers over that gap.

**Restructure: push selector construction to the caller.**

```tsx
// New — caller writes the full selectors:
<PageLayoutActions.EditButton
  enableShortcut
  selectors={{
    description: m => m.Commands["alerting.synthetics"].edit.description,
    searchTags:  m => m.Commands["alerting.synthetics"].edit.searchTags,
    category:    m => m.Commands["alerting.synthetics"].category,
  }}
>
```

Verified: `m.Commands["alerting.synthetics"].edit.description` exists in `en.json`; the selector chain type-checks. Each call site is fully typed, no cast. Buttons stop building strings — they store and call selectors.

Cost: each call site goes from one prop to one object with three selectors. Verbose but explicit. Estimated ~15 button call sites in the codebase to update.

This refactor is **a single pre-flight PR before the codemod**. The codemod's auto-fix can't handle it because the change is structural (prop shape changes), not syntactic.

> **Why this isn't ported in the validation slice:** the validation initially included a half-port of `command-palette-view.tsx` that swapped `useTranslationsObject` for `useMessageObjectT` while keeping `useTranslations` for the dynamic-string `t()` calls. That half-port was reverted on review — the runtime-string narrowing it introduced was over-engineered for a file whose dynamism disappears entirely once B1 lands. The G5 escape hatch (`useMessageObjectT.raw`) is still demonstrated in production code via `use-get-column-label.ts`.

### B2. `useErrorMessage` — 4 sites in `lib/errors/use-error-translations.tsx`

```tsx
// Today:
const t = useTranslations();
for (const [key, value] of Object.entries(errorsByMessage)) {
  if (typeof value === "string" && errorMessage.includes(value)) {
    return t(key as AsMessageKey);    // 4 of these casts in the file
  }
  // ...
}
```

Caller passes `Partial<Record<AsMessageKey, ...>>` — the keys *are* static literals at the call site, but `Object.entries` widens them to `string`. The cast pulls them back to `AsMessageKey`.

**Restructure: take an array of entries instead of an object.**

```ts
useErrorMessage([
  { selector: m => m.errors.timeRangeInvalid, condition: "timestamp cannot be earlier than" },
  { selector: m => m.errors.rateLimited,       condition: "rate limit exceeded" },
  { selector: m => m.errors.exceededMaxWeeks,  condition: error => /exceeded maximum (\d+) weeks/.exec(error.message)?.[1] ?? false },
]);
```

Each entry's selector is type-checked at the caller. The hook iterates the array and calls each selector via `t()`. No cast.

### B3. `command-palette-view.tsx` — downstream of B1, ports after the button family

This file's dynamism comes entirely from consuming the runtime strings that the B1 button family produces. The validation phase deliberately **leaves it untouched on the legacy hook** — porting it before B1 forces ugly `as unknown as ...` narrowing dances around `AsMessageKeyWithValues | undefined` that go away once commands store selectors instead of strings.

```tsx
// Today:
const t = useTranslations();
const getMessage = useTranslationsObject();
// ...
heading={disableCategoryTranslation ? categoryKey : t(categoryKey as AsMessageKey)}
description: t(...getTranslationProps(command.description)),
const searchTags = getMessage(command.searchTags as AsMessageKey);
```

```tsx
// After B1's restructure (commands store selectors):
const t = useMessageT();
// ...
heading={disableCategoryTranslation ? categoryKey : command.categorySelector?.(m) ?? categoryKey},
description: command.description(m),                  // command.description IS the selector
const searchTags = command.searchTags?.(messages);    // selector, not a string template
```

The file becomes a clean port automatically. **Sequence: B1 first, then port this file as part of the codemod step.** The validation slice does not touch it.

### B4. Column / group label readers — 3 files

Same pattern as `useGetColumnLabel.ts` (already ported in U7).

| File | Site |
|---|---|
| `services/.../service-catalogue-header.tsx` | `t(definition.label as AsMessageKey)` |
| `components/ui/table/table-sort-dropdown-options.ts` | `t(groupLabel as AsMessageKey)` |
| `resources/.../resource-table-tree-map.tsx` | `tRoot(column.label as AsMessageKey)` |

Each reads `.label` off a column or group definition. The U7 port already widened `TableDefinitionCommon.label` to `string | MessageSelector | HardCodedLabel`. These three files port to the same `useMessageObjectT.raw` + selector union pattern that `useGetColumnLabel.ts` now uses.

The codemod can probably auto-port them with the right rule. Worst case, hand-port — small files, clear pattern.

### B5. `deep-links/core/types.ts` — 2 trivial constant ports

```ts
// Today:
export const HIDDEN_PARAM_CONFIG = {
  labelTranslationKey:   "DeepLinks.params.hidden.label"   as AsMessageKey,
  tooltipTranslationKey: "DeepLinks.params.hidden.tooltip" as AsMessageKey,
};

// After:
export const HIDDEN_PARAM_CONFIG = {
  labelSelector:   (m: IntlMessages) => m.DeepLinks.params.hidden.label,
  tooltipSelector: (m: IntlMessages) => m.DeepLinks.params.hidden.tooltip,
};
```

Update the constant + the type of its consumer. Mechanical.

---

## Bucket C — test/storybook fixtures

Not production code paths. Listed for completeness:

| File | Sites |
|---|---|
| `components/ui/table/testdata/actor-table-definition.tsx` | 1 |
| `components/ui/table/testdata/actor-table-definition-with-groups.tsx` | 4 |
| `components/ui/table/table-definition.stories.tsx` | 1 |
| `components/ui/table/table-sort-dropdown-options.test.ts` | 2 |
| `components/ui/shortcuts/use-keyboard-shortcut.test.tsx` | 1 |
| `lib/utils/i18n.test.ts` | 5 (the validation slice already touched 3 of these) |

Codemod-able with a simple rule, or leave them on the legacy hook for the test fixtures since they're not load-bearing.

---

## Migration sequencing

1. **Pre-flight refactor: PageLayoutAction button family (B1).** Single PR. ~7 buttons + ~15 call sites. Lands before the codemod.
2. **Add `t.translateRaw(path)` to the wrapper.** With its lint rule. The 4 bucket-A sites use this with documented `eslint-disable` comments. (B2's restructure can also land here if we want — it's a small surface change.)
3. **Codemod PR.** ESLint rule with auto-fix; `pnpm lint:fix` against the codebase; spot-check the diff.
4. **Hand-port the bucket B4 stragglers** if the codemod can't fully auto-handle column/group label readers. Small, ~3 files.
5. **Cleanup.** Remove the legacy `useTranslations` shim, deprecated `i18n.ts` helpers, eventually `AsMessageKey`.

After steps 1–4 land, the codebase contains:
- Selector form everywhere except 4 explicitly-marked `t.translateRaw` escape-hatch sites
- Zero `as AsMessageKey` casts in production code
- All template-built keys gone

---

## Outstanding questions for implementation

- **B1 prop shape.** `selectors={{ description, searchTags, category }}` is fine, but we could also flatten: `descriptionSelector`, `searchTagsSelector`, `categorySelector`. Decide on aesthetic preference during the pre-flight PR.
- **B3's interaction with B1.** Once B1 stores selectors on the registered command, the `Command` type changes from `{ description: AsMessageKey; ... }` to `{ description: MessageSelector; ... }`. Every consumer of registered commands needs to call the selector instead of treating it as a key. Mostly the command palette, but worth a grep before B1 lands to make sure nothing else holds onto `command.description` as a string.
- **Codemod scope for B4.** Decide whether the ESLint auto-fix tries to handle column-label-reader sites or if we hand-port them.

---

## Sources

- Grep used: `grep -rE "as AsMessageKey" src/ --include='*.ts' --include='*.tsx'`
- File counts verified with `Grep` tool, deduplicated by file path
- Audit conducted on `next-intl-Perf-Fix` branch at commit `a943ddfbb0`
