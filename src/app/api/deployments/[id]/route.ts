import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { updateDeployment } from "@/lib/repository";

export const runtime = "nodejs";

const Schema = z.object({
  modelName: z.string().trim().nullable().optional(),
  protocol: z.enum(["auto", "responses", "chat", "deepseek", "anthropic"]).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one deployment change.");

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    apiGuard(request, true);
    const { id } = await context.params;
    const deployment = updateDeployment(id, Schema.parse(await request.json()));
    if (!deployment) return apiError(new Error("Deployment not found."), 404);
    return Response.json({ deployment });
  } catch (error) { return apiError(error); }
}
