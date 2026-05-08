import { getTranslations as getBaseTranslations } from "next-intl/server";
import type { BaseTranslator, SelectorTranslator } from "./types.js";
import { wrapBaseTranslator } from "./wrap-base-translator.js";

export type {
  BaseTranslator,
  MessageObjectSelector,
  MessageSelector,
  SelectorTranslator,
  TranslateArgs,
} from "./types.js";

/**
 * Selector-based replacement for `next-intl/server`'s `getTranslations()`.
 *
 * Always returns the root translator — no namespace argument. Selectors
 * encode the full path.
 */
export async function getTranslations(
  opts?: { locale: string },
): Promise<SelectorTranslator> {
  const baseT = (await (opts
    ? getBaseTranslations(opts as never)
    : getBaseTranslations())) as unknown as BaseTranslator;
  return wrapBaseTranslator(baseT);
}
