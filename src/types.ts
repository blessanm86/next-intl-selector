import type { ReactNode } from "react";
import type {
  GetICUArgs,
  GetICUArgsOptions,
} from "@schummar/icu-type-parser";
import type {
  Formats,
  MarkupTagsFunction,
  Messages,
  RichTagsFunction,
  TranslationValues,
} from "use-intl/core";

/**
 * The minimal structural shape of a next-intl/use-intl translator that
 * `wrapBaseTranslator` consumes. Importing next-intl's generic
 * `Translator<Messages, Namespace>` would carry the full
 * `MessageKeys<NestedKeyOf<Messages>>` union into our type surface and
 * defeat the entire point of this package.
 */
export type BaseTranslator = {
  (key: string, values?: TranslationValues, formats?: Formats): string;
  rich(
    key: string,
    values?: Record<string, TranslationValues[string] | RichTagsFunction>,
    formats?: Formats,
  ): ReactNode;
  markup(
    key: string,
    values?: Record<
      string,
      TranslationValues[string] | MarkupTagsFunction
    >,
    formats?: Formats,
  ): string;
  has(key: string): boolean;
  raw(key: string): unknown;
};

/**
 * Non-generic selector form used in prop / parameter positions where
 * ICU values inference is not needed. Multiple `MessageSelector`s can be
 * combined in a tuple or union without re-instantiating the generic at
 * every site.
 */
export type MessageSelector = (m: Messages) => string;

/**
 * Object-subtree selector. Returns whatever the selector returns —
 * intended for callers that need the raw object (e.g. to feed into
 * `useMessages()` in next-intl).
 */
export type MessageObjectSelector<T = unknown> = (m: Messages) => T;

type ICUArgsWithTags<
  MessageString extends string,
  TagsFn extends RichTagsFunction | MarkupTagsFunction = never,
> = ICUArgs<MessageString, {
  ICUArgument: string;
  ICUNumberArgument: number | bigint;
  ICUDateArgument: Date;
}> &
  ([TagsFn] extends [never] ? {} : ICUTags<MessageString, TagsFn>);

type ICUArgs<
  Message extends string,
  Options extends GetICUArgsOptions,
> = string extends Message ? {} : GetICUArgs<Message, Options>;

type ICUTags<
  MessageString extends string,
  TagsFn,
> = MessageString extends `${infer Prefix}<${infer TagName}>${infer Content}</${string}>${infer Tail}`
  ? Record<TagName, TagsFn> & ICUTags<`${Prefix}${Content}${Tail}`, TagsFn>
  : {};

type OnlyOptional<T> = Partial<T> extends T ? true : false;

type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Argument tuple for a translator method, derived from the leaf message
 * literal `R`. When `R` is the bare `string` (i.e. messages are not
 * statically known), values are loose; when `R` is a literal, values
 * are typed by ICU placeholder parsing — and made fully optional when
 * the message has no required placeholders.
 */
export type TranslateArgs<
  R extends string,
  TagsFn extends RichTagsFunction | MarkupTagsFunction = never,
> = string extends R
  ? [
      values?: Record<string, TranslationValues[string] | TagsFn>,
      formats?: Formats,
    ]
  : (R extends unknown
        ? (key: ICUArgsWithTags<R, TagsFn>) => void
        : never) extends (key: infer Args) => void
    ? OnlyOptional<Args> extends true
      ? [values?: undefined, formats?: Formats]
      : [values: Prettify<Args>, formats?: Formats]
    : never;

/**
 * The selector-based translator returned by `useTranslations`,
 * `createTranslator`, and `getTranslations`.
 *
 * `t.has` diverges from next-intl: it returns `true` only when the
 * resolved path points at a translatable string leaf. Object subtrees,
 * numeric leaves, and any other non-string values all return `false` —
 * the contract is "can I pass this to `t()`?", not "does the path
 * resolve to anything?".
 */
export type SelectorTranslator = {
  <R extends string>(
    selector: (m: Messages) => R,
    ...args: TranslateArgs<NoInfer<R>>
  ): string;

  rich<R extends string>(
    selector: (m: Messages) => R,
    ...args: TranslateArgs<NoInfer<R>, RichTagsFunction>
  ): ReactNode;

  markup<R extends string>(
    selector: (m: Messages) => R,
    ...args: TranslateArgs<NoInfer<R>, MarkupTagsFunction>
  ): string;

  raw<R>(selector: (m: Messages) => R): unknown;

  has(selector: (m: Messages) => string): boolean;

  /**
   * Escape hatch for runtime-dynamic key existence checks. Same
   * leaf-only semantics as `t.has`.
   */
  hasRaw(path: string): boolean;
};
