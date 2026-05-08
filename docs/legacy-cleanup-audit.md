# Legacy i18n cleanup audit

Companion to `selector-api-pitch.html` and `dynamic-key-audit.md`. Three files contain
deprecated or about-to-be-deprecated symbols related to the next-intl → selector-API
migration. This audit inventories every consumer and proposes a per-symbol treatment.

**Files in scope**
- `components/ui/src/types/utils.ts` — one symbol marked `@deprecated`
- `components/ui/src/lib/utils/i18n.ts` — five symbols, all marked `@deprecated`
- `components/ui/src/types/i18n.ts` — three symbols, not yet deprecated but the pitch
  marks them for deletion in step 3 of the rollout

For each symbol I list the consumer count, then a treatment with confidence level. The
"sequencing" section at the bottom turns this into a buildable order of operations.

---

## TL;DR

| Symbol | File | Active sites | Treatment |
|---|---|---|---|
| `useIsAsMessageKey` | `lib/utils/i18n.ts` | 0 | Delete now (dead code, 1-line PR) |
| `getTranslationsObject` | `lib/utils/i18n.ts` | 0 external | Delete with hook below |
| `useTranslationsObject` | `lib/utils/i18n.ts` | 1 | Migrate command palette → `useMessageObjectT()` + `.raw()` |
| `getTranslationProps` | `lib/utils/i18n.ts` | 1 | Falls out when `CommandEntry.description` flips to selector form |
| `AsMessageKeyWithValues` | `lib/utils/i18n.ts` | 3 (all in command-registry types) | Replace with `MessageSelector \| [MessageSelector, values]` |
| `AsMessageKey` | `types/i18n.ts` | 35 prop sites + 4 casts | Delete after migration; replace with `MessageSelector` (props) or plain `string` (boundaries) |
| `AsNamespacedMessageKey<P>` | `types/i18n.ts` | 11 prop sites + 5 casts | Delete; replace with namespaced selectors `(m: IntlMessages["X"]) => string` |
| `Translator` | `types/i18n.ts` | 12 sigs + 2 test mocks | Replace with `SelectorTranslator`; mechanical rename |
| `StringLiteral<T>` | `types/utils.ts` | 17 | **Out of scope per pitch**, but inventoried below — none of the 17 actually need it |

**Reading the table:** the first five rows are local cleanup, contained in 3–5 files. The
next three are the migration. The last row is independent and stays parked.

---

## A. `lib/utils/i18n.ts` — deprecated helpers

All five symbols can be deleted in a single PR. Active scope is the `command-palette`
component family plus one Agent0 shortcut hook.

### A1. `useIsAsMessageKey<T>()` — DEAD CODE

- **0 call sites.** Only references are a docstring in `use-message-translator.test.tsx`
  and a comment in `use-get-column-label.ts`.
- **Treatment:** delete now. Doesn't need to wait for the migration PR.
- **Replacement going forward:** `t.hasLeafRaw(path: string)` already exists on
  `SelectorTranslator`.

### A2. `getTranslationsObject<T>(messages, path)` — internal-only

- **0 external call sites.** Only consumed by `useTranslationsObject()` (its own hook
  wrapper) and tested directly in `lib/utils/i18n.test.ts`.
- **Treatment:** delete together with the hook below.
- **Replacement:** `useMessageObjectT()(selector)` for React contexts. There is no
  non-hook caller to worry about.

### A3. `useTranslationsObject<T>()` — 1 caller

- **`components/commands/command-palette-view.tsx:25`** — reads `command.searchTags`
  via runtime path resolution. Currently casts the raw string to `AsMessageKey` before
  passing to the legacy hook.
- **Treatment:** swap to `useMessageObjectT()`. The runtime-string path resolution maps
  to `.raw(path)`, the documented escape hatch.
- **Confidence:** high — this is the canonical use case the new hook was designed for.

### A4. `getTranslationProps(message)` and `AsMessageKeyWithValues`

- **`AsMessageKeyWithValues`** is a tuple-or-key union used in three command-registry
  prop types:
  - `shortcuts/key-command-registration.tsx:200` — `CommandEntry.description`
  - `shortcuts/key-command-registration.tsx:228` — `CommandEntry.searchTags`
  - `agent0/utils/use-agent0-shortcut.ts:23` — `description` opt
- **`getTranslationProps`** has one production caller at `command-palette-view.tsx:80`,
  used to spread the tuple-or-key into `t(...)`.
- **Treatment:** flip `CommandEntry.description` and `searchTags` to
  `MessageSelector | [MessageSelector, TranslationValues]`. The spread pattern
  (`t(...getTranslationProps(x))`) becomes
  `Array.isArray(x) ? t(x[0], x[1]) : t(x)` at the single rendering callsite, or the
  callers can be normalised at registration time.
- **Confidence:** medium-high — three definition sites need to flip in lockstep, plus
  every `CommandEntry` literal in the codebase. The change is mechanical but multi-file.
- **Side effect:** once `description` is selector-typed, `getTranslationProps` is
  unreachable and can be deleted.

### A5. Tests in `lib/utils/i18n.test.ts`

10 assertions across 4 `describe` blocks. Delete the file with the helpers; nothing
else needs the coverage because the new hooks have their own test files
(`use-message-translator.test.tsx`, `use-message-object-t.test.tsx`).

---

## B. `types/i18n.ts` — types not yet deprecated

These three are the "skin" of the legacy API. The pitch marks `AsMessageKey` for
deletion; the audit shows the same conclusion applies to `AsNamespacedMessageKey` and
`Translator`. None of them survive the migration.

### B1. `AsMessageKey` — 35 prop sites + 4 cast sites

**Prop sites (all bucket A — single-value positions, safe for TS2590 today):**
mostly table column labels, sidebar card props, GCP resource labels, filter dialog
strings. A representative sample:

- `components/ui/table/types.ts:272` — `label: AsMessageKey` on every column definition
- `components/non-primitive/filteringv2/types.ts:189–195` — three filter-dialog props
- `infrastructure/gcp/shared/gcp-metric-chart.tsx:48,50` — chart titles
- `components/ui/tabbed-page-renderer.tsx:32` — already `AsMessageKey | MessageSelector`
  hybrid, will simplify to selector-only after migration

**Cast sites (4 sites, all covered in `dynamic-key-audit.md`):**
- `infrastructure/gcp/shared/metric-label-key.ts:29,34` — bucket A (genuine runtime;
  uses `t.hasLeafRaw` after port)
- `metrics/.../duration-metric-details.tsx:43` — bucket A (config-driven)
- `lib/errors/use-error-translations.tsx:68,72,79,83` — bucket B2 (Object.entries
  widening; restructurable)

**Treatment:**
- Each `AsMessageKey`-typed prop becomes `MessageSelector`. The hybrid pattern at
  `tabbed-page-renderer.tsx` proves both forms can coexist if a transitional state
  is wanted, but per the pitch we're going big-bang.
- The 4 cast sites resolve via the `dynamic-key-audit.md` plan (bucket A → escape
  hatch, bucket B2 → restructure).
- After migration, `AsMessageKey` itself has no surviving consumer. **Delete the
  export.**

**One subtlety:** the `tabbed-page-renderer.tsx` hybrid means at least one prop type
already accepts both forms. We can use that pattern to phase the migration if review
asks for incremental landing — but that contradicts the "one big-bang PR" decision in
section 06. Default: drop the hybrid, accept selector-only.

### B2. `AsNamespacedMessageKey<Prefix>` — 11 prop sites + 5 cast sites

This type narrows keys to a sub-tree (e.g. `AsNamespacedMessageKey<"Commands">` only
accepts keys under `Commands`). After the migration, the same constraint expresses as
a typed selector return:

- old: `label: AsNamespacedMessageKey<"AppSidebar.items">`
- new: `label: (m: IntlMessages["AppSidebar"]["items"]) => string`

Or, when the constraint is incidental (the prop just happens to read from one
namespace), drop it entirely and use `MessageSelector`.

**Notable cluster:** `components/ui/action-button.tsx:156` — `commandNamespace:
AsNamespacedMessageKey<"Commands">` is the type that gates the
`PageLayoutAction` button family (~21 callers, bucket B1 in the dynamic-key audit).
This single prop change ripples through the largest cluster of restructure work.

**Five cast sites** (`as AsNamespacedMessageKey<...>`) are template-built keys
restricted to a namespace — restructurable via selector or `t.hasLeafRaw`. Lower
priority than the `AsMessageKey` casts.

**Treatment:** delete `AsNamespacedMessageKey` after the migration. The 11 prop sites
each become a typed selector; the 5 cast sites resolve via restructure or escape hatch.

### B3. `Translator` — 12 callable signatures + 2 test mocks

`Translator = ReturnType<typeof useTranslations>` — every function whose signature
says "give me a `t`". Examples:

- `lib/forms/utils/zod-resolver-with-translations.ts:39,74` — zod resolver translation
- `views/components/views-list.tsx:188` — list rendering helper
- `dashboarding/.../createDefaultValues.ts:51` — form defaults
- `lib/formatters/formatDate.tsx:83` — date formatting
- `agent0/.../tool-message.tsx:100` — tool registry callback type

None of them parameterize the type with a generic; all are "pass `t` in." Replacement
is a flat rename to `SelectorTranslator` from `@ui/lib/i18n-selector/use-message-translator`.

**Treatment:** mechanical rename across 14 sites. Each callable function body must
also flip its `t("foo.bar")` calls to `t(m => m.foo.bar)`, but that's part of the
codemod scope already.

**Test mocks** — `formatDate.test.ts:240` and `zod-resolver-with-translations.test.ts:17`
construct mock translators. Both need new shape: `SelectorTranslator` is a callable
with `.rich`, `.markup`, `.hasLeaf`, `.hasLeafRaw` — the mocks must mirror that surface.
Confidence: medium; this is the only place test fixtures could become awkward.

---

## C. `types/utils.ts` — `StringLiteral<T>`

**Out of scope per the pitch** ("removing the type entirely" is listed under the
section-05 footer). Including the inventory here so the data exists if/when someone
picks up that cleanup.

**17 call sites** classified by treatment:

- **Replace with `T` (4 sites):** the call site never uses the open-string fallback.
  - `table/types.ts:133` — column key (validated against object shape)
  - `lib/filter-criteria/filterCriteria.ts:778` — operator name (closed enum)
  - `lib/filter-criteria/.../conversions.ts:81` — single literal `"value"`
  - `code-mirror/langs/sql/sql-completion-utils.ts:32` — single literal `"operator"`
  - `content-sections/content-sections-stat.tsx:26` — single literal `"auto"`

- **Replace with `T | string` (4 sites):** open-string is used but autocomplete loss
  is fine.
  - `lib/intl/metadata.ts:16` — `pathPrefix: StringLiteral<AsMessageKey>` —
    **only intersection with this migration**; see note below.
  - `table/types.ts:146,355` — column-config props
  - `lib/client/fetching/fetch.server.ts:36` — config field

- **Keep / migrate to `as const` discriminated union (8 sites):** small static unions
  where autocomplete is a real DX benefit and the union isn't expensive.
  - `views/.../renderer-switch.tsx:14` — visualisation toggle
  - `lib/colors/palettes/.../synthetic-check-runs-status.ts:36` — palette name
  - `components/ui/skeleton.tsx:68` — size keys
  - `components/ui/resizable-list/.../list-groups.tsx:16` — `"starred" | "ungrouped"`
  - `components/ui/function-call.tsx:29` — bracket pairs
  - `views/components/views-list-groups-state.ts:11` — view group names
  - `agent0/.../agent-markdown-content/index.tsx:41` — backend-derived ContextType
  - `metrics/.../web-events-metric-picker/duration-metric-details.tsx` — metric name

- **Dead code (1 site):** `lib/filter-criteria/.../conversions.ts:81` (also listed
  above; the type argument is a literal so `StringLiteral` adds nothing).

**Patterns observed:**
- `StringLiteral<AsMessageKey>` appears only in `lib/intl/metadata.ts`. That file is
  the only place the StringLiteral cleanup *touches* the i18n migration. Treatment:
  during the migration PR, drop the wrapper — `pathPrefix: string` is fine because the
  prefix is concatenated at runtime anyway. The autocomplete loss is acceptable given
  the function takes a partial path.
- No call site justifies keeping `StringLiteral` for its original "preserve autocomplete
  while allowing arbitrary strings" purpose.

This whole cleanup can land any time as an independent PR.

---

## Sequencing — three PRs

### PR 0 (pre-flight, 1-liner)
Delete `useIsAsMessageKey` from `lib/utils/i18n.ts`. Zero call sites. Doesn't need to
wait for anything.

### PR 1 (the migration — same as pitch step 06)
Bundle of work:

1. ESLint codemod for `t("…")` → `t(m => …)` across the ~1,195 importers of
   `@ui/i18n/use-translations`.
2. Hand-port the dynamic-key audit's restructurable cluster (~33 sites, ~21 of which
   are the `PageLayoutAction` button family — `commandNamespace` flip in
   `action-button.tsx`).
3. Hand-port the four genuinely-runtime sites to `t.hasLeafRaw` / `useMessageObjectT().raw()`.
4. Migrate `command-palette-view.tsx` + `key-command-registration.tsx` +
   `use-agent0-shortcut.ts` (deletes `useTranslationsObject`, `getTranslationProps`,
   `AsMessageKeyWithValues` in one component family).
5. Flip 35 `AsMessageKey`-typed props to `MessageSelector`.
6. Flip 11 `AsNamespacedMessageKey<P>` props to typed selectors
   `(m: IntlMessages["P"]) => string`.
7. Flip 12 `Translator` function params to `SelectorTranslator`. Update 2 test mocks.
8. Drop the `StringLiteral<AsMessageKey>` wrapper in `lib/intl/metadata.ts` (this is
   the only StringLiteral site touched).
9. Delete files:
   - `lib/utils/i18n.ts` (entire file + tests)
   - Exports `AsMessageKey`, `AsNamespacedMessageKey`, `Translator` from `types/i18n.ts`
   - The `useTranslations` shim at `i18n/use-translations.ts` (or keep it internal to
     `wrap-base-translator.ts` as the boundary that injects defaults — pick one in PR)
10. Delete the `no-restricted-imports` override added during validation.

### PR 2 (independent, any time after)
`StringLiteral<T>` cleanup across the remaining 16 sites. Per-site treatment in the
table above. No dependency on the migration except that PR 1 already drops site #1
(metadata.ts).

---

## Risks and watch-outs

1. **`Translator` test mocks (B3)** are the only place the migration can become awkward.
   The two existing mocks construct a callable object with no `.rich`/`.markup`/`.hasLeaf`
   methods. After the rename they need the full `SelectorTranslator` shape. If we want
   to keep the test-fixture surface light, factor a `mockSelectorTranslator()` helper
   in `lib/i18n-selector/__tests__/`.

2. **`tabbed-page-renderer.tsx` hybrid prop (B1)** is the canary that selector-only
   prop types compile cleanly across the surface. Verify it still type-checks after the
   `AsMessageKey` half is dropped — this is a low-risk sanity check.

3. **`AsNamespacedMessageKey` constraint loss in `action-button.tsx:156`**: the existing
   prop guarantees the namespace; a typed selector achieves the same constraint
   structurally. But the *callers* (~21 button definitions) currently pass keys like
   `"Commands.create-view"` which would not match a selector signature. They need to
   build selectors at the registration site or be passed a selector externally. This is
   the bucket B1 work — already audited as the largest single cluster.

4. **Deleting the `useTranslations` shim** ripples to 1,195 importers. The codemod
   handles this if it understands both the import rewrite and the call-site rewrite.
   Sanity-check the codemod handles `t.rich` → `t.rich` (selector-form, defaults still
   inject through `wrap-base-translator`).

5. **`StringLiteral` is genuinely deprecated for prophylactic reasons, not because it
   bites today.** None of the 17 sites trigger TS2590 in practice. The cleanup is
   defensible, not urgent — keeping it parked is fine.

---

## Cross-references

- Pitch: `selector-api-pitch.html` — section 03 (new API), section 06 (rollout)
- Cast inventory: `dynamic-key-audit.md` — bucket A/B1/B2/B3 references throughout
- Implementation: `components/ui/src/lib/i18n-selector/` — `useMessageT`,
  `useMessageObjectT`, `wrapBaseTranslator`
- Validation findings: `docs/brainstorms/selector-api-validation-findings.md`,
  `docs/brainstorms/selector-api-validation-perf.md` (committed)
