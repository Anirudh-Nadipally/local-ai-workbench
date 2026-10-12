import {
  cleanupTemporaryChats,
  deleteTemporaryChat,
  keepTemporaryChat,
  requireOpenChat,
  requireSavedChat,
  temporaryExpiry,
} from "./temporary";
import { sourceSummaries } from "@/server/db";
import fs from "node:fs";
import { z } from "zod";
import { generateText } from "ai";
import {
  activeState,
  draftSummaries,
  startDraft,
  stopDraft,
  updateExport,
} from "./drafts";
import {
  effortValues,
  reasoningOptions,
  validateReasoning,
} from "@/domain/reasoning";
import JSZip from "jszip";
import { all, base, db, get, put, required, filePath, search } from "./db";
import {
  boot,
  branch,
  createThread,
  sourceForThread,
  startGeneration,
  view,
  snapshot,
} from "./workspace";
import { assertLocalRequest } from "./endpoint";
import { modelFor, probe, redact, saveConnection } from "./connections";
import { addSource } from "./sources";
import { parseConversation, filename } from "@/domain/import";
import { makeExport, exportDocument } from "./exports";
import { migrate, migrationPreview, transferConnection } from "./migration";
import { backup, restore } from "./backup";
import { probeInput } from "./probes";
import { renderExport } from "./render-export";
const id = z.string().min(1).max(160),
  text = z.string().max(2_000_000);
const selection = z.object({
  id,
  mode: z.enum(["full", "excerpts", "original"]),
});
const json = (value: unknown) =>
  Response.json(value, { headers: { "Cache-Control": "no-store" } });
async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("Expected JSON.");
  const raw = await request.text();
  if (raw.length > 5_000_000) throw new Error("Request too large.");
  return JSON.parse(raw);
}
export async function handle(request: Request, segments: string[]) {
  try {
    assertLocalRequest(request, request.method !== "GET");
    if (request.headers.get("sec-fetch-site") === "cross-site")
      throw new Error("Cross-site access is not allowed.");
    cleanupTemporaryChats();
    const [route, target, action] = segments,
      url = new URL(request.url),
      method = request.method;
    if (method === "GET") {
      if (route === "drafts")
        return json(
          draftSummaries(
            url.searchParams.get("threadId") || undefined,
            url.searchParams.get("projectId") || undefined,
          ),
        );
      if (route === "exports" && !target)
        return json(
          all("export").filter(
            (e) => e.threadId === url.searchParams.get("threadId"),
          ),
        );
      if (route === "boot") return json(boot());
      if (route === "snapshots" && target)
        return json(required("snapshot", target));
      if (route === "threads" && target) return json(view(target));
      if (route === "projects" && target) {
        const project = required("project", target);
        return json({
          project,
          brief: project.briefId ? get("brief", project.briefId) : null,
          drafts: draftSummaries(undefined, target),
          revisions: all("brief").filter((b) => b.projectId === target),
          threads: all("thread").filter(
            (t) => t.projectId === target && !t.deletedAt,
          ),
          sources: sourceSummaries()
            .filter((s) => s.projectId === target)
            .map((s) => ({ ...s, text: "", sections: [] })),
          outputs: all("output").filter((o) => o.projectId === target),
        });
      }
      if (route === "outputs" && target)
        return json(required("output", target));
      if (route === "sources" && target) {
        const s = required("source", target);
        if (action === "preview" && s.mime.startsWith("image/"))
          return new Response(fs.readFileSync(filePath(s.storedName)), {
            headers: {
              "Content-Type": s.mime,
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'",
            },
          });
        if (action === "download")
          return new Response(fs.readFileSync(filePath(s.storedName)), {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(s.name)}`,
              "X-Content-Type-Options": "nosniff",
            },
          });
        return json(s);
      }
      if (route === "search")
        return json(
          search(url.searchParams.get("q") || "")
            .filter((hit) => {
              if (hit.kind === "thread") {
                const t = get("thread", hit.id);
                return t && !t.deletedAt && !t.temporary;
              }
              if (hit.kind === "message") {
                const m = get("message", hit.id);
                const t = m ? get("thread", m.threadId) : null;
                return t && !t.deletedAt && !t.temporary;
              }
              if (hit.kind === "source" || hit.kind === "output") {
                const item = get(hit.kind, hit.id);
                if (item?.threadId && get("thread", item.threadId)?.temporary)
                  return false;
              }
              return true;
            })
            .map((hit) => {
              const item =
                hit.kind === "message"
                  ? get("message", hit.id)
                  : hit.kind === "source"
                    ? get("source", hit.id)
                    : hit.kind === "output"
                      ? get("output", hit.id)
                      : null;
              return {
                ...hit,
                threadId: item?.threadId,
                projectId:
                  hit.kind === "project"
                    ? hit.id
                    : item && "projectId" in item
                      ? item.projectId
                      : null,
              };
            }),
        );
      if (route === "trash")
        return json(all("thread").filter((t) => t.deletedAt && !t.temporary));
      if (route === "migration") return json(migrationPreview());
      if (route === "health") return json({ workerAlive: boot().workerAlive });
      if (route === "backup")
        return new Response(new Uint8Array(await backup()), {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition":
              'attachment; filename="workbench-backup.zip"',
          },
        });
      if (route === "exports" && target) {
        const packet = required("export", target);
        if (!action) return json(packet);
        if (
          all("draft").some(
            (d) => d.exportId === target && activeState(d.state),
          )
        )
          throw new Error(
            "This handoff is still being drafted. Wait for completion or stop it to review partial work.",
          );
        const content = exportDocument(packet);
        let bytes: BodyInit = content;
        let mime = "text/markdown; charset=utf-8",
          extension = "md";
        if (action === "bundle") {
          const zip = new JSZip();
          zip.file(filename(packet.title), content);
          for (const s of packet.manifest)
            zip.file(
              "sources/" + s.id + "/" + s.name,
              fs.readFileSync(filePath(s.storedName)),
            );
          bytes = new Uint8Array(
            await zip.generateAsync({ type: "nodebuffer" }),
          );
          mime = "application/zip";
          extension = "zip";
        }
        if (action === "html") {
          bytes = renderExport(packet.title, content);
          mime = "text/html; charset=utf-8";
          extension = "html";
        }
        return new Response(bytes, {
          headers: {
            "Content-Type": mime,
            "Content-Disposition": `attachment; filename="${filename(packet.title, extension)}"`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    }
    if (method === "POST" && route === "sources") {
      const form = await request.formData(),
        threadId = String(form.get("threadId") || "") || null,
        projectId = String(form.get("projectId") || "") || null;
      const files = form
        .getAll("files")
        .filter((file): file is File => file instanceof File);
      if (!files.length || files.length > 10)
        throw new Error("Select between one and ten files.");
      const result = [];
      for (const file of files) {
        if (file.size > 100 * 1024 * 1024)
          throw new Error("Files must be smaller than 100 MB.");
        result.push(
          addSource(
            file.name,
            Buffer.from(await file.arrayBuffer()),
            projectId,
            threadId,
          ),
        );
      }
      return json(result);
    }
    if (method === "POST" && route === "restore") {
      const form = await request.formData(),
        file = form.get("file");
      if (!(file instanceof File)) throw new Error("Select a backup.");
      return json(await restore(Buffer.from(await file.arrayBuffer())));
    }
    const input = await body(request);
    if (route === "projects" && method === "POST") {
      const value = z
        .object({
          name: z.string().trim().min(1).max(120),
          objective: z.string().max(5000).default(""),
        })
        .parse(input);
      return json(put("project", { ...base(), ...value, briefId: null }));
    }
    if (route === "threads" && target && method === "POST" && action === "end")
      return json(deleteTemporaryChat(target));
    if (route === "threads" && target && method === "POST" && action === "keep")
      return json(keepTemporaryChat(target));
    if (route === "threads" && method === "POST" && !target) {
      const value = z
        .object({
          projectId: id.nullable().default(null),
          title: z.string().max(200).default("Untitled conversation"),
          temporary: z.boolean().default(false),
        })
        .parse(input);
      return json(createThread(value.projectId, value.title, value.temporary));
    }
    if (route === "threads" && target && method === "PATCH") {
      const value = z
        .object({
          title: z.string().trim().min(1).max(200).optional(),
          draft: text.optional(),
          sourceIds: z.array(selection).max(10).optional(),
          includeBrief: z.boolean().optional(),
          modelId: z.string().optional(),
          effort: z.enum(effortValues).optional(),
          deletedAt: z.string().nullable().optional(),
        })
        .parse(input);
      return json(
        db().transaction(() => {
          const thread = required("thread", target);
          requireOpenChat(thread);
          if (thread.temporary && (value.includeBrief || value.deletedAt))
            throw new Error(
              "Use End & delete to remove a temporary chat. Project context stays off.",
            );
          for (const s of value.sourceIds || []) sourceForThread(thread, s.id);
          if (
            value.deletedAt &&
            [...all("generation"), ...all("draft")].some(
              (g) =>
                g.threadId === target &&
                ["queued", "running"].includes(g.state),
            )
          )
            throw new Error(
              "Stop the response before moving this conversation to trash.",
            );
          return put("thread", {
            ...thread,
            ...value,
            ...(thread.temporary ? { expiresAt: temporaryExpiry() } : {}),
          });
        })(),
      );
    }
    if (route === "branch" && method === "POST") {
      const v = z
        .object({ threadId: id, messageId: id, text: text.optional() })
        .parse(input);
      return json(branch(v.threadId, v.messageId, v.text));
    }
    if (route === "chat" && method === "POST") {
      const v = z
        .object({
          threadId: id,
          text: z.string().trim().min(1).max(300000),
          modelId: id,
          sources: z.array(selection).max(10),
          includeBrief: z.boolean(),
          effort: z.enum(effortValues).default("default"),
        })
        .parse(input);
      return json(
        startGeneration(
          v.threadId,
          v.text,
          v.modelId,
          v.sources,
          v.includeBrief,
          v.effort,
        ),
      );
    }
    if (route === "context" && method === "POST") {
      const v = z
        .object({
          threadId: id,
          text: z.string().max(300000),
          modelId: id,
          sources: z.array(selection).max(10),
          includeBrief: z.boolean(),
        })
        .parse(input);
      return json(
        snapshot(
          required("thread", v.threadId),
          v.sources,
          v.includeBrief,
          required("model", v.modelId),
          v.text,
        ),
      );
    }
    if (route === "generations" && target && action === "stop") {
      const g = required("generation", target);
      return json(put("generation", { ...g, cancelRequested: true }));
    }
    if (route === "sources" && target && action === "retry") {
      const s = required("source", target);
      put("source", { ...s, status: "queued", error: "" });
      return json(
        put("job", {
          ...base(),
          task: "extract",
          targetId: target,
          state: "queued",
          owner: "",
          leaseUntil: 0,
          error: "",
        }),
      );
    }
    if (
      (route === "imports" && action === "preview") ||
      (route === "imports" && target === "preview")
    ) {
      const v = z.object({ text: z.string().max(4000000) }).parse(input);
      return json(parseConversation(v.text));
    }
    if (route === "imports" && target === "commit") {
      const v = z
        .object({
          original: z.string().min(1).max(4000000),
          title: z.string().min(1).max(200),
          projectId: id.nullable(),
          asSource: z.boolean(),
          messages: z
            .array(
              z.object({
                role: z.enum(["user", "assistant", "system"]),
                content: text,
              }),
            )
            .max(2000),
        })
        .parse(input);
      return json(
        db().transaction(() => {
          const thread = createThread(v.projectId, v.title);
          const source = addSource(
            filename(v.title),
            Buffer.from(v.original),
            v.projectId,
            thread.id,
          );
          if (!v.asSource) {
            v.messages.forEach((m, i) =>
              put("message", {
                ...base(),
                createdAt: new Date(
                  Date.parse(thread.createdAt) + i,
                ).toISOString(),
                threadId: thread.id,
                ...m,
                status: "complete",
                sourceIds: [],
              }),
            );
          }
          return put("thread", {
            ...thread,
            sourceIds: v.asSource ? [{ id: source.id, mode: "full" }] : [],
          });
        })(),
      );
    }
    if (route === "briefs" && target && action === "dismiss") {
      const brief = required("brief", target);
      if (brief.status !== "draft")
        throw new Error("Only proposals can be dismissed.");
      return json(put("brief", { ...brief, status: "dismissed" }));
    }
    if (route === "briefs" && method === "POST") {
      const v = z
        .object({
          projectId: id,
          content: z.string().max(30000),
          previousId: id.nullable(),
          evidence: z.array(id).max(500),
          accept: z.boolean(),
          proposalId: id.nullable().optional(),
        })
        .parse(input);
      return json(
        db().transaction(() => {
          const project = required("project", v.projectId);
          if (v.accept && project.briefId !== v.previousId)
            throw new Error(
              "The brief changed. Reload before accepting this revision.",
            );
          for (const evidence of v.evidence) {
            const m = required("message", evidence);
            if (required("thread", m.threadId).projectId !== project.id)
              throw new Error("Evidence belongs to another project.");
          }
          const brief = put("brief", {
            ...base(),
            projectId: v.projectId,
            content: v.content,
            previousId: v.previousId,
            evidence: v.evidence,
            status: v.accept ? "accepted" : "draft",
          });
          if (v.accept) {
            put("project", { ...project, briefId: brief.id });
            if (v.proposalId) {
              const proposal = required("brief", v.proposalId);
              if (
                proposal.projectId !== project.id ||
                proposal.status !== "draft"
              )
                throw new Error("Invalid proposal.");
              put("brief", { ...proposal, status: "dismissed" });
            }
          }
          return brief;
        })(),
      );
    }
    if (route === "drafts" && target && action === "stop" && method === "POST")
      return json(stopDraft(target));
    if (route === "draft" && method === "POST") {
      const v = z
        .object({
          threadId: id,
          modelId: id,
          kind: z.enum(["brief", "handoff"]),
          nextTask: z.string().max(5000).default(""),
          messageIds: z.array(id).max(500),
          sourceIds: z.array(id).max(10).default([]),
          effort: z.enum(effortValues).default("default"),
        })
        .parse(input);
      return json(startDraft(v));
    }
    if (route === "exports" && target && method === "PATCH") {
      const v = z
        .object({ content: text, revision: z.number().int().min(0) })
        .parse(input);
      return json(updateExport(target, v.content, v.revision));
    }
    if (route === "briefs" && target && method === "PATCH") {
      const v = z
        .object({ content: z.string().max(30000), updatedAt: z.string() })
        .parse(input);
      return json(
        db().transaction(() => {
          const brief = required("brief", target);
          if (brief.status !== "draft" || brief.updatedAt !== v.updatedAt)
            throw new Error("This proposal changed. Reopen it before editing.");
          return put("brief", { ...brief, content: v.content });
        })(),
      );
    }
    if (route === "outputs" && method === "POST") {
      const v = z
        .object({
          threadId: id,
          title: z.string().min(1).max(200),
          content: text,
          evidence: z.array(id).max(100),
          previousId: id.nullable().default(null),
        })
        .parse(input);
      const thread = required("thread", v.threadId);
      requireSavedChat(thread);
      for (const evidence of v.evidence)
        if (required("message", evidence).threadId !== thread.id)
          throw new Error("Output evidence belongs to another conversation.");
      if (
        v.previousId &&
        required("output", v.previousId).threadId !== thread.id
      )
        throw new Error("Revision belongs to another conversation.");
      return json(
        put("output", { ...base(), ...v, projectId: thread.projectId }),
      );
    }
    if (route === "exports" && method === "POST") {
      const v = z
        .object({
          threadId: id,
          intent: z.enum(["continue", "share", "transcript"]),
          nextTask: z.string().max(5000).default(""),
          messageIds: z.array(id).max(2000),
          sourceIds: z.array(id).max(50),
          content: text.optional(),
        })
        .parse(input);
      return json(makeExport(v));
    }
    if (route === "connection") {
      if (
        [...all("generation"), ...all("draft")].some((g) =>
          activeState(g.state),
        )
      )
        throw new Error(
          "Wait for active responses before changing the connection.",
        );
      const v = z
        .object({
          endpoint: z.string().max(2000),
          key: z.string().max(1000).default(""),
        })
        .parse(input);
      saveConnection(v.endpoint, v.key);
      return json({ saved: true });
    }
    if (route === "models" && !target) {
      const v = z
        .object({
          name: z.string().trim().min(1).max(200),
          protocol: z.enum(["responses", "chat", "deepseek", "anthropic"]),
          contextTokens: z.number().min(16000).max(2000000).default(128000),
        })
        .parse(input);
      if (all("model").some((m) => m.name === v.name))
        throw new Error("This deployment is already registered.");
      return json(
        put("model", {
          ...base(),
          ...v,
          image: false,
          pdf: false,
          verifiedAt: null,
        }),
      );
    }
    if (route === "models" && target) {
      const model = required("model", target);
      if (action === "reasoning") {
        const v = z
          .object({
            config: z
              .object({
                mode: z.enum(["openai", "adaptive", "budget"]),
                efforts: z
                  .array(
                    z.enum([
                      "none",
                      "minimal",
                      "low",
                      "medium",
                      "high",
                      "xhigh",
                      "max",
                    ]),
                  )
                  .min(1)
                  .max(7),
                summary: z.boolean(),
              })
              .nullable(),
            testEffort: z.enum(effortValues).optional(),
          })
          .parse(input);
        if (v.config) validateReasoning(model, v.config);
        const candidate = { ...model, reasoning: v.config || undefined };
        if (v.testEffort && v.testEffort !== "default") {
          const result = await generateText({
            model: modelFor(candidate),
            prompt: "Reply with OK.",
            providerOptions: reasoningOptions(candidate, v.testEffort),
            maxOutputTokens: 16384,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(120000),
          });
          if (!result.text.trim())
            throw new Error(
              "The selected effort returned no answer text. Settings were not saved.",
            );
        }
        return json(put("model", candidate));
      }
      if (action === "probe") return json(await probe(model));
      if (action === "image" || action === "pdf")
        return json(await probeInput(model, action));
    }
    if (route === "migration" && target === "connection") {
      if (
        [...all("generation"), ...all("draft")].some((g) =>
          activeState(g.state),
        )
      )
        throw new Error(
          "Wait for active responses before changing the connection.",
        );
      return json(transferConnection());
    }
    if (route === "migration" && target === "commit") {
      const v = z.object({ ids: z.array(id).min(1).max(100) }).parse(input);
      return json(migrate(v.ids));
    }
    return json({ error: "Unknown operation." });
  } catch (error) {
    return Response.json({ error: redact(error) }, { status: 400 });
  }
}
