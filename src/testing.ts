import type { MessageSelector, SelectorTranslator } from "./types.js";
import { pathFromSelector } from "./path-from-selector.js";

export type MockSelectorTranslatorOptions = {
  /**
   * Looks up the translated leaf for a given dotted path. The default
   * returns the path verbatim — handy for tests that only assert on the
   * lookup key.
   */
  translate?: (path: string, values?: Record<string, unknown>) => string;
  /**
   * Backs `t.has` and `t.hasRaw`. Defaults to `() => true`.
   */
  has?: (path: string) => boolean;
  /**
   * Backs `t.raw`. Defaults to `() => undefined`.
   */
  raw?: (path: string) => unknown;
};

/**
 * Build a {@link SelectorTranslator}-shaped mock for unit tests. All
 * surface methods (`t`, `t.rich`, `t.markup`, `t.raw`, `t.has`,
 * `t.hasRaw`) accept selectors and route them through
 * {@link pathFromSelector} so call sites can assert on the resolved
 * dotted path.
 */
export function mockSelectorTranslator(
  options: MockSelectorTranslatorOptions = {},
): SelectorTranslator {
  const translate = options.translate ?? ((path) => path);
  const has = options.has ?? (() => true);
  const raw = options.raw ?? (() => undefined);

  const fn = ((
    selector: MessageSelector,
    values?: Record<string, unknown>,
  ) => translate(pathFromSelector(selector), values)) as SelectorTranslator;

  fn.rich = ((
    selector: MessageSelector,
    values?: Record<string, unknown>,
  ) =>
    translate(
      pathFromSelector(selector),
      values,
    )) as SelectorTranslator["rich"];

  fn.markup = ((
    selector: MessageSelector,
    values?: Record<string, unknown>,
  ) =>
    translate(
      pathFromSelector(selector),
      values,
    )) as SelectorTranslator["markup"];

  fn.raw = ((selector: MessageSelector) =>
    raw(pathFromSelector(selector))) as SelectorTranslator["raw"];

  fn.has = ((selector: MessageSelector) =>
    has(pathFromSelector(selector))) as SelectorTranslator["has"];

  fn.hasRaw = ((path: string) => has(path)) as SelectorTranslator["hasRaw"];

  return fn;
}
