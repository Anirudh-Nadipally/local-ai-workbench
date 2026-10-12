import { generateText } from "ai";
import { modelFor } from "./connections";
import { put } from "./db";
import type { Model } from "@/domain/types";
export function probePdf() {
  const marker = "WORKBENCH-7319";
  const stream = `BT /F1 24 Tf 50 700 Td (${marker}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = Buffer.byteLength(text);
  text +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(text);
}
export async function probeInput(model: Model, kind: "image" | "pdf") {
  const bytes =
    kind === "pdf"
      ? probePdf()
      : Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAABC0lEQVR4nO3OMQ0AIAAEsfdvGhyw9gaSCujO9j34QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UGcH8T5QZwfxPlBnB/E+UHcBWwZ3g5gacwjAAAAAElFTkSuQmCC",
          "base64",
        );
  const result = await generateText({
    model: modelFor(model),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              kind === "pdf"
                ? "Return the exact text printed in this document."
                : "What solid color is this image? Answer one color word.",
          },
          kind === "pdf"
            ? { type: "file", data: bytes, mediaType: "application/pdf" }
            : { type: "image", image: bytes, mediaType: "image/png" },
        ],
      },
    ],
    maxOutputTokens: 1024,
    abortSignal: AbortSignal.timeout(60000),
    maxRetries: 0,
  });
  const passed =
    kind === "pdf"
      ? result.text.includes("WORKBENCH-7319")
      : /red/i.test(result.text);
  put("model", { ...model, [kind]: passed });
  if (!passed)
    throw new Error(
      `${kind} verification did not return the expected content: ${result.text.slice(0, 160)}`,
    );
  return { passed };
}
