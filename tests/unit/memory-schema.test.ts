import { describe, expect, it } from "vitest";
import { MemoryCurationSchema } from "@/lib/memory/curate";

describe("manual memory proposal schema", () => {
  it("accepts evidence-backed candidates and caps the count", () => {
    const candidate = { type: "decision", title: "Use local storage", content: "SQLite is canonical.", scope: "project", confidence: 0.95, sensitivity: "normal", explicit: true, evidence: [{ kind: "message", id: "message_1" }] };
    expect(MemoryCurationSchema.parse({ threadSummary: "A summary", candidates: [candidate] }).candidates).toHaveLength(1);
    expect(() => MemoryCurationSchema.parse({ threadSummary: "A summary", candidates: Array(9).fill(candidate) })).toThrow();
    expect(() => MemoryCurationSchema.parse({ threadSummary: "A summary", candidates: [{ ...candidate, evidence: [] }] })).toThrow();
  });
});
