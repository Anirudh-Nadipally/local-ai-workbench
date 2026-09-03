import type { DeploymentRecord, FileRecord } from "@/lib/types";

export const ATTACHMENT_MODES = ["direct", "prepare-text", "prepare-visual"] as const;
export type AttachmentMode = (typeof ATTACHMENT_MODES)[number];

export type AttachmentSelection = {
  fileId: string;
  mode: AttachmentMode;
  preparationDeployment?: string;
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export function fileExtension(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export function isImageFile(file: Pick<FileRecord, "originalName" | "mimeType">) {
  return file.mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(fileExtension(file.originalName));
}

export function isPdfFile(file: Pick<FileRecord, "originalName" | "mimeType">) {
  return file.mimeType === "application/pdf" || fileExtension(file.originalName) === ".pdf";
}

export function isVisualAttachment(file: Pick<FileRecord, "originalName" | "mimeType">) {
  return isImageFile(file) || isPdfFile(file);
}

export function supportsNativeVisualInput(deployment: DeploymentRecord | undefined) {
  if (!deployment || !deployment.enabled || deployment.protocol === "auto") return false;
  if (deployment.capabilities.imageInput === true || deployment.capabilities.vision === true) return true;
  const identity = `${deployment.name} ${deployment.modelName ?? ""}`.toLowerCase();
  if (deployment.protocol === "anthropic" && /claude/.test(identity)) return true;
  return deployment.protocol === "responses" && /gpt[- ]?5\.6[- ]?luna/.test(identity);
}

export function findTextPreparationDeployment(deployments: DeploymentRecord[]) {
  return deployments.find((deployment) => deployment.enabled && /deepseek[- ]?v4[- ]?flash/i.test(`${deployment.name} ${deployment.modelName ?? ""}`));
}

export function findVisualPreparationDeployment(deployments: DeploymentRecord[]) {
  return deployments.find((deployment) => deployment.enabled && /gpt[- ]?5\.6[- ]?luna/i.test(`${deployment.name} ${deployment.modelName ?? ""}`));
}

export function attachmentModeLabel(mode: AttachmentMode, deployment?: string) {
  if (mode === "prepare-text") return deployment ? `Prepared · ${deployment}` : "Prepared as text";
  if (mode === "prepare-visual") return deployment ? `Prepared · ${deployment}` : "Prepared visually";
  return "Direct";
}
