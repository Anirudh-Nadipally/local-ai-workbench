import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { readConfig } from "@/lib/config";
import { branchThread, createThread, getProject, getThread, listThreads, listTrashedThreads, setThreadsTrashed } from "@/lib/repository";

const ThreadSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().max(120).default("New conversation"),
  deploymentId: z.string().optional(),
  branchFrom: z.object({
    threadId: z.string().min(1),
    messageId: z.string().min(1),
    includeMessage: z.boolean().default(true),
  }).optional(),
});
const BulkTrashSchema = z.object({
  projectId: z.string().min(1),
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(["trash", "restore"]),
}).superRefine((value, context) => {
  if (new Set(value.ids).size !== value.ids.length) context.addIssue({ code: "custom", message: "Conversation IDs must be unique.", path: ["ids"] });
});

export async function GET(request: Request) {
  try {
    apiGuard(request);
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const trashed = url.searchParams.get("trashed") === "1";
    if (trashed && !projectId) throw new Error("projectId is required for trash.");
    return Response.json({ threads: trashed ? listTrashedThreads(projectId!) : listThreads(projectId, url.searchParams.get("q") ?? undefined) });
  }
  catch (error) { return apiError(error, 500); }
}
export async function POST(request: Request) {
  try {
    apiGuard(request, true);
    const input = ThreadSchema.parse(await request.json());
    if (!getProject(input.projectId)) throw new Error("Project not found.");
    if (input.branchFrom) {
      const source = getThread(input.branchFrom.threadId);
      if (!source || source.projectId !== input.projectId) throw new Error("Source conversation not found in this project.");
      return Response.json({ thread: branchThread({ sourceThreadId: source.id, throughMessageId: input.branchFrom.messageId, includeMessage: input.branchFrom.includeMessage }) });
    }
    return Response.json({ thread: createThread(input.projectId, input.title, input.deploymentId ?? readConfig().chatDeployment) });
  }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    apiGuard(request, true);
    const input = BulkTrashSchema.parse(await request.json());
    if (!getProject(input.projectId)) throw new Error("Project not found.");
    return Response.json({ changed: setThreadsTrashed(input.ids, input.projectId, input.action === "trash") });
  } catch (error) { return apiError(error); }
}
