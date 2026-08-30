const MARKDOWN_FENCE = /(^|\n)```(?:markdown|md)[ \t]*\n/i;

/**
 * Models sometimes wrap an entire Markdown document in a Markdown fence. If the
 * document then contains its own fenced block, the outer fence is closed early
 * and the rest of the answer becomes a second giant code block. Unwrap only
 * document-like Markdown fences so normal source-code examples remain intact.
 */
export function normalizeMarkdownForDisplay(text: string) {
  const opening = MARKDOWN_FENCE.exec(text);
  if (!opening) return text;

  const openingStart = opening.index + opening[1].length;
  const contentStart = opening.index + opening[0].length;
  const closingStart = text.lastIndexOf("\n```");
  if (closingStart <= contentStart) return text;

  const document = text.slice(contentStart, closingStart).trim();
  if (!/^#{1,6}\s+\S/m.test(document)) return text;

  const before = text.slice(0, openingStart).trimEnd();
  const after = text.slice(closingStart + 4).trimStart();
  return [before, document, after].filter(Boolean).join("\n\n");
}
