import { useMemo } from "react";
import { createTranslator as createBaseTranslator } from "use-intl/core";
import { useTranslations as useBaseTranslations } from "use-intl/react";
import type { BaseTranslator, SelectorTranslator } from "./types.js";
import { wrapBaseTranslator } from "./wrap-base-translator.js";

/**
 * Config accepted by {@link createTranslator}, derived from
 * `use-intl`'s underlying `createTranslator` so we stay in sync with
 * any future additions there. The `namespace` parameter is omitted —
 * selectors encode the full path.
 */
export type CreateTranslatorConfig = Omit<
  Parameters<typeof createBaseTranslator>[0],
  "namespace" | "_formatters" | "_cache"
>;

export type {
  BaseTranslator,
  MessageObjectSelector,
  MessageSelector,
  SelectorTranslator,
  TranslateArgs,
} from "./types.js";

export { pathFromSelector, selectorFromPath } from "./path-from-selector.js";

/**
 * Selector-based replacement for `next-intl`'s `useTranslations()`.
 *
 * Always returns the root translator — no namespace argument. Selectors
 * encode the full path (`t(m => m.MainNavigation.items.home)`).
 */
export function useTranslations(): SelectorTranslator {
  const baseT = useBaseTranslations() as unknown as BaseTranslator;
  return useMemo(() => wrapBaseTranslator(baseT), [baseT]);
}

/**
 * Selector-based replacement for `next-intl`'s `createTranslator()`.
 *
 * Always operates on the root messages tree — no namespace argument.
 */
export function createTranslator(
  config: CreateTranslatorConfig,
): SelectorTranslator {
  const baseT = createBaseTranslator(
    config as Parameters<typeof createBaseTranslator>[0],
  ) as unknown as BaseTranslator;
  return wrapBaseTranslator(baseT);
}
