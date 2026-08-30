import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { parse } from "csv-parse/sync";
import mammoth from "mammoth";
import { chunkSections, estimateTokens, type ExtractedSection } from "@/lib/files/chunk";

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
export const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".markdown", ".html", ".htm", ".csv", ".json", ".jsonl", ...IMAGE_EXTENSIONS]);
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_BATCH_FILES = 10;

export function assertSupportedFile(name: string, size: number) {
  const extension = path.extname(name).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Unsupported file type: ${extension || "unknown"}.`);
  if (size <= 0) throw new Error("The file is empty.");
  if (size > MAX_FILE_BYTES) throw new Error("Files may not exceed 100 MB.");
}

export function safeOriginalName(name: string) {
  const base = path.basename(name);
  if (!base || base !== name || base.includes("..") || /[\0/\\]/.test(name)) throw new Error("Unsafe file name.");
  return base;
}

export async function extractFile(filePath: string, originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return {
      sections: [] as ExtractedSection[],
      chunks: [],
      fullText: "",
      tokenEstimate: 0,
      summary: "Image ready for direct visual analysis.",
    };
  }
  const buffer = await fs.readFile(filePath);
  let sections: ExtractedSection[];

  switch (extension) {
    case ".pdf": sections = await extractPdf(buffer); break;
    case ".docx": {
      const result = await mammoth.extractRawText({ buffer });
      sections = [{ text: result.value, section: "Document" }];
      break;
    }
    case ".html":
    case ".htm": sections = extractHtml(buffer.toString("utf8")); break;
    case ".csv": sections = extractCsv(buffer.toString("utf8")); break;
    case ".json": sections = extractJson(buffer.toString("utf8")); break;
    case ".jsonl": sections = extractJsonLines(buffer.toString("utf8")); break;
    default: sections = extractPlainText(buffer.toString("utf8"));
  }

  const chunks = chunkSections(sections);
  const fullText = sections.map((section) => section.text).join("\n\n").trim();
  return {
    sections,
    chunks,
    fullText,
    tokenEstimate: estimateTokens(fullText),
    summary: buildDeterministicSummary(fullText, sections),
  };
}

function extractPlainText(text: string): ExtractedSection[] {
  const headings = /^(#{1,6}\s+.+|[^\n]{1,100}\n[-=]{3,})$/gm;
  const matches = [...text.matchAll(headings)];
  if (!matches.length) return [{ text, section: "Document" }];
  const sections: ExtractedSection[] = [];
  let cursor = 0;
  let label = "Introduction";
  for (const match of matches) {
    if ((match.index ?? 0) > cursor) sections.push({ text: text.slice(cursor, match.index), section: label });
    label = match[0].replace(/^#+\s*/, "").replace(/\n[-=]+$/, "").trim();
    cursor = (match.index ?? 0) + match[0].length;
  }
  sections.push({ text: text.slice(cursor), section: label });
  return sections;
}

function extractHtml(html: string): ExtractedSection[] {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,nav").remove();
  const title = $("title").first().text().trim() || $("h1").first().text().trim() || "HTML document";
  $("br").replaceWith("\n");
  $("p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,tr").each((_, element) => {
    $(element).append("\n");
  });
  return [{ text: $("body").text().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n"), section: title }];
}

function extractCsv(text: string): ExtractedSection[] {
  const records = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Array<Record<string, unknown>>;
  if (!records.length) return [{ text, section: "CSV" }];
  const headers = Object.keys(records[0]);
  const lines = records.map((row, index) => `Row ${index + 1}: ${headers.map((header) => `${header}: ${String(row[header] ?? "")}`).join(" | ")}`);
  return [{ text: `${headers.join(" | ")}\n${lines.join("\n")}`, section: "CSV rows" }];
}

function extractJson(text: string): ExtractedSection[] {
  const parsed = JSON.parse(text) as unknown;
  return [{ text: JSON.stringify(parsed, null, 2), section: "JSON" }];
}

function extractJsonLines(text: string): ExtractedSection[] {
  const lines = text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return `Record ${index + 1}: ${JSON.stringify(JSON.parse(line))}`; }
    catch { throw new Error(`Malformed JSONL record on line ${index + 1}.`); }
  });
  return [{ text: lines.join("\n"), section: "JSONL records" }];
}

async function extractPdf(buffer: Buffer): Promise<ExtractedSection[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages: ExtractedSection[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ");
    pages.push({ text, page: pageNumber, section: `Page ${pageNumber}` });
  }
  return pages;
}

function buildDeterministicSummary(text: string, sections: ExtractedSection[]) {
  const compact = text.replace(/\s+/g, " ").trim();
  const pages = sections.filter((section) => section.page).length;
  const prefix = pages ? `${pages} page${pages === 1 ? "" : "s"}. ` : "";
  return `${prefix}${compact.slice(0, 700)}${compact.length > 700 ? "…" : ""}`;
}
