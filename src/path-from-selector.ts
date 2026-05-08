/**
 * Resolve a selector function to a dot-separated path string by recording
 * property accesses on a Proxy. The selector walks the (typed) Messages
 * tree property-by-property without ever materializing the union of all
 * leaf paths — this is what avoids TS2590 at scale.
 */
export function pathFromSelector(
  selector: (m: Record<string, unknown>) => unknown,
): string {
  const segments: string[] = [];
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      segments.push(prop);
      return new Proxy({}, handler);
    },
  };
  selector(new Proxy({}, handler) as Record<string, unknown>);
  return segments.join(".");
}
