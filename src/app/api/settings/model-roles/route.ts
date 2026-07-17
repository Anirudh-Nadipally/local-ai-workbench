import { z } from "zod";
import { apiError, apiGuard } from "@/lib/api";
import { getModelRoles, getSafeConfig, writeModelRoles } from "@/lib/config";
import { getRoleRoutingStatus, validateModelRoles } from "@/lib/model-routing";

const RoleSchema = z.object({
  chatDeployment: z.string().min(1),
  memoryDeployment: z.string().min(1),
  mapperDeployment: z.string().min(1),
  alternativeDeployment: z.string().min(1),
  adversarialDeployment: z.string().min(1),
  evidenceDeployment: z.string().min(1),
  criticDeployment: z.string().min(1),
  refinementDeployment: z.string().min(1),
  synthesisDeployment: z.string().min(1),
}).strict();

export async function GET(request: Request) {
  try {
    apiGuard(request);
    const roles = getModelRoles();
    return Response.json(getRoleRoutingStatus(roles));
  } catch (error) { return apiError(error, 500); }
}

export async function PUT(request: Request) {
  try {
    apiGuard(request, true);
    const roles = validateModelRoles(RoleSchema.parse(await request.json()));
    writeModelRoles(roles);
    return Response.json({ config: getSafeConfig(), ...getRoleRoutingStatus(roles) });
  } catch (error) { return apiError(error); }
}
