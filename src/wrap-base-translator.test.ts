import { describe, expect, it, vi } from "vitest";
import type { BaseTranslator } from "./types.js";
import { wrapBaseTranslator } from "./wrap-base-translator.js";

function makeBase(overrides: Partial<BaseTranslator> = {}): BaseTranslator {
  const fn = vi.fn((_key: string, _values?: unknown, _formats?: unknown) => "translated") as unknown as BaseTranslator;
  Object.assign(fn, {
    rich: vi.fn((_key: string) => "<rich>"),
    markup: vi.fn((_key: string) => "<markup>"),
    has: vi.fn((_key: string) => true),
    raw: vi.fn((_key: string) => "raw-string"),
    ...overrides,
  });
  return fn;
}

describe("wrapBaseTranslator", () => {
  it("delegates t(selector, values) to baseT(path, values)", () => {
    const base = makeBase();
    const t = wrapBaseTranslator(base);
    const result = t((m: any) => m.A.B, { name: "x" } as never);
    expect(result).toBe("translated");
    expect(base).toHaveBeenCalledWith("A.B", { name: "x" }, undefined);
  });

  it("forwards formats argument", () => {
    const base = makeBase();
    const t = wrapBaseTranslator(base);
    const formats = { number: { precise: { maximumFractionDigits: 5 } } };
    t((m: any) => m.X, undefined, formats as never);
    expect(base).toHaveBeenCalledWith("X", undefined, formats);
  });

  it("delegates t.rich to baseT.rich", () => {
    const base = makeBase();
    const t = wrapBaseTranslator(base);
    t.rich((m: any) => m.Rich, { bold: (c: unknown) => c } as never);
    expect(base.rich).toHaveBeenCalledWith(
      "Rich",
      { bold: expect.any(Function) },
      undefined,
    );
  });

  it("delegates t.markup to baseT.markup", () => {
    const base = makeBase();
    const t = wrapBaseTranslator(base);
    t.markup((m: any) => m.Markup, { em: (c: string) => `_${c}_` } as never);
    expect(base.markup).toHaveBeenCalledWith(
      "Markup",
      { em: expect.any(Function) },
      undefined,
    );
  });

  it("delegates t.raw to baseT.raw", () => {
    const base = makeBase();
    const t = wrapBaseTranslator(base);
    expect(t.raw((m: any) => m.Anything)).toBe("raw-string");
    expect(base.raw).toHaveBeenCalledWith("Anything");
  });

  describe("t.has — leaf-only semantics", () => {
    it("returns true when has=true and raw is a string leaf", () => {
      const base = makeBase({
        has: vi.fn(() => true),
        raw: vi.fn(() => "leaf"),
      });
      const t = wrapBaseTranslator(base);
      expect(t.has((m: any) => m.Leaf)).toBe(true);
    });

    it("returns false when path resolves to an object subtree", () => {
      const base = makeBase({
        has: vi.fn(() => true),
        raw: vi.fn(() => ({ child: "x" })),
      });
      const t = wrapBaseTranslator(base);
      expect(t.has((m: any) => m.Subtree)).toBe(false);
    });

    it("returns false when raw resolves to a non-string leaf (e.g. number)", () => {
      // next-intl JSON allows non-string leaves. We deliberately
      // diverge here: the contract is "can I pass this to t()?",
      // and t() needs a string.
      const base = makeBase({
        has: vi.fn(() => true),
        raw: vi.fn(() => 42),
      });
      const t = wrapBaseTranslator(base);
      expect(t.has((m: any) => m.NumberLeaf)).toBe(false);
    });

    it("returns false when path does not exist", () => {
      const base = makeBase({
        has: vi.fn(() => false),
      });
      const t = wrapBaseTranslator(base);
      expect(t.has((m: any) => m.Missing)).toBe(false);
    });

    it("returns false when raw() throws", () => {
      const base = makeBase({
        has: vi.fn(() => true),
        raw: vi.fn(() => {
          throw new Error("boom");
        }),
      });
      const t = wrapBaseTranslator(base);
      expect(t.has((m: any) => m.Broken)).toBe(false);
    });
  });

  describe("t.hasRaw", () => {
    it("returns true for a string leaf path", () => {
      const base = makeBase({
        has: vi.fn(() => true),
        raw: vi.fn(() => "leaf"),
      });
      const t = wrapBaseTranslator(base);
      expect(t.hasRaw("Some.Path")).toBe(true);
    });

    it("returns false for an empty path", () => {
      const base = makeBase();
      const t = wrapBaseTranslator(base);
      expect(t.hasRaw("")).toBe(false);
    });
  });

  it("throws when a selector resolves to an empty path", () => {
    const base = makeBase();
    const t = wrapBaseTranslator(base);
    expect(() => t((m: any) => m)).toThrow(/empty path/);
  });
});
