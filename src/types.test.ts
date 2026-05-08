import { describe, expect, it } from "vitest";
import type {
  BaseTranslator,
  MessageObjectSelector,
  MessageSelector,
  SelectorTranslator,
} from "./types.js";

declare module "use-intl/core" {
  interface AppConfig {
    Locale: "en";
    Messages: {
      Plain: "Just a string";
      WithName: "Hello {name}";
      WithCount: "You have {count, plural, one {# item} other {# items}}";
      WithBold: "Click <bold>here</bold>";
      Group: {
        Nested: "nested string";
      };
    };
  }
}

// All assertions in this file are compile-time. The function bodies are
// never executed (the runtime check below would fail) — TypeScript still
// type-checks them.
function expectTypes(_fn: () => void) {}

describe("type-level: SelectorTranslator", () => {
  it("compiles all selector / values combinations", () => {
    expectTypes(() => {
      const t = null as unknown as SelectorTranslator;

      // Plain message — values arg optional
      t((m) => m.Plain);
      t((m) => m.Plain, undefined);

      // ICU placeholder — values typed correctly
      t((m) => m.WithName, { name: "Bob" });
      t((m) => m.WithCount, { count: 3 });

      // Rich + markup tag callbacks
      t.rich((m) => m.WithBold, { bold: (chunks) => chunks });
      t.markup((m) => m.WithBold, { bold: (chunks) => `<b>${chunks}</b>` });

      // has / hasRaw
      const ok: boolean = t.has((m) => m.Plain);
      const ok2: boolean = t.hasRaw("Group.Nested");
      void ok;
      void ok2;

      // Nested leaf selectors
      t((m) => m.Group.Nested);
    });
    expect(true).toBe(true);
  });

  it("rejects invalid selectors and values", () => {
    expectTypes(() => {
      const t = null as unknown as SelectorTranslator;

      // @ts-expect-error — Typo is not a key on Messages
      t((m) => m.Typo);

      // @ts-expect-error — Group resolves to an object, not a string
      t((m) => m.Group);

      // @ts-expect-error — `wrong` is not an ICU placeholder of WithName
      t((m) => m.WithName, { wrong: 1 });

      // @ts-expect-error — `name` is required by the message
      t((m) => m.WithName);
    });
    expect(true).toBe(true);
  });
});

describe("type-level: MessageSelector / MessageObjectSelector", () => {
  it("composes in prop / tuple positions", () => {
    expectTypes(() => {
      const props: { label: MessageSelector } = {
        label: (m) => m.Plain,
      };
      const tuple: [MessageSelector, MessageSelector] = [
        (m) => m.Plain,
        (m) => m.WithName,
      ];
      const sel: MessageObjectSelector<{ Nested: string }> = (m) => m.Group;
      void props;
      void tuple;
      void sel;
    });
    expect(true).toBe(true);
  });
});

describe("type-level: BaseTranslator structural type", () => {
  it("a plain object matching the shape satisfies BaseTranslator", () => {
    const fake: BaseTranslator = Object.assign((_key: string) => "ok", {
      rich: (_key: string) => null,
      markup: (_key: string) => "ok",
      has: (_key: string) => true,
      raw: (_key: string) => undefined as unknown,
    });
    expect(fake("anything")).toBe("ok");
  });
});
