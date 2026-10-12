import fs from "node:fs";
import { streamText, type ModelMessage } from "ai";
import { all, db, filePath, get, put, required } from "./db";
import { modelFor, redact } from "./connections";
import { extractFile } from "@/lib/files/extract";
import { reasoningOptions } from "@/domain/reasoning";
import { finishDraft } from "./drafts";
import type { Job, RunActivity } from "@/domain/types";
export async function processJob(
  job: Job,
  stopping: () => boolean = () => false,
) {
  if (job.task === "extract") {
    const source = get("source", job.targetId);
    if (!source) return;
    const canWrite = () =>
      !!get("source", source.id) &&
      (job.state !== "running" ||
        (get("job", job.id)?.owner === job.owner &&
          get("job", job.id)?.state === "running"));
    db().transaction(() => {
      if (canWrite())
        put("source", { ...source, status: "processing", error: "" });
    })();
    try {
      const result = await extractFile(
        filePath(source.storedName),
        source.name,
      );
      db().transaction(() => {
        if (!canWrite()) return;
        put("source", {
          ...source,
          status: "ready",
          text: result.fullText,
          sections: result.sections,
          error:
            !result.fullText && !source.mime.startsWith("image/")
              ? "No text extracted. For a scanned PDF, use Original with a PDF-capable model."
              : "",
        });
      })();
    } catch (error) {
      if (!canWrite()) return;
      db().transaction(() => {
        if (canWrite())
          put("source", { ...source, status: "failed", error: redact(error) });
      })();
      throw error;
    }
    return;
  }
  const kind = job.task === "draft" ? "draft" : "generation";
  const run = get(kind, job.targetId);
  if (!run) return;
  if (!["queued", "running"].includes(run.state)) return;
  const generation =
    kind === "generation" ? required("generation", run.id) : null;
  const message = generation ? required("message", generation.messageId) : null;
  const snapshot = generation
    ? required("snapshot", generation.snapshotId)
    : null;
  const draft = kind === "draft" ? required("draft", run.id) : null;
  const ownsLease = () =>
    !!get(kind, run.id) &&
    !!get("thread", run.threadId) &&
    (job.state !== "running" ||
      (get("job", job.id)?.owner === job.owner &&
        get("job", job.id)?.state === "running" &&
        (get("job", job.id)?.leaseUntil || 0) > Date.now()));

  let text = "",
    reasoning = "",
    lastSave = 0;
  let phase: RunActivity["phase"] = "waiting";
  const startedAt = new Date().toISOString();
  const save = (
    state: typeof run.state,
    error = "",
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
    },
  ) => {
    if (!ownsLease()) return;
    const activity = {
      state,
      error,
      reasoning,
      phase,
      startedAt,
      ...(!["running", "queued"].includes(state)
        ? { finishedAt: new Date().toISOString() }
        : {}),
      ...usage,
    };
    db().transaction(() => {
      if (!ownsLease()) return;
      if (draft)
        put("draft", {
          ...required("draft", run.id),
          ...activity,
          content: text,
        });
      else if (generation && message) {
        put("generation", { ...required("generation", run.id), ...activity });
        put("message", {
          ...message,
          content: text,
          status: state === "running" ? "streaming" : state,
        });
      }
    })();
  };
  if (!ownsLease()) return;
  if (run.cancelRequested) {
    save("cancelled");
    return;
  }
  save("running");
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error(
          "The model did not finish within ten minutes. Partial work is saved.",
        ),
      ),
    600000,
  );
  const cancel = setInterval(() => {
    if (stopping() || !ownsLease() || get(kind, run.id)?.cancelRequested)
      controller.abort();
  }, 150);
  try {
    let messages: ModelMessage[];
    if (draft) messages = [{ role: "user", content: draft.prompt }];
    else {
      // New snapshots freeze the submitted message. Legacy queued jobs retain their old fallback.
      const userText =
        snapshot!.userText ??
        all("message")
          .filter(
            (m) => m.threadId === generation!.threadId && m.role === "user",
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.content;
      if (!userText) throw new Error("The submitted message is missing.");
      const parts: Extract<ModelMessage, { role: "user" }>["content"] = [
        { type: "text", text: userText },
      ];
      for (const s of snapshot!.sources.filter((s) => s.mode === "original")) {
        const data = new Uint8Array(fs.readFileSync(filePath(s.storedName)));
        if (s.mime.startsWith("image/"))
          parts.push({ type: "image", image: data, mediaType: s.mime });
        else
          parts.push({
            type: "file",
            data,
            mediaType: s.mime,
            filename: s.name,
          });
      }
      messages = [...snapshot!.history, { role: "user", content: parts }];
    }
    const model = draft?.model || snapshot!.model;
    const options = reasoningOptions(model, run.effort);
    const temporary = get("thread", run.threadId)?.temporary;
    const providerOptions =
      temporary && ["responses", "chat"].includes(model.protocol)
        ? { ...options, openai: { ...options?.openai, store: false } }
        : options;
    const result = streamText({
      onError: () => {},
      model: modelFor(model),
      system: draft?.system || snapshot!.system,
      messages,
      providerOptions,
      abortSignal: controller.signal,
      maxRetries: 0,
      maxOutputTokens: Math.min(16384, Math.floor(model.contextTokens / 4)),
    });
    let finishReason = "";
    for await (const part of result.fullStream) {
      if (!ownsLease()) {
        controller.abort();
        break;
      }
      if (part.type === "text-delta") {
        text += part.text;
        phase = "writing";
      } else if (part.type === "reasoning-start") phase = "reasoning";
      else if (part.type === "reasoning-delta") {
        reasoning += part.text;
        phase = "reasoning";
      } else if (part.type === "error") throw part.error;
      else if (part.type === "finish") finishReason = part.finishReason;
      if (Date.now() - lastSave > 180) {
        save("running");
        lastSave = Date.now();
      }
    }
    if (controller.signal.aborted)
      throw controller.signal.reason || new Error("Cancelled");
    if (get(kind, run.id)?.cancelRequested || stopping())
      throw new Error("Cancelled");
    const usage = await result.usage;
    if (!text.trim())
      throw new Error(
        "The model returned no answer text. Any returned reasoning is saved. Try another effort or model.",
      );
    if (finishReason === "length")
      throw new Error(
        "The model reached its output limit. Partial work is saved; review it before retrying.",
      );
    db().transaction(() => {
      save("complete", "", {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
      });
      if (draft && ownsLease()) finishDraft(run.id);
    })();
  } catch (error) {
    const cancelled = Boolean(get(kind, run.id)?.cancelRequested);
    db().transaction(() => {
      save(
        cancelled ? "cancelled" : "failed",
        cancelled
          ? "Stopped. Partial work is saved."
          : stopping()
            ? "The worker stopped. Partial work is saved; retry when ready."
            : redact(error),
      );
      if (draft && ownsLease()) finishDraft(run.id);
    })();
  } finally {
    clearInterval(cancel);
    clearTimeout(timeout);
  }
}

export function claimJob(owner: string) {
  return db().transaction(() => {
    for (const old of all("job").filter(
      (j) => j.state === "running" && j.leaseUntil < Date.now(),
    )) {
      if (old.task === "draft") {
        const draft = get("draft", old.targetId);
        if (draft && ["running", "queued"].includes(draft.state)) {
          put("draft", {
            ...draft,
            state: "failed",
            finishedAt: new Date().toISOString(),
            error:
              "The worker restarted. Partial work is saved. Retry explicitly to start a new request.",
          });
          finishDraft(draft.id);
        }
        put("job", { ...old, state: "failed", error: "Worker interrupted." });
      } else if (old.task === "generate") {
        const g = get("generation", old.targetId);
        if (g && ["running", "queued"].includes(g.state)) {
          put("generation", {
            ...g,
            state: "failed",
            error:
              "The worker restarted. Partial output was preserved; retry to continue.",
          });
          const m = get("message", g.messageId);
          if (m) put("message", { ...m, status: "failed" });
        }
        put("job", { ...old, state: "failed", error: "Worker interrupted." });
      } else put("job", { ...old, state: "queued" });
    }
    const next = all("job")
      .filter((j) => j.state === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return next
      ? put("job", {
          ...next,
          state: "running",
          owner,
          leaseUntil: Date.now() + 15000,
        })
      : null;
  })();
}
