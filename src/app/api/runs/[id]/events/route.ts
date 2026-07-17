import { apiError, apiGuard } from "@/lib/api";
import { getSynthesisRun, listRunSteps } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    apiGuard(request); const { id } = await context.params; const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (let count = 0; count < 360; count += 1) {
          const run = getSynthesisRun(id); const steps = listRunSteps(id);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ run, steps })}\n\n`));
          if (!run || ["completed", "failed", "cancelled"].includes(run.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
  } catch (error) { return apiError(error, 500); }
}
