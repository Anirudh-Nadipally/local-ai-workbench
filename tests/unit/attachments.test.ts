import { describe, expect, it } from "vitest";
import { findTextPreparationDeployment, findVisualPreparationDeployment, isImageFile, isPdfFile, supportsNativeVisualInput } from "@/lib/attachments";
import { extractFile } from "@/lib/files/extract";
import { addAttachmentManifest, selectPreparationChunks } from "@/lib/files/model-input";
import type { DeploymentRecord } from "@/lib/types";

function deployment(name: string, protocol: DeploymentRecord["protocol"], modelName: string | null = null): DeploymentRecord {
  return { id: name, name, modelName, protocol, capabilities: {}, enabled: true, createdAt: "", updatedAt: "" };
}

describe("attachment routing", () => {
  it("recognizes common images and PDFs", () => {
    expect(isImageFile({ originalName: "screen.png", mimeType: "image/png" })).toBe(true);
    expect(isPdfFile({ originalName: "report.pdf", mimeType: "application/pdf" })).toBe(true);
  });

  it("allows native visual input only for configured visual deployments", () => {
    expect(supportsNativeVisualInput(deployment("claude-sonnet-5", "anthropic"))).toBe(true);
    expect(supportsNativeVisualInput(deployment("my-luna", "responses", "gpt-5.6-luna"))).toBe(true);
    expect(supportsNativeVisualInput(deployment("my-sol", "responses", "gpt-5.6-sol"))).toBe(true);
    expect(supportsNativeVisualInput(deployment("declared-vision", "responses", null))).toBe(false);
    expect(supportsNativeVisualInput(deployment("DeepSeek-V4-Flash", "deepseek"))).toBe(false);
  });

  it("finds the explicit preparation deployments by deployment or model identity", () => {
    const deployments = [
      deployment("text-prep", "deepseek", "DeepSeek-V4-Flash"),
      deployment("visual-prep-sol", "responses", "gpt-5.6-sol"),
      deployment("visual-prep", "responses", "gpt-5.6-luna"),
    ];
    expect(findTextPreparationDeployment(deployments)?.name).toBe("text-prep");
    expect(findVisualPreparationDeployment(deployments)?.name).toBe("visual-prep");
  });

  it("marks an image ready without running OCR or a local model", async () => {
    const result = await extractFile("/path/does/not/need/to/exist.png", "screen.png");
    expect(result).toMatchObject({ chunks: [], fullText: "", tokenEstimate: 0, summary: "Image ready for direct visual analysis." });
  });

  it("places an explicit attachment manifest on the latest user turn", () => {
    const messages = addAttachmentManifest([
      { role: "user", content: "Can you see the file?" },
    ], [{
      fileId: "file-json",
      originalName: "billing.json",
      mimeType: "application/json",
      sizeBytes: 1_300,
      mode: "direct",
    }]);
    const content = messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(JSON.stringify(content)).toContain("billing.json");
    expect(JSON.stringify(content)).toContain("attached to this user message");
    expect(JSON.stringify(content)).toContain("Can you see the file?");
  });

  it("prepares large sources with beginning, ending, distributed, and relevant coverage", () => {
    const chunks = Array.from({ length: 80 }, (_, index) => ({
      id: `chunk-${index}`,
      chunk_index: index,
      token_estimate: 100,
      content: `Chunk ${index}`,
    }));
    const selected = selectPreparationChunks(chunks, [chunks[47]], 2_400);
    const indices = selected.map((chunk) => Number(chunk.chunk_index));
    expect(indices).toContain(0);
    expect(indices).toContain(47);
    expect(indices).toContain(79);
    expect(indices.some((index) => index > 20 && index < 40)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(selected.reduce((sum, chunk) => sum + Number(chunk.token_estimate), 0)).toBeLessThanOrEqual(2_400);
  });
});
