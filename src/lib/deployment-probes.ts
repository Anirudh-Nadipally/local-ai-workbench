import { probeAzureDeployment } from "@/lib/azure";
import { getDeployment, updateDeploymentCapabilities } from "@/lib/repository";

export async function probeRegisteredDeployment(identifier: string) {
  const deployment = getDeployment(identifier);
  if (!deployment) throw new Error("Deployment not found.");
  const probe = await probeAzureDeployment(deployment.name, deployment.protocol, deployment.modelName);
  const updated = updateDeploymentCapabilities(
    deployment.name,
    probe.capabilities,
    probe.protocol ?? deployment.protocol,
  );
  if (!updated) throw new Error("Deployment disappeared while it was being probed.");
  return { deployment: updated, probe };
}
