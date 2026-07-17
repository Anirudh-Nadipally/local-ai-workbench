import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { getProject, updateProject } from "@/lib/repository";

const UpdateSchema = z.object({ name: z.string().min(1).max(80).optional(), description: z.string().max(500).optional(), instructions: z.string().max(10_000).optional() });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { apiGuard(request); const { id } = await context.params; const project = getProject(id); return project ? Response.json({ project }) : apiError(new Error("Project not found."), 404); }
  catch (error) { return apiError(error, 500); }
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try { apiGuard(request, true); const { id } = await context.params; return Response.json({ project: updateProject(id, UpdateSchema.parse(await request.json())) }); }
  catch (error) { return apiError(error); }
}
