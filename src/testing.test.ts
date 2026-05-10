import { describe, expect, it } from "vitest";
import { mockSelectorTranslator } from "./testing.js";

describe("mockSelectorTranslator", () => {
  it("returns the dotted path by default", () => {
    const t = mockSelectorTranslator();
    expect(t((m: any) => m.Foo.Bar)).toBe("Foo.Bar");
  });

  it("delegates t.rich through the same translate callback", () => {
    const t = mockSelectorTranslator();
    expect(t.rich((m: any) => m.Intro, { bold: (c: any) => c })).toBe(
      "Intro",
    );
  });

  it("delegates t.markup through the same translate callback", () => {
    const t = mockSelectorTranslator();
    expect(t.markup((m: any) => m.Heading)).toBe("Heading");
  });

  it("returns undefined from t.raw by default", () => {
    const t = mockSelectorTranslator();
    expect(t.raw((m: any) => m.Subtree)).toBeUndefined();
  });

  it("returns true from t.has by default", () => {
    const t = mockSelectorTranslator();
    expect(t.has((m: any) => m.Exists)).toBe(true);
  });

  it("returns true from t.hasRaw by default", () => {
    const t = mockSelectorTranslator();
    expect(t.hasRaw("some.path")).toBe(true);
  });

  it("uses custom translate callback", () => {
    const t = mockSelectorTranslator({
      translate: (path, values) =>
        `[${path}] ${JSON.stringify(values ?? {})}`,
    });
    expect(t((m: any) => m.Greeting, { name: "Bob" } as any)).toBe(
      '[Greeting] {"name":"Bob"}',
    );
  });

  it("uses custom has callback for t.has", () => {
    const t = mockSelectorTranslator({
      has: (path) => path === "Real.Key",
    });
    expect(t.has((m: any) => m.Real.Key)).toBe(true);
    expect(t.has((m: any) => m.Missing)).toBe(false);
  });

  it("uses custom has callback for t.hasRaw", () => {
    const t = mockSelectorTranslator({
      has: (path) => path === "Real.Key",
    });
    expect(t.hasRaw("Real.Key")).toBe(true);
    expect(t.hasRaw("Missing")).toBe(false);
  });

  it("uses custom raw callback", () => {
    const t = mockSelectorTranslator({
      raw: (path) => (path === "Obj" ? { nested: "value" } : undefined),
    });
    expect(t.raw((m: any) => m.Obj)).toEqual({ nested: "value" });
    expect(t.raw((m: any) => m.Other)).toBeUndefined();
  });

  it("passes values to translate for t.rich and t.markup", () => {
    const calls: Array<{ path: string; values: unknown }> = [];
    const t = mockSelectorTranslator({
      translate: (path, values) => {
        calls.push({ path, values });
        return path;
      },
    });
    t.rich((m: any) => m.A, { bold: (c: any) => c } as any);
    t.markup((m: any) => m.B, { em: (c: any) => c } as any);
    expect(calls).toEqual([
      { path: "A", values: { bold: expect.any(Function) } },
      { path: "B", values: { em: expect.any(Function) } },
    ]);
  });
});
