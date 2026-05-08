import { pathFromSelector } from "./path-from-selector.js";
import type { BaseTranslator, SelectorTranslator } from "./types.js";

/**
 * Resolve a selector to a path and require it points at a leaf. Empty
 * paths almost always indicate a programming mistake (`m => m`), and
 * non-string `raw()` results indicate the selector landed on an object
 * subtree rather than a translatable leaf.
 */
function resolvePath(
  selector: (m: never) => unknown,
  baseT: BaseTranslator,
): string {
  const path = pathFromSelector(selector as never);
  if (path === "") {
    throw new Error(
      "next-intl-selector: selector resolved to an empty path. " +
        "Selectors must terminate at a translatable leaf, e.g. " +
        "`t(m => m.MyKey)`, not `t(m => m)`.",
    );
  }
  void baseT;
  return path;
}

function isLeaf(baseT: BaseTranslator, path: string): boolean {
  if (!baseT.has(path)) return false;
  try {
    return typeof baseT.raw(path) === "string";
  } catch {
    return false;
  }
}

/**
 * Wrap a structural `BaseTranslator` (the runtime translator returned
 * by next-intl/use-intl) into a selector-based `SelectorTranslator`.
 *
 * The returned object is callable — `Object.assign` on a function lets
 * us attach `rich`, `markup`, `raw`, `has`, and `hasRaw` while keeping
 * the call signature.
 */
export function wrapBaseTranslator(baseT: BaseTranslator): SelectorTranslator {
  const callable = ((selector, values, formats) => {
    const path = resolvePath(selector as never, baseT);
    return baseT(path, values as never, formats as never);
  }) as SelectorTranslator;

  return Object.assign(callable, {
    rich: ((selector, values, formats) => {
      const path = resolvePath(selector as never, baseT);
      return baseT.rich(path, values as never, formats as never);
    }) as SelectorTranslator["rich"],

    markup: ((selector, values, formats) => {
      const path = resolvePath(selector as never, baseT);
      return baseT.markup(path, values as never, formats as never);
    }) as SelectorTranslator["markup"],

    raw: ((selector) => {
      const path = resolvePath(selector as never, baseT);
      return baseT.raw(path);
    }) as SelectorTranslator["raw"],

    has: ((selector) => {
      const path = resolvePath(selector as never, baseT);
      return isLeaf(baseT, path);
    }) as SelectorTranslator["has"],

    hasRaw: (path: string): boolean => {
      if (path === "") return false;
      return isLeaf(baseT, path);
    },
  });
}
