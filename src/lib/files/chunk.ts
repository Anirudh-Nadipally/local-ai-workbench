export type ExtractedSection = {
  text: string;
  page?: number | null;
  section?: string | null;
};
export type TextChunk = {
  content: string;
  page?: number | null;
  section?: string | null;
  tokenEstimate: number;
};

export const estimateTokens = (text: string) =>
  Math.max(1, Math.ceil(text.length / 4));

export function chunkSections(
  sections: ExtractedSection[],
  targetTokens = 1_200,
  overlapTokens = 150,
): TextChunk[] {
  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;
  const chunks: TextChunk[] = [];

  for (const source of sections) {
    const text = source.text
      .replace(/\r\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
    if (!text) continue;
    let cursor = 0;
    while (cursor < text.length) {
      let end = Math.min(text.length, cursor + targetChars);
      if (end < text.length) {
        const boundary = Math.max(
          text.lastIndexOf("\n", end),
          text.lastIndexOf(". ", end),
        );
        if (boundary > cursor + targetChars * 0.65) end = boundary + 1;
      }
      const content = text.slice(cursor, end).trim();
      if (content)
        chunks.push({
          content,
          page: source.page,
          section: source.section,
          tokenEstimate: estimateTokens(content),
        });
      if (end >= text.length) break;
      cursor = Math.max(cursor + 1, end - overlapChars);
    }
  }
  return chunks;
}
