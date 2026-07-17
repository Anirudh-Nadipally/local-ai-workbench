import { apiError, apiGuard } from "@/lib/api";
import { getSafeConfig, writeConfig } from "@/lib/config";
import { getRoleRoutingStatus } from "@/lib/model-routing";
import { ensureDefaultProject, listDeployments, listFiles, listProjects, listThreads } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    apiGuard(request);
    const project = ensureDefaultProject();
    const config = getSafeConfig();
    if (!config.defaultProjectId) writeConfig({ defaultProjectId: project.id });
    let modelRouting: ReturnType<typeof getRoleRoutingStatus> | { error: string };
    try { modelRouting = getRoleRoutingStatus(); }
    catch (error) { modelRouting = { error: error instanceof Error ? error.message : "Model roles need attention." }; }
    return Response.json({
      config: { ...getSafeConfig(), defaultProjectId: getSafeConfig().defaultProjectId || project.id },
      projects: listProjects(),
      threads: listThreads(project.id),
      deployments: listDeployments(true),
      files: listFiles(project.id),
      modelRouting,
    });
  } catch (error) { return apiError(error, 500); }
}
