import type { MessageSelector } from "./types.js";

const pathCache = new WeakMap<MessageSelector, string>();

/**
 * Resolve a selector function to a dot-separated path string by recording
 * property accesses on a Proxy. The selector walks the (typed) Messages
 * tree property-by-property without ever materializing the union of all
 * leaf paths — this is what avoids TS2590 at scale.
 *
 * Results are cached per-selector via a WeakMap, so repeated calls with
 * the same function reference (e.g. a selector stored in a variable or
 * passed as a prop) skip the Proxy walk.
 */
export function pathFromSelector(selector: MessageSelector): string {
  const cached = pathCache.get(selector);
  if (cached !== undefined) return cached;

  const segments: string[] = [];
  const recorder: unknown = new Proxy(
    Object.assign(() => "", {}),
    {
      get(_target, key) {
        if (typeof key !== "string" || key === "then") return undefined;
        segments.push(key);
        return recorder;
      },
    },
  );

  try {
    selector(recorder as never);
  } catch {
    // Selector body may throw when interacting with the Proxy in
    // unexpected ways; the path is whatever we collected before the throw.
  }

  const path = segments.join(".");
  pathCache.set(selector, path);
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
