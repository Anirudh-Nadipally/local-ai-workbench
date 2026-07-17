import { probeAzureDeployment } from "../src/lib/azure";
import { getSafeConfig, redactSecrets } from "../src/lib/config";
import { getDeployment, updateDeploymentCapabilities } from "../src/lib/repository";

const config = getSafeConfig();
const name = process.argv[2] || config.chatDeployment;
if (!name) throw new Error("No chat deployment is configured.");
const deployment = getDeployment(name);

async function main() {
  try {
    const result = await probeAzureDeployment(name, deployment?.protocol ?? "responses");
    updateDeploymentCapabilities(name, result.capabilities, result.protocol ?? deployment?.protocol ?? "auto");
    console.log(JSON.stringify({ deployment: name, protocol: result.protocol, ok: result.ok, latencyMs: result.latencyMs, errors: result.errors }, null, 2));
  } catch (error) {
    console.error(redactSecrets(error instanceof Error ? error.message : "Connection probe failed."));
    process.exitCode = 1;
  }
}

void main();
