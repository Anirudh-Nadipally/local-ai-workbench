import { describe, expect, it } from "vitest";
import { chunkSections, estimateTokens } from "@/lib/files/chunk";

describe("deterministic chunking", () => {
  it("creates bounded chunks with provenance and overlap", () => {
    const text = Array.from({ length: 1_000 }, (_, index) => `Sentence ${index} explains a useful fact.`).join(" ");
    const chunks = chunkSections([{ text, page: 7, section: "Evidence" }], 120, 15);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.page === 7 && chunk.section === "Evidence")).toBe(true);
    expect(chunks.every((chunk) => chunk.tokenEstimate <= 145)).toBe(true);
    expect(chunks[0].content.slice(-40)).not.toBe(chunks[1].content.slice(0, 40));
  });
  it("uses a stable conservative token estimate", () => { expect(estimateTokens("12345678")).toBe(2); });
});
