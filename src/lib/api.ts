import { assertLocalRequest } from "@/lib/endpoint";
import { redactSecrets } from "@/lib/config";

export function apiGuard(request: Request, mutation = false) {
  assertLocalRequest(request, mutation);
}

export function apiError(error: unknown, status = 400) {
  const message = redactSecrets(error instanceof Error ? error.message : "Something went wrong.");
  return Response.json({ error: message }, { status });
}
