import { handle } from "@/server/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function route(
  request: Request,
  context: { params: Promise<{ route: string[] }> },
) {
  return handle(request, (await context.params).route);
}
export { route as GET, route as POST, route as PATCH };
