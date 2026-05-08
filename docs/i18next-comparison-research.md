# i18next Selector API — Implementation Comparison

Research date: 2026-05-02

## How i18next's selector works

### Type signature (generic, unlike ours)

From `typescript/t.d.ts` — the selector overload:

```typescript
// Overload 2: SELECTOR API
<
  const TOpt extends TOptions = {},
  Ret extends TFunctionReturn<Ns, any, TOpt> = TFunctionReturn<Ns, any, TOpt>,
>(
  ...args: [
    key: (accessors: FlatResources<Ns, KPrefix>) => Ret,
    options?: ActualOptions,
  ]
): TFunctionReturnOptionalDetails<Ret, TOpt>;
```

Key: **generic `<Ret>`** inferred per call site. Our benchmarks confirmed this has per-callsite instantiation cost — our non-generic `=> string` is deliberately cheaper.

### FlatResources — what the selector receives

`FlatResources<Ns, KPrefix>` resolves to `Resources[namespace]` — literally the typed messages object. The selector parameter `accessors` IS the messages tree. TypeScript property access provides autocomplete as you navigate.

### Proxy / runtime resolution (two-proxy merge)

From `src/Translator.js`:

```javascript
function createAccessorProxy(handler) {
  return new Proxy(Object.create(null), {
    get(target, key) {
      if (typeof key === 'symbol') return undefined;
      return createAccessorProxy((nextKey) => handler(`${key}.${nextKey}`));
    },
  });
}

function createBackend(handler) {
  return new Proxy(Object.create(null), {
    get(target, key) {
      if (typeof key === 'symbol') return undefined;
      return handler(key);
    },
  });
}

// In translate():
if (typeof keys === 'function') {
  const backend = createBackend((key) => this.resolve(key, ...));
  const accessor = createAccessorProxy((key) => this.resolve(key, ...));
  return resolver({ ...backend, ...accessor });
}
```

Two proxies merged: `createBackend` resolves single-level keys, `createAccessorProxy` chains. Our `pathFromSelector` is simpler — records path, resolves separately.

### Type augmentation

Users declare resources in `i18next.d.ts`:

```typescript
declare module 'i18next' {
  interface CustomTypeOptions {
    resources: {
      translation: typeof import('./locales/en/translation.json');
    };
  }
}
```

Chain: `CustomTypeOptions` → `TypeOptions` → `Resources` → `FlatResources` → property types.

## Go to Definition — findings

**No special mechanism.** It's standard TypeScript behavior — Cmd+Click follows the type chain. The experience depends on how short the indirection is between the selector parameter type and the original JSON import.

### Our problem

Our chain: `MessageSelector` → `IntlMessages` (global.d.ts) → `Messages` (type alias) → `typeof messages` (JSON import). Three hops = TS shows multiple definition targets.

### Potential fix

Shorten the chain. Instead of:
```typescript
// global.d.ts
import type messages from "../../../messages/en.json";
type Messages = typeof messages;
declare global { type IntlMessages = Messages; }
```

Could we make `MessageSelector` reference the type more directly? The constraint is that `IntlMessages` is used everywhere in the codebase via next-intl's `AppConfig.Messages`.

## JSDoc Comments — findings

**Not an i18next feature.** It's standard TS behavior that only works when translations are defined in `.ts` files (not JSON). JSON doesn't support comments.

The blog post's claim is about a user-land pattern:
```typescript
const resources = {
  /** Welcome message shown on the home page */
  welcome: "Welcome!",
} as const;
```

Not portable unless we generate `.d.ts` files from JSON with JSDoc annotations per key.

## Summary

| Feature | i18next | Ours | Portable? |
|---|---|---|---|
| Selector signature | Generic `<Ret>` | Non-generic `=> string` | Ours is better (benchmarked) |
| Proxy pattern | Two-proxy merge | Single path recorder | Ours is simpler |
| Go to definition | Standard TS, depends on chain length | Broken by 3-hop alias chain | Fix: shorten chain |
| JSDoc comments | Only with .ts files, not JSON | Same limitation | Would need .d.ts generation |
| Autocomplete | Hierarchical | Hierarchical | Same |
