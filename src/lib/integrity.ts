import { getFile, getProject, getThread } from "@/lib/repository";

export function assertProjectThread(projectId: string, threadId: string) {
  const project = getProject(projectId);
  const thread = getThread(threadId);
  if (!project || !thread || thread.projectId !== project.id) {
    throw new Error("Conversation or project not found.");
  }
  return { project, thread };
}

export function assertFilesBelongToProject(fileIds: string[], projectId: string) {
  const files = fileIds.map(getFile);
  if (files.some((file) => !file || file.projectId !== projectId)) {
    throw new Error("One or more selected files do not belong to this project.");
  }
  return files;
}
