import { describe, expect, it } from "vitest";
import { pathFromSelector } from "./path-from-selector.js";

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
    // Note: the resulting dot-path is ambiguous if a downstream resolver
    // splits on '.', but that ambiguity is next-intl's, not ours. We
    // record exactly what the selector accessed.
    expect(pathFromSelector((m: any) => m["foo.bar"])).toBe("foo.bar");
  });

  it("ignores Symbol-keyed access (e.g. Symbol.toPrimitive)", () => {
    const result = pathFromSelector((m: any) => {
      // Engines and runtimes probe symbols on returned values; verify we
      // do not record those probes as path segments.
      void m[Symbol.toPrimitive];
      void m[Symbol.iterator];
      return m.realKey;
    });
    expect(result).toBe("realKey");
  });
});
