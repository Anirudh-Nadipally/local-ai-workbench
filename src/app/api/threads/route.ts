import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { readConfig } from "@/lib/config";
import { createThread, getProject, listThreads } from "@/lib/repository";

const ThreadSchema = z.object({ projectId: z.string().min(1), title: z.string().max(120).default("New conversation"), deploymentId: z.string().optional() });

export async function GET(request: Request) {
  try { apiGuard(request); const url = new URL(request.url); return Response.json({ threads: listThreads(url.searchParams.get("projectId") ?? undefined, url.searchParams.get("q") ?? undefined) }); }
  catch (error) { return apiError(error, 500); }
}
export async function POST(request: Request) {
  try {
    apiGuard(request, true);
    const input = ThreadSchema.parse(await request.json());
    if (!getProject(input.projectId)) throw new Error("Project not found.");
    return Response.json({ thread: createThread(input.projectId, input.title, input.deploymentId ?? readConfig().chatDeployment) });
  }
  catch (error) { return apiError(error); }
}
