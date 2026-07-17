import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { createProject, listProjects } from "@/lib/repository";

const ProjectSchema = z.object({ name: z.string().min(1).max(80), description: z.string().max(500).default("") });

export async function GET(request: Request) {
  try { apiGuard(request); return Response.json({ projects: listProjects() }); }
  catch (error) { return apiError(error, 500); }
}
export async function POST(request: Request) {
  try { apiGuard(request, true); const input = ProjectSchema.parse(await request.json()); return Response.json({ project: createProject(input.name, input.description) }); }
  catch (error) { return apiError(error); }
}
