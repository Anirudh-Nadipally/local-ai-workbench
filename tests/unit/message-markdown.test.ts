import { describe, expect, it } from "vitest";
import { normalizeMarkdownForDisplay } from "@/lib/message-markdown";

describe("assistant Markdown normalization", () => {
  it("unwraps a fenced Markdown document while preserving its nested code block", () => {
    const response = [
      "Here is the file.",
      "",
      "```markdown",
      "# General Relativity",
      "",
      "```",
      "G_μν = 8πT_μν",
      "```",
      "",
      "## Notes",
      "- Curved spacetime",
      "```",
      "",
      "You can export it.",
    ].join("\n");

    expect(normalizeMarkdownForDisplay(response)).toBe([
      "Here is the file.",
      "",
      "# General Relativity",
      "",
      "```",
      "G_μν = 8πT_μν",
      "```",
      "",
      "## Notes",
      "- Curved spacetime",
      "",
      "You can export it.",
    ].join("\n"));
  });

  it("leaves ordinary code samples unchanged", () => {
    const response = "Example:\n\n```ts\nconst answer = 42;\n```";
    expect(normalizeMarkdownForDisplay(response)).toBe(response);
  });
});
