import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createTranslator as createBaseTranslator,
  type Messages,
} from "use-intl/core";
import {
  IntlProvider,
  useTranslations as useBaseTranslations,
} from "use-intl/react";
import { createTranslator, useTranslations } from "./index.js";

const messages = {
  Plain: "Just a string",
  WithName: "Hello {name}",
  WithCount:
    "You have {count, plural, one {# item} other {# items}}",
  WithBold: "Click <bold>here</bold> please",
  Group: {
    Nested: "nested string",
  },
} as const;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={messages as unknown as Messages}>
      {children}
    </IntlProvider>
  );
}

describe("createTranslator parity with use-intl/core", () => {
  it("plain message matches", () => {
    const ours = createTranslator({ locale: "en", messages: messages as unknown as Messages });
    const theirs = createBaseTranslator({ locale: "en", messages: messages as unknown as Messages });
    expect(ours((m) => m.Plain)).toBe(theirs("Plain"));
  });

  it("ICU placeholder values match", () => {
    const ours = createTranslator({ locale: "en", messages: messages as unknown as Messages });
    const theirs = createBaseTranslator({ locale: "en", messages: messages as unknown as Messages });
    expect(ours((m) => m.WithName, { name: "Bob" })).toBe(
      theirs("WithName", { name: "Bob" }),
    );
  });

  it("plural formatting matches", () => {
    const ours = createTranslator({ locale: "en", messages: messages as unknown as Messages });
    const theirs = createBaseTranslator({ locale: "en", messages: messages as unknown as Messages });
    expect(ours((m) => m.WithCount, { count: 1 })).toBe(
      theirs("WithCount", { count: 1 }),
    );
    expect(ours((m) => m.WithCount, { count: 5 })).toBe(
      theirs("WithCount", { count: 5 }),
    );
  });

  it("nested keys match", () => {
    const ours = createTranslator({ locale: "en", messages: messages as unknown as Messages });
    const theirs = createBaseTranslator({ locale: "en", messages: messages as unknown as Messages });
    expect(ours((m) => m.Group.Nested)).toBe(theirs("Group.Nested"));
  });

  it("t.markup matches", () => {
    const ours = createTranslator({ locale: "en", messages: messages as unknown as Messages });
    const theirs = createBaseTranslator({ locale: "en", messages: messages as unknown as Messages });
    const tags = { bold: (chunks: string) => `<strong>${chunks}</strong>` };
    expect(ours.markup((m) => m.WithBold, tags)).toBe(
      theirs.markup("WithBold", tags),
    );
  });

  it("t.rich matches when rendered to static markup", () => {
    const ours = createTranslator({ locale: "en", messages: messages as unknown as Messages });
    const theirs = createBaseTranslator({ locale: "en", messages: messages as unknown as Messages });
    const tags = { bold: (chunks: ReactNode) => <strong>{chunks}</strong> };
    expect(renderToStaticMarkup(<>{ours.rich((m) => m.WithBold, tags)}</>)).toBe(
      renderToStaticMarkup(<>{theirs.rich("WithBold", tags)}</>),
    );
  });

  it("t.raw matches", () => {
    const ours = createTranslator({ locale: "en", messages: messages as unknown as Messages });
    const theirs = createBaseTranslator({ locale: "en", messages: messages as unknown as Messages });
    expect(ours.raw((m) => m.Plain)).toBe(theirs.raw("Plain"));
  });

  it("t.has is leaf-only (diverges from next-intl on object subtrees)", () => {
    const ours = createTranslator({ locale: "en", messages: messages as unknown as Messages });
    const theirs = createBaseTranslator({ locale: "en", messages: messages as unknown as Messages });

    expect(ours.has((m) => m.Plain)).toBe(true);
    expect(ours.has((m) => m.Group.Nested)).toBe(true);

    // For an object subtree we deliberately differ from next-intl: ours
    // returns false because the path does not point at a translatable
    // string leaf, even though next-intl's `has` returns true.
    expect(ours.has((m) => m.Group as unknown as string)).toBe(false);
    expect((theirs.has as (k: string) => boolean)("Group")).toBe(true);
  });

  it("t.hasRaw applies the same leaf-only check to runtime strings", () => {
    const ours = createTranslator({ locale: "en", messages: messages as unknown as Messages });
    expect(ours.hasRaw("Plain")).toBe(true);
    expect(ours.hasRaw("Group.Nested")).toBe(true);
    expect(ours.hasRaw("Group")).toBe(false);
    expect(ours.hasRaw("Missing")).toBe(false);
    expect(ours.hasRaw("")).toBe(false);
  });
});

describe("useTranslations hook", () => {
  it("returns a translator that resolves selectors", () => {
    const { result } = renderHook(() => useTranslations(), { wrapper });
    expect(result.current((m) => m.Plain)).toBe("Just a string");
    expect(result.current((m) => m.WithName, { name: "Ada" })).toBe(
      "Hello Ada",
    );
  });

  it("matches use-intl's useTranslations() on plain messages", () => {
    const { result: oursR } = renderHook(() => useTranslations(), { wrapper });
    const { result: theirsR } = renderHook(() => useBaseTranslations(), {
      wrapper,
    });
    expect(oursR.current((m) => m.Plain)).toBe(theirsR.current("Plain"));
  });

  it("returns a stable translator across re-renders when provider is stable", () => {
    const { result, rerender } = renderHook(() => useTranslations(), {
      wrapper,
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("the stable translator's methods are reference-equal across renders", () => {
    const { result, rerender } = renderHook(() => useTranslations(), {
      wrapper,
    });
    const { rich, markup, has, hasRaw, raw } = result.current;
    rerender();
    expect(result.current.rich).toBe(rich);
    expect(result.current.markup).toBe(markup);
    expect(result.current.has).toBe(has);
    expect(result.current.hasRaw).toBe(hasRaw);
    expect(result.current.raw).toBe(raw);
  });
});
