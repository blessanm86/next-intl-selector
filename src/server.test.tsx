import { describe, expect, it, vi } from "vitest";
import { createTranslator as createBaseTranslator } from "use-intl/core";
import type { Messages } from "use-intl/core";

const messages = {
  Plain: "Just a string",
  WithName: "Hello {name}",
  Group: { Nested: "nested string" },
} as const;

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () =>
    createBaseTranslator({
      locale: "en",
      messages: messages as unknown as Messages,
    }),
  ),
}));

describe("getTranslations (server entry)", () => {
  it("returns a translator that resolves selectors", async () => {
    const { getTranslations } = await import("./server.js");
    const t = await getTranslations();
    expect(t((m) => m.Plain)).toBe("Just a string");
    expect(t((m) => m.WithName, { name: "Ada" })).toBe("Hello Ada");
  });

  it("matches the underlying use-intl translator", async () => {
    const { getTranslations } = await import("./server.js");
    const ours = await getTranslations();
    const theirs = createBaseTranslator({
      locale: "en",
      messages: messages as unknown as Messages,
    });
    expect(ours((m) => m.Group.Nested)).toBe(theirs("Group.Nested"));
  });

  it("forwards the optional locale opts to the underlying getTranslations", async () => {
    const { getTranslations: getBase } = await import("next-intl/server");
    const { getTranslations } = await import("./server.js");
    await getTranslations({ locale: "de" });
    expect(getBase).toHaveBeenCalledWith({ locale: "de" });
  });
});
