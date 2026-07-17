import { apiError, apiGuard } from "@/lib/api";
import { getProject, getThread, listMessages, listThreads } from "@/lib/repository";

export async function GET(request: Request) {
  try {
    apiGuard(request); const url = new URL(request.url); const threadId = url.searchParams.get("threadId"); const projectId = url.searchParams.get("projectId");
    let markdown = ""; let title = "workbench-export";
    if (threadId) {
      const thread = getThread(threadId); if (!thread) throw new Error("Conversation not found.");
      title = slug(thread.title); markdown = renderThread(thread.title, thread.summary, listMessages(thread.id));
    } else if (projectId) {
      const project = getProject(projectId); if (!project) throw new Error("Project not found.");
      title = slug(project.name); markdown = `# ${project.name}\n\n${project.description}\n\n` + listThreads(projectId).map((thread) => renderThread(thread.title, thread.summary, listMessages(thread.id))).join("\n\n---\n\n");
    } else throw new Error("threadId or projectId is required.");
    return new Response(markdown, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${title}.md"` } });
  } catch (error) { return apiError(error); }
}

function renderThread(title: string, summary: string, messages: ReturnType<typeof listMessages>) {
  return `# ${title}\n\n${summary ? `> ${summary.replace(/\n/g, "\n> ")}\n\n` : ""}${messages.map((message) => `## ${message.role === "assistant" ? "Assistant" : "You"}\n\n${message.content}`).join("\n\n")}`;
}
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "export"; }
