# Migration Guide: `next-intl` → `next-intl-selector`

A guide for migrating a large codebase from `next-intl`'s string-key API to `next-intl-selector`'s selector API. Includes a bootstrap prompt for AI coding agents, a 13-pattern cookbook, and known pitfalls from a real 1,200-file migration.

## How to use this document

**If you're an AI coding agent**: read this entire document before starting. It's your briefing. Follow the workflow phases in order; consult the cookbook when you hit a specific pattern; check the pitfalls before declaring a pass complete.

**If you're a human**: skim the workflow for the big picture, then hand sections 2–5 to your preferred AI coding agent as the bootstrap prompt.

---

## 1. Workflow

The migration lands as a single branch. Each pass lowers the typecheck error count and is independently reviewable. The order is load-bearing — skipping or reordering causes cascading type errors.

### Phase 0 — Inventory

Before writing any code, measure the surface:

```bash
# Count importers of next-intl
grep -rn "from ['\"]next-intl" src/ --include="*.ts" --include="*.tsx" | wc -l

# Count string-key t() callsites (codemod-targetable)
grep -rn "t(\"" src/ --include="*.ts" --include="*.tsx" | wc -l

# Count casts to your string-key type (long-tail work)
grep -rn "as AsMessageKey\|as MessageKey\|as TranslationKey" src/ --include="*.ts" --include="*.tsx" | wc -l
```

Output: a count of importers, literal callsites, and cast sites. Use this to estimate effort and get the migration approved.

### Phase 1 — Pre-flight structural refactors

Handle cross-file prop-chain restructures that no codemod can do. These are patterns where a string-key type is threaded through component props, function params, or config objects — and the API shape needs to change, not just the call syntax.

Common examples:
- A component family that builds translation keys from template strings (`\`Commands.${namespace}.edit\``)
- A hook that iterates `Object.entries(record)` where the keys are typed as string message keys
- Config constants with `labelTranslationKey: "Foo.Bar" as MessageKey`

Fix these FIRST. If the codemod runs before structural refactors land, every restructure site ends up with cascade type errors.

### Phase 2 — Codemod sweep

Write or adapt a codemod for the mechanical transforms. The transforms are:

| ID | Transform | Scope |
|---|---|---|
| T1 | `import { useTranslations } from "next-intl"` → `from "next-intl-selector"` | All client files |
| T1 | `import { getTranslations } from "next-intl/server"` → `from "next-intl-selector/server"` | All server files |
| T2 | `t("Foo.Bar")` → `t(m => m.Foo.Bar)` | Literal string keys |
| T3 | `t("Foo.Bar", values)` → `t(m => m.Foo.Bar, values)` (and `.rich`, `.markup`, `.raw`, `.has`) | All translator methods |
| T4 | `t(\`Foo.${x}.Bar\`)` with namespace-typed `x` → `t(m => m.Foo[x].Bar)` | Template-cast keys where the variable is statically typed |
| T5 | `Translator` type import → `SelectorTranslator` | Type renames |
| T6 | `getTranslations("Namespace")` → `getTranslations()` + namespace inlined into selectors | Server files with namespace arg |

**Recommended tool: ts-morph.** The codemod needs type-checker access (`getContextualType()`, `getCallSignatures()`) to distinguish your translator's `t()` from unrelated functions. Text-based heuristics over-trigger. See "Pitfall: codemod translator detection" below.

**Driver order matters: T1 → T6 → T2/T3 → T4 → T5.** T6 must see literal namespace arguments before T2/T3 converts them, otherwise namespace prefixes don't get inlined into selectors.

After the sweep, run `prettier --write` over all touched files before staging — selector substitutions blow lines past your line-length limit, and pre-commit lint-staged can OOM on large changesets.

### Phase 3 — Typecheck punch list

```bash
pnpm run typecheck 2>&1 | head -500
```

The remaining errors ARE the long tail. They cluster predictably:

| Error | Typical cause | Recipe |
|---|---|---|
| TS2345 | String passed where `MessageSelector` expected | Cookbook #5 (bridge with wrapper) |
| TS2322 | Prop assignment mismatch after type widening | Cookbook #6 (label literals) |
| TS7006 | `m` implicitly `any` in conditional spreads | Cookbook #10 (cast to `MessageSelector`) |
| TS2538 | `string \| undefined` used as index | Cookbook #1 (non-null assert after narrowing) |
| TS2352 | Incorrect casts from legacy mocks | Cookbook #7 (use `mockSelectorTranslator`) |
| TS2339 | Closure narrowing lost inside lambda | Cookbook #8 (capture into const) |
| TS2578 | Orphaned `@ts-expect-error` | Delete the directive |

### Phase 4 — Batched fixup

Work the punch list in batches of 5–10 files. For each batch:

1. Pick files from the typecheck output.
2. Fix using cookbook patterns.
3. Run `pnpm run typecheck` — must pass (or error count must drop).
4. Commit: `migrate(N): <files or pattern>`.
5. Update a `migration-progress.md` file (committed to the branch) with remaining error count.

The progress file survives context resets and enables handoff across agent sessions.

### Phase 5 — Cleanup

Once typecheck hits zero:

- Delete deprecated wrappers, string-key types, legacy shim re-exports.
- Delete orphaned test helpers that construct legacy mock shapes.
- Run full lint + test suite.

### Phase 6 — ESLint lock-in

Prevent regression. Two approaches, from zero-effort to full plugin:

**Zero effort — `no-restricted-imports`:**

```js
// eslint.config.mjs
export default [
  {
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "next-intl", importNames: ["useTranslations", "createTranslator"], message: "Use next-intl-selector instead." },
          { name: "next-intl/server", importNames: ["getTranslations"], message: "Use next-intl-selector/server instead." },
        ],
      }],
    },
  },
];
```

**Full plugin — `eslint-plugin-next-intl-selector`:**

If you write custom rules during the migration (e.g. `no-namespace-arg`, `no-string-key-has`), extract them into a publishable plugin. Ship the rules **early, not late** — they prevent regression while later passes are still landing.

### Per-batch verification gate

After every batch or codemod run:

```bash
pnpm run typecheck        # fast, authoritative for migration correctness
pnpm run test -- --run    # targeted tests on changed areas
pnpm run lint             # full lint pass (reserve for end-of-phase)
```

Use typecheck for per-batch gates. Reserve the full lint for phase boundaries — it's slower and catches formatting, not migration correctness.

---

## 2. Invariants

These come from the package's design. Violating any of them reintroduces the `TS2590` problem the migration is solving.

1. **No namespace argument** on `useTranslations`, `createTranslator`, or `getTranslations`. Adding one forces `NamespaceKeys<NestedKeyOf<Messages>>` to evaluate.
2. **Never import `next-intl`'s `Translator<Messages, Namespace>`** into the type surface. Use `BaseTranslator` or `SelectorTranslator` from `next-intl-selector`.
3. **`NoInfer<R>` in `TranslateArgs<NoInfer<R>>` is load-bearing.** Don't remove it from the package or work around it.
4. **`t.has` is leaf-only by design.** Returns `false` on object subtrees, numbers, missing paths. Use `t.hasRaw(path)` for runtime-dynamic paths.

---

## 3. Cookbook

Each pattern has: what you're looking at, why it happens, and the fix.

### Pattern 1 — Widen prop types that carry message keys

**Symptom:** TS7006 / TS2538 — `m` implicitly `any`, or `undefined` used as index.

**Diagnosis:** A component prop is typed as your legacy string-key type. The codemod rewrote the callsite to use a selector, but the prop type still expects a string.

**Fix:** Widen the prop type to accept both forms during transition:

```diff
+import type { MessageSelector } from "next-intl-selector";

-  description: StringMessageKey;
+  description: MessageSelector | StringMessageKey;
```

**Trap:** If the prop type is part of a discriminated union AND a consumer wraps it in `Partial<...>`, TypeScript may explode (TS2590) on the now-wider union. Replace `Partial<DiscriminatedUnion>` with a hand-written non-discriminated type that exposes only the fields the consumer needs.

### Pattern 2 — Bridge a runtime-dynamic key to a selector

**Symptom:** A function returns a string path computed at runtime (e.g. from a third-party SDK, a config map, or string concatenation).

**Diagnosis:** The path is genuinely not knowable at compile time. The selector form cannot model it.

**Fix:** The function returns `string`. The consumer bridges with `selectorFromPath`:

```ts
import { selectorFromPath } from "next-intl-selector";

// Producer: returns a plain string path
function resolveMetricKey(metric: string): string {
  return `Metrics.short.${metric}`;
}

// Consumer: bridges to selector API
t(selectorFromPath(resolveMetricKey(metric)));
```

### Pattern 3 — Build a selector from a runtime path

**Symptom:** SSR `generateMetadata`, config-driven labels, or any site that concatenates a path prefix at runtime.

**Fix:** Use `selectorFromPath` from the package:

```diff
-import { createTranslator } from "next-intl";
+import { createTranslator, selectorFromPath } from "next-intl-selector";

-  title: t(pathPrefix + "title.template", values),
+  title: t(selectorFromPath(pathPrefix + "title.template"), values),
```

### Pattern 4 — `t.has(stringPath)` → `t.hasRaw(stringPath)`

**Symptom:** Runtime error or incorrect behavior — `t.has` expects a selector function, not a string.

**Diagnosis:** The codemod may cast the argument to silence TypeScript, but the new `t.has` semantics break silently at runtime. This is a **latent runtime bug** — tests may pass if mocks accept strings.

**Fix:**

```diff
-  if (!t.has(key)) {
+  if (!t.hasRaw(key)) {
     return fallback;
   }
-  return t(key, params);
+  return t(selectorFromPath(key), params);
```

**Always grep for `t.has(` after running the codemod and audit each site.** Any call where the argument is not a static `(m) => m.X.Y` literal needs to flip to `t.hasRaw`.

### Pattern 5 — Bridge a widened union at a `t()` callsite

**Symptom:** TS2345 — after prop widening (Pattern 1), every consumer passing the prop to `t()` gets a type error because the prop is `MessageSelector | LegacyStringKey` but `t()` expects `MessageSelector`.

**Fix:** Write a one-liner bridge that normalizes to selector form:

```ts
function asSelector(value: MessageSelector | string): MessageSelector {
  return typeof value === "function" ? value : selectorFromPath(value);
}

// At callsites:
t.rich(asSelector(command.description), {});
```

This can be automated via a ts-morph codemod that wraps every `t()`/`t.rich()` call whose first argument is string-typed. The filter must be **structural** — check that the callee's first call-signature parameter is a function type, not just text-match on "Translator".

### Pattern 6 — Convert label literals at typed positions

**Symptom:** TS2322 — `label: "X.Y.Z"` at a position now typed `MessageSelector`.

**Diagnosis:** After flipping the type (e.g. `TableDefinition.label: MessageSelector`), every string literal at that position needs conversion.

**Fix:** Three sub-patterns:

```diff
// Dotted message key → selector
-{ label: "Settings.columns.name" as const }
+{ label: ((m) => m.Settings.columns.name) as MessageSelector }

// Plain English (not a key) → hardcoded label wrapper
-{ label: "Service" }
+{ label: { hardCoded: "Service" } }

// Already-translated → drop the t() wrapper (position wants selector, not string)
-{ label: t((m) => m.Settings.columns.name) }
+{ label: (m) => m.Settings.columns.name }
```

This is automatable with a ts-morph codemod that uses `getContextualType()` at the property position. The walker needs to drill into `ArrayLiteralExpression` element types via `getNumberIndexType()` for conditional-spread patterns.

### Pattern 7 — Test mock for `SelectorTranslator`

**Symptom:** TS2352 — legacy `(key: string) => string` mock cast to `SelectorTranslator` no longer typechecks.

**Fix:** Use the package's mock factory:

```ts
import { mockSelectorTranslator } from "next-intl-selector/testing";

const t = mockSelectorTranslator({
  translate: (path, params) => messages[path] ?? path,
  has: (path) => path in messages,
});
```

### Pattern 8 — Capture closure-narrowed values outside the lambda

**Symptom:** TS2339 / TS2345 — property access fails inside a selector lambda because TypeScript lost the narrowing.

**Diagnosis:** TS does not preserve narrowing across closure boundaries. Inside `(m) => m.foo[spec.operator]`, `spec` is the unnarrowed union again.

**Fix:** Capture the narrowed value before the lambda:

```diff
  if ("operator" in spec && spec.operator) {
+   const operator = spec.operator;
-   return t((m) => m.operators.short[spec.operator]);
+   return t((m) => m.operators.short[operator]);
  }
```

### Pattern 9 — Use `pathFromSelector` for Record keys and React keys

**Symptom:** A selector is the natural identity for a translation, but a downstream API needs a string (Record key, React `key` prop, comparator, deduplication).

**Fix:**

```ts
import { pathFromSelector } from "next-intl-selector";

// As a Record key
const grouped: Record<string, Item[]> = {};
const key = pathFromSelector(item.categorySelector);
(grouped[key] ??= []).push(item);

// As a React key
<Tab key={pathFromSelector(tab.label)} />
```

`pathFromSelector` is WeakMap-memoized — repeated calls with the same selector reference are O(1).

### Pattern 10 — `as MessageSelector` to recover contextual typing in conditional spreads

**Symptom:** TS7006 — `m` implicitly `any` inside `...(cond ? [{ label: (m) => m.X }] : [])`.

**Diagnosis:** TypeScript doesn't propagate contextual type into array literals inside conditional spreads.

**Fix:**

```diff
+import type { MessageSelector } from "next-intl-selector";

-  label: (m) => m.Columns.userName,
+  label: ((m) => m.Columns.userName) as MessageSelector,
```

**Trap:** Without the `MessageSelector` import resolving, the cast silently degrades to `any`. Always verify the import is present after applying this pattern.

### Pattern 11 — Drop redundant `t()` wrapper at selector-typed positions

**Symptom:** After type-flipping a position to `MessageSelector`, the codemod's `t("X.Y")` → `t(m => m.X.Y)` rewrite left the `t()` call in place. But the position now wants the selector, not the translated string.

**Fix:**

```diff
-  label: t((m) => m.Settings.columns.team),
+  label: (m) => m.Settings.columns.team,
```

### Pattern 12 — Strict-replace types, don't widen permanently

**Diagnosis:** If a type still accepts both `MessageSelector` and your legacy string-key type after migration, the type system stops catching new violations.

**Fix:** End the migration with a strict flip — drop the legacy arm:

```diff
-  label: MessageSelector | LegacyStringKey | HardCodedLabel;
+  label: MessageSelector | HardCodedLabel;
```

This is the migration's correctness guarantee. Don't compromise to permanent additive widening — you'll pay the cleanup cost later.

### Pattern 13 — ESLint lock-in

Ship rules that prevent regression. At minimum:

```js
"no-restricted-imports": ["error", {
  paths: [
    { name: "next-intl", importNames: ["useTranslations", "createTranslator"], message: "Use next-intl-selector." },
    { name: "next-intl/server", importNames: ["getTranslations"], message: "Use next-intl-selector/server." },
  ],
}]
```

For custom rules: `no-namespace-arg` bans `useTranslations(arg)` / `getTranslations(arg)`. Ship early — lock-in during migration is more valuable than lock-in after.

---

## 4. Known pitfalls

Lessons learned from a real migration. Each would have changed how the work was scoped if known up front.

### `Partial<DiscriminatedUnion>` is a regression vector

Adding `MessageSelector` to a discriminated union's prop type can cause `Partial<DiscriminatedUnion>` to explode (TS2590) at consumer sites. Audit all `Partial<>` wrappers on widened types before declaring a pass complete.

### Codemod translator detection is too aggressive by default

A text-based filter (`type.getText().includes("Translator")`) matches any function whose return type mentions `Translator` — including `getTranslations`, `useTranslations`, and `createTranslator` themselves. This corrupts their call sites. Use a structural filter: check that the callee's first call-signature parameter is itself a function type `(m: Messages) => string`.

### The codemod will mis-convert legacy `next-intl` imports it should leave alone

If a file still uses `createTranslator` from `next-intl` (not `next-intl-selector`) — typical for SSR `generateMetadata` flows — the codemod may rewrite its `t("X.Y")` calls to selector form. But the legacy translator doesn't accept selector functions. Audit every remaining `next-intl` import after the sweep and either flip to `next-intl-selector` or revert the in-place conversion.

### Expect ~80–100 TS2345 errors of the same pattern after prop widening

After widening a high-fan-out prop type (like a command entry's `description`), most TS2345 errors are the same shape: the widened union passed to `t()` without bridging. A single codemod pass (Pattern 5) closes them all. Don't triage them individually.

### `t.has(stringPath)` is a latent runtime bug

The codemod may cast the argument to silence TypeScript, but `t.has` now expects a selector function. The call silently breaks at runtime. Grep for `t.has(` after every codemod run.

### `as MessageSelector` without the import silently degrades to `any`

A file that adds `((m) => m.X.Y) as MessageSelector` but is missing the type import compiles without warning — `m` becomes `any`. Always verify imports are in scope.

### TS doesn't preserve narrowing across closure boundaries

Inside `(m) => m.foo[spec.operator]`, `spec` is the unnarrowed union. Capture narrowed values into a `const` before the lambda (Pattern 8).

### Pass 6 (cleanup) is the longest by file count, not error count

The final cleanup is a long tail of one-or-two-error files. Budget 2+ hours for it; don't try to land it in one shot.

### `lint-staged` can OOM on large changesets

Run `prettier --write` over touched files BEFORE staging. Prettier wraps long selector lines; the subsequent ESLint pass finds nothing. Without this, `lint-staged` tries to lint 1,000+ files and OOMs.

---

## 5. Codemod shape

You'll likely need to write a project-specific codemod. Here's the shape that worked on a 1,200-file migration.

**Tool: ts-morph.** You need type-checker access for reliable translator detection. jscodeshift (syntactic only) over-triggers on coincidentally-named `t()` functions.

**Architecture:**

```
codemod/
├── transform.ts          # Main driver: T1 → T6 → T2/T3 → T4 → T5
├── wrap-t-string-args.ts # Post-sweep: wrap string-typed t() args in asSelector()
└── convert-labels.ts     # Post-sweep: convert label literals at MessageSelector positions
```

**Key implementation details:**

- **Driver order: T1 → T6 → T2/T3 → T4 → T5.** T6 must see namespace args before T2/T3 converts them.
- **Defensive `wasForgotten()` guards.** ts-morph's `getDescendantsOfKind` returns a snapshot. If one transform replaces a node, another transform's pre-collected list still references it. Check `node.wasForgotten()` at the top of each iterator.
- **Skip-list for declaration files.** T1 will happily rewrite your shim file, your type declarations, and your metadata helper. Maintain a list of files that need manual migration.
- **`ensureNamedImport` doubles the `type` modifier.** On `import type { ... }` lines, adding a named import with `isTypeOnly: true` produces `import type { type X }`. Check `declaration.isTypeOnly()` first.
- **Contextual-type walker for labels.** The label codemod needs to drill into `ArrayLiteralExpression` via `getNumberIndexType()` to reach conditional-spread contexts where TS doesn't propagate the destination type.

**Output:** The main sweep handles ~80% of callsites. The two post-sweep codemods handle another ~15%. The remaining ~5% is Pattern 8/10 edge cases that need manual fixes.

---

## 6. What a real migration looks like

From a 1,200-file Next.js codebase:

| Phase | Error trajectory | Files | What |
|---|---|---|---|
| Codemod sweep | (pre-work) | 1,201 | 4,562 callsite rewrites, 435 template-cast rewrites, 35 type renames |
| Pass 1 — prop widening | 248 → 172 | 9 | Widen high-fan-out command entry types |
| Pass 2 — bridge utility | 172 → 165 | 3 | Build `pathFromSelector`/`selectorFromPath` bridge, rewrite command palette |
| Pass 3 — label cascade | 165 → 159 | 56 | Strict-flip label types, codemod 400 label literals |
| Pass 3.5 — bulk bridge | 159 → 65 | 71 | Single codemod wraps 97 string-typed `t()` args |
| Pass 4 — runtime escape | 65 → 47 | 3 | 4 genuinely-runtime sites → `selectorFromPath` + `t.hasRaw` |
| Pass 5 — test mocks | 47 → 43 | 6 | `mockSelectorTranslator` factory, fix latent `t.has` bugs |
| Pass 6 — cleanup | 43 → 0 | 20 | Long-tail one-off fixes, delete deprecated symbols |
| Pass 7 — lock-in | 0 | 12 | ESLint rules, zero violations confirmed |

Total: ~2,400 insertions / ~940 deletions across ~180 files (post-codemod cleanup only; the codemod itself was ~6,700 ins / ~5,100 del).
