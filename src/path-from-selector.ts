import type { MessageSelector } from "./types.js";

const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const SEGMENT = `\\.\\s*(${IDENTIFIER})|\\[\\s*"([^"\\\\]*)"\\s*\\]|\\[\\s*'([^'\\\\]*)'\\s*\\]`;
const STATIC_SELECTOR = new RegExp(
  `^\\(?\\s*(${IDENTIFIER})\\s*\\)?\\s*=>\\s*\\1((?:\\s*(?:${SEGMENT}))+)\\s*$`,
);
const SEGMENTS = new RegExp(SEGMENT, "g");

// Keyed by source text, so it holds one entry per distinct selector written in the code base.
// `null` marks a source that has to be run against the recorder.
const staticPathBySource = new Map<string, string | null>();
const pathBySelector = new WeakMap<MessageSelector, string>();

let recorded = "";
const recorder: unknown = new Proxy(() => "", {
  get(_target, key) {
    if (typeof key !== "string" || key === "then") return undefined;
    recorded = recorded === "" ? key : `${recorded}.${key}`;
    return recorder;
  },
});

function parseStaticPath(source: string): string | null {
  const match = STATIC_SELECTOR.exec(source);
  if (match === null) return null;
  const segments: string[] = [];
  for (const segment of match[2]!.matchAll(SEGMENTS)) {
    const key = segment[1] ?? segment[2] ?? segment[3]!;
    // The recorder skips `then` for Promise interop; fall back so both paths agree.
    if (key === "then") return null;
    segments.push(key);
  }
  return segments.join(".");
}

function recordPath(selector: MessageSelector): string {
  const outer = recorded;
  recorded = "";
  try {
    selector(recorder as never);
  } catch {
    // Selector body may throw when interacting with the Proxy in
    // unexpected ways; the path is whatever we collected before the throw.
  }
  const path = recorded;
  recorded = outer;
  return path;
}

/**
 * Resolve a selector function to a dot-separated path string. The selector
 * walks the (typed) Messages tree property-by-property without ever
 * materializing the union of all leaf paths — this is what avoids TS2590
 * at scale.
 *
 * Results are cached per selector reference. On a miss, a selector that is a
 * plain property chain (`m => m.A.b`, `m => m.A["c-d"]`) is resolved from its
 * source text, parsed once per distinct source, so inline selectors recreated
 * on every render never run. Any other selector (computed keys, optional
 * chaining, block bodies) is run against a shared Proxy that records the
 * property accesses.
 */
export function pathFromSelector(selector: MessageSelector): string {
  const cached = pathBySelector.get(selector);
  if (cached !== undefined) return cached;
  const source = Function.prototype.toString.call(selector);
  let staticPath = staticPathBySource.get(source);
  if (staticPath === undefined) {
    staticPath = parseStaticPath(source);
    staticPathBySource.set(source, staticPath);
  }
  const path = staticPath ?? recordPath(selector);
  pathBySelector.set(selector, path);
  return path;
}

/**
 * Build a {@link MessageSelector} that resolves the given dotted path
 * at call time. Inverse of {@link pathFromSelector} — the round-trip
 * preserves the path string but produces a new selector function.
 *
 * Use this to bridge runtime string paths (e.g. from a third-party SDK
 * or config) into the selector-typed `t()` API.
 */
export function selectorFromPath(path: string): MessageSelector {
  const parts = path.length === 0 ? [] : path.split(".");
  const selector = (root: unknown): string => {
    let cursor: unknown = root;
    for (const part of parts) {
      if (
        cursor == null ||
        (typeof cursor !== "object" && typeof cursor !== "function")
      ) {
        return "";
      }
      cursor = (cursor as Record<string, unknown>)[part];
    }
    return typeof cursor === "string" ? cursor : "";
  };
  return selector as MessageSelector;
}
