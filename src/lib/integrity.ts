import { getFile, getMemory, getProject, getThread } from "@/lib/repository";

export function assertProjectThread(projectId: string, threadId: string) {
  const project = getProject(projectId);
  const thread = getThread(threadId);
  if (!project || !thread || thread.deletedAt || thread.projectId !== project.id) {
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

export function assertMemoriesBelongToProjectThread(memoryIds: string[], projectId: string, threadId: string) {
  const memories = memoryIds.map(getMemory);
  if (memories.some((memory) => !memory || memory.projectId !== projectId || (memory.threadId && memory.threadId !== threadId) || memory.status !== "accepted")) {
    throw new Error("One or more selected memories are unavailable in this conversation.");
  }
  return memories;
}
