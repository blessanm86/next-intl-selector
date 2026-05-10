# next-intl-selector

[![npm version](https://img.shields.io/npm/v/next-intl-selector.svg)](https://www.npmjs.com/package/next-intl-selector)
[![CI](https://github.com/blessanm86/next-intl-selector/actions/workflows/ci.yml/badge.svg)](https://github.com/blessanm86/next-intl-selector/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/next-intl-selector.svg)](./LICENSE)

A thin [`next-intl`](https://github.com/amannn/next-intl) wrapper that replaces string-key translation lookups with property selectors — eliminating TypeScript's `TS2590` ("expression produces a union type that is too complex to represent") at scale, while preserving full ICU values typing.

```ts
// next-intl
t("MainNavigation.items.home")

// next-intl-selector
t(m => m.MainNavigation.items.home)
```

## Why

`next-intl` constructs `MessageKeys<NestedKeyOf<Messages>>` — the union of every dot-path in your message tree. Past a few thousand keys this generates hundreds of thousands of type instantiations per file, causes multi-second IDE lag, and trips `TS2590`.

The selector API walks the typed `Messages` object one property at a time. TypeScript never materializes the full union, the IDE stays fast, and the leaf literal is still captured as `R` so `GetICUArgs<R>` derives typed values exactly like `next-intl` does today.

This package was suggested by `next-intl`'s maintainer as a userland alternative in [next-intl#2314](https://github.com/amannn/next-intl/issues/2314). It does not fork or replace `next-intl` — every runtime call delegates to `next-intl`'s translator.

## Install

```sh
npm install next-intl-selector
# or pnpm / yarn / bun
```

Peer dependencies: `use-intl >=4`, `react >=18`, optionally `next-intl >=4` (only required for `getTranslations`).

## Usage

`Messages` is picked up from your existing `next-intl` `AppConfig` augmentation — no extra setup.

### Client component

```tsx
import { useTranslations } from "next-intl-selector";

export function Greeting({ name }: { name: string }) {
  const t = useTranslations();
  return <p>{t(m => m.Greeting, { name })}</p>;
}
```

### Server component

```tsx
import { getTranslations } from "next-intl-selector/server";

export default async function Page() {
  const t = await getTranslations();
  return <h1>{t(m => m.HomePage.title)}</h1>;
}
```

### Standalone factory

```ts
import { createTranslator } from "next-intl-selector";

const t = createTranslator({ locale: "en", messages });
t(m => m.WelcomeBanner.title);
```

### As a prop type

Use the non-generic `MessageSelector` for prop / parameter positions:

```ts
import type { MessageSelector } from "next-intl-selector";

function Button({ label }: { label: MessageSelector }) {
  const t = useTranslations();
  return <button>{t(label)}</button>;
}

<Button label={m => m.Action.submit} />
```

## API

| Method | Signature | Notes |
|---|---|---|
| `t(selector, values?)` | `(m => leaf, values?) => string` | ICU values typed from the leaf literal |
| `t.rich(selector, values?)` | `(m => leaf, { tag: chunks => ReactNode }) => ReactNode` | Tag callbacks typed from `<tag>` markers |
| `t.markup(selector, values?)` | `(m => leaf, { tag: chunks => string }) => string` | Same, returns string |
| `t.raw(selector)` | `m => leaf => unknown` | Bypasses formatting |
| `t.has(selector)` | `m => leaf => boolean` | **Leaf-only** (see below) |
| `t.hasRaw(path)` | `(string) => boolean` | Escape hatch for runtime-dynamic paths |

### Utilities

```ts
import { pathFromSelector, selectorFromPath } from "next-intl-selector";
```

| Function | Signature | Notes |
|---|---|---|
| `pathFromSelector(selector)` | `MessageSelector => string` | Resolves a selector to its dot-path (e.g. `"Foo.Bar"`). Cached per-reference via WeakMap. |
| `selectorFromPath(path)` | `string => MessageSelector` | Inverse — builds a selector from a dot-path. Use for runtime-dynamic paths from third-party SDKs or config. |

### Testing

```ts
import { mockSelectorTranslator } from "next-intl-selector/testing";

const t = mockSelectorTranslator();
t(m => m.Foo.Bar); // returns "Foo.Bar"
```

`mockSelectorTranslator(options?)` builds a `SelectorTranslator`-shaped mock with all surface methods. By default `t()` returns the dotted path, `t.has()` returns `true`, and `t.raw()` returns `undefined`. Override with:

```ts
const t = mockSelectorTranslator({
  translate: (path, values) => `translated:${path}`,
  has: (path) => path !== "Missing.Key",
  raw: (path) => ({ nested: "value" }),
});
```

### Differences from `next-intl`

- **No `namespace` argument** on `useTranslations`, `createTranslator`, or `getTranslations`. Selectors encode the full path. Accepting a namespace would force `NamespaceKeys<NestedKeyOf<Messages>>` to evaluate, reintroducing `TS2590`.
- **`t.has` is leaf-only.** It returns `true` only when the path resolves to a translatable string. Object subtrees, numeric leaves, and `null` return `false` — the contract is "can I pass this to `t()`?", not "does this path exist?".
- **No mixed string + selector overloads.** Importing `useTranslations` from `next-intl-selector` accepts selectors only. To use string keys in some files, keep importing from `next-intl` directly. ESLint `no-restricted-imports` can enforce a per-directory policy.

Everything else (`IntlProvider`, `NextIntlClientProvider`, `useFormatter`, `useLocale`, `useMessages`, server-side `getMessages` etc.) is unchanged — keep importing those from `next-intl` / `use-intl`.

## Migration

Mechanical: change the import path and the call sites.

```diff
- import { useTranslations } from "next-intl";
+ import { useTranslations } from "next-intl-selector";

- const t = useTranslations("MainNavigation");
+ const t = useTranslations();

- t("items.home")
+ t(m => m.MainNavigation.items.home)
```

## Performance

Measured against a 7,300-leaf real `en.json` under `tsgo`:

| Variant | Per-callsite cost | Status |
|---|---|---|
| Baseline `MessageKeys<NestedKeyOf<>>` | — | hits `TS2590`, fails to compile |
| `next-intl-selector` (full ICU values typing) | ~2–4 ms | what this package ships |

In practice: project-wide `tsc` time dropped 14.8% in the original validation by porting only 8 files. Worst-case hotspots improved by 62–97%. Full perf record in [`docs/DECISION.md`](./docs/DECISION.md).

## Prior art

[i18next's TypeScript Selector API](https://www.i18next.com/overview/typescript#selector-based-type-safe-translations) (v25.4+) uses the same selector pattern.

## License

MIT
