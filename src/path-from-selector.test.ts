import { describe, expect, it } from "vitest";
import { pathFromSelector, selectorFromPath } from "./path-from-selector.js";

describe("pathFromSelector", () => {
  it("resolves a single-segment key", () => {
    expect(pathFromSelector((m: any) => m.title)).toBe("title");
  });

  it("resolves a deeply nested path", () => {
    expect(pathFromSelector((m: any) => m.a.b.c.d)).toBe("a.b.c.d");
  });

  it("resolves a realistic translation path", () => {
    expect(
      pathFromSelector((m: any) => m.MainNavigation.items.home),
    ).toBe("MainNavigation.items.home");
  });

  it("returns an empty string when the selector returns the root proxy", () => {
    expect(pathFromSelector((m: any) => m)).toBe("");
  });

  it("handles array-index access via numeric strings", () => {
    expect(pathFromSelector((m: any) => m.list[0])).toBe("list.0");
  });

  it("handles numeric-prefixed string keys", () => {
    expect(pathFromSelector((m: any) => m.variables["0"])).toBe(
      "variables.0",
    );
  });

  it("preserves keys that contain dot characters as a single segment", () => {
    expect(pathFromSelector((m: any) => m["foo.bar"])).toBe("foo.bar");
  });

  it("ignores Symbol-keyed access (e.g. Symbol.toPrimitive)", () => {
    const result = pathFromSelector((m: any) => {
      void m[Symbol.toPrimitive];
      void m[Symbol.iterator];
      return m.realKey;
    });
    expect(result).toBe("realKey");
  });

  it("ignores 'then' key probes (Promise interop)", () => {
    const result = pathFromSelector((m: any) => {
      void m.then;
      return m.actualKey;
    });
    expect(result).toBe("actualKey");
  });

  it("caches results for the same selector reference", () => {
    const selector = (m: any) => m.Cached.Path;
    const first = pathFromSelector(selector);
    const second = pathFromSelector(selector);
    expect(first).toBe("Cached.Path");
    expect(second).toBe("Cached.Path");
    expect(first).toBe(second);
  });

  it("survives a selector that throws", () => {
    const selector = (m: any) => {
      void m.before;
      throw new Error("boom");
    };
    expect(pathFromSelector(selector as any)).toBe("before");
  });

  it("works with selectors built by selectorFromPath (callable proxy target)", () => {
    const sel = selectorFromPath("Round.Trip");
    expect(pathFromSelector(sel)).toBe("Round.Trip");
  });
});

describe("selectorFromPath", () => {
  it("resolves a single-segment path against an object", () => {
    const sel = selectorFromPath("title");
    expect(sel({ title: "Hello" } as any)).toBe("Hello");
  });

  it("resolves a deeply nested path", () => {
    const sel = selectorFromPath("a.b.c");
    expect(sel({ a: { b: { c: "deep" } } } as any)).toBe("deep");
  });

  it("returns empty string for an empty path", () => {
    const sel = selectorFromPath("");
    expect(sel({ title: "Hello" } as any)).toBe("");
  });

  it("returns empty string when a segment is missing", () => {
    const sel = selectorFromPath("a.b.c");
    expect(sel({ a: { x: "wrong" } } as any)).toBe("");
  });

  it("returns empty string when traversal hits null", () => {
    const sel = selectorFromPath("a.b");
    expect(sel({ a: null } as any)).toBe("");
  });

  it("returns empty string for non-string leaf values", () => {
    const sel = selectorFromPath("count");
    expect(sel({ count: 42 } as any)).toBe("");
  });

  it("round-trips with pathFromSelector", () => {
    const original = "MainNavigation.items.home";
    const sel = selectorFromPath(original);
    expect(pathFromSelector(sel)).toBe(original);
  });
});
