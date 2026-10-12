"use client";
import { useEffect, useRef, useState } from "react";
import {
  Download,
  Copy,
  Sparkles,
  Square,
  Check,
  ArrowRight,
  History,
} from "lucide-react";
import type {
  DraftSummary,
  Effort,
  ExportIntent,
  ExportSnapshot,
  ThreadView,
} from "@/domain/types";
import { api, Modal, Markdown, Busy, formatDate } from "./ui";
import { useWorkspace } from "./shell";
import { EffortSelect, RunDetails } from "./run-activity";
const running = (draft: DraftSummary | null) =>
  !!draft && ["queued", "running"].includes(draft.state);
function downloadExport(id: string, format: "html" | "download" | "bundle") {
  const link = document.createElement("a");
  link.href = "/api/exports/" + id + "/" + format;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}
export function ExportDialog({
  view,
  close,
  initialContent,
}: {
  view: ThreadView;
  close: () => void;
  initialContent?: string;
}) {
  const { boot, notify } = useWorkspace();
  const [intent, setIntent] = useState<ExportIntent>(
    initialContent ? "share" : "continue",
  );
  const [nextTask, setNextTask] = useState("");
  const [selected, setSelected] = useState(
    view.messages
      .filter((m) => !["queued", "streaming"].includes(m.status))
      .map((m) => m.id),
  );
  const [files, setFiles] = useState<string[]>([]);
  const [packet, setPacket] = useState<ExportSnapshot | null>(null);
  const [content, setContent] = useState(initialContent || "");
  const [draft, setDraft] = useState<DraftSummary | null>(null);
  const [history, setHistory] = useState<ExportSnapshot[]>([]);
  const [modelId, setModelId] = useState(view.thread.modelId);
  const [effort, setEffort] = useState<Effort>("default");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!initialContent);
  const [saveStatus, setSaveStatus] = useState("");
  const saveRef = useRef<{
    packet: ExportSnapshot;
    text: string;
    promise?: Promise<void>;
  } | null>(null);
  const active = running(draft);
  const draftId = draft?.id;
  const model = boot.models.find((m) => m.id === modelId);
  function showPacket(p: ExportSnapshot) {
    let recovered: string | null = null;
    try {
      recovered = sessionStorage.getItem("workbench-export-edit:" + p.id);
    } catch {}
    setPacket(p);
    setContent(recovered ?? p.content);
    setIntent(p.intent);
    setNextTask(p.nextTask);
    setSelected(p.messageIds);
    setFiles(p.sourceIds);
    setEditing(recovered !== null && recovered !== p.content);
    saveRef.current = { packet: p, text: recovered ?? p.content };
    setSaveStatus(
      recovered !== null && recovered !== p.content
        ? "Recovered unsaved edits — review and save"
        : "Saved locally",
    );
  }
  // Serialize writes and coalesce keystrokes. The request continues if this view unmounts.
  async function persist() {
    const state = saveRef.current;
    if (!state) return;
    if (state.promise) return state.promise;
    state.promise = (async () => {
      while (state.text !== state.packet.content) {
        setSaveStatus("Saving…");
        const text = state.text;
        const response = await fetch("/api/exports/" + state.packet.id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: text,
            revision: state.packet.revision || 0,
          }),
          keepalive: new TextEncoder().encode(text).length < 50000,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Could not save edits.");
        state.packet = result;
        if (state.text === state.packet.content) {
          try {
            sessionStorage.removeItem(
              "workbench-export-edit:" + state.packet.id,
            );
          } catch {}
        }
      }
      setSaveStatus("Saved locally");
    })();
    try {
      await state.promise;
    } catch (e) {
      setSaveStatus("Not saved — retry");
      throw e;
    } finally {
      state.promise = undefined;
    }
  }
  const payload = () => ({
    threadId: view.thread.id,
    intent,
    nextTask,
    messageIds: selected,
    sourceIds: files,
  });
  useEffect(() => {
    let alive = true;
    Promise.all([
      api<ExportSnapshot[]>("exports?threadId=" + view.thread.id),
      api<DraftSummary[]>("drafts?threadId=" + view.thread.id),
    ])
      .then(([packets, drafts]) => {
        if (!alive) return;
        setHistory(packets);
        if (initialContent !== undefined) return;
        const newest = drafts.find((d) => d.kind === "handoff");
        const chosen =
          newest && running(newest)
            ? packets.find((p) => p.id === newest.exportId)
            : packets[0];
        if (chosen) {
          showPacket(chosen);
          const task = drafts.find((d) => d.exportId === chosen.id) || null;
          setDraft(task);
          if (task) {
            setModelId(task.model.id);
            setEffort(task.effort || "default");
          }
        }
      })
      .catch((e) => notify(String(e)))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [view.thread.id, initialContent, notify]);
  useEffect(() => {
    if (!draftId || !active) return;
    let alive = true;
    const id = draftId;
    let polling = false;
    const tick = async () => {
      if (polling) return;
      polling = true;
      try {
        const drafts = await api<DraftSummary[]>(
          "drafts?threadId=" + view.thread.id,
        );
        const updated = drafts.find((d) => d.id === id);
        if (!alive || !updated) return;
        if (!running(updated) && updated.exportId) {
          const p = await api<ExportSnapshot>("exports/" + updated.exportId);
          if (alive) {
            showPacket(p);
            setDraft(updated);
            setHistory((h) => [p, ...h.filter((item) => item.id !== p.id)]);
          }
        } else setDraft(updated);
      } catch (e) {
        if (alive) notify(String(e));
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, 650);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [draftId, active, view.thread.id, notify]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    await persist();
    const result = await api<ExportSnapshot>("exports", {
      ...payload(),
      ...(initialContent !== undefined ? { content } : {}),
    });
    showPacket(result);
    setDraft(null);
    setHistory((h) => [result, ...h]);
  }
  async function generate() {
    await persist();
    const task = await api<DraftSummary>("draft", {
      ...payload(),
      modelId,
      effort,
      kind: "handoff",
    });
    const p = await api<ExportSnapshot>("exports/" + task.exportId);
    showPacket(p);
    setDraft(task);
    setHistory((h) => [p, ...h]);
  }
  return (
    <Modal
      open
      onClose={() => {
        void perform(async () => {
          await persist();
          close();
        });
      }}
      title={
        active
          ? "Drafting your handoff"
          : packet
            ? "Review your export"
            : "What do you want to take away?"
      }
      description={
        active
          ? "You can close this window. Your draft will keep running while Workbench is open."
          : packet
            ? "Saved on this Mac. Review and edit before taking it to your next destination."
            : "Choose the purpose and the context worth carrying forward."
      }
      wide
    >
      {loading ? (
        <Busy label="Opening saved work…" />
      ) : (
        <>
          {history.length > 0 && (
            <details className="export-history">
              <summary>
                <History size={14} /> Saved exports · {history.length}
              </summary>
              <div>
                {history.map((p) => (
                  <button
                    className="button subtle"
                    disabled={busy || active}
                    key={p.id}
                    onClick={() => {
                      void perform(async () => {
                        await persist();
                        const latest = await api<ExportSnapshot>(
                          "exports/" + p.id,
                        );
                        showPacket(latest);
                        const tasks = await api<DraftSummary[]>(
                          "drafts?threadId=" + view.thread.id,
                        );
                        setDraft(
                          tasks.find((d) => d.exportId === p.id) || null,
                        );
                      });
                    }}
                  >
                    {p.intent === "continue"
                      ? "Handoff"
                      : p.intent === "share"
                        ? "Result"
                        : "Transcript"}{" "}
                    · {formatDate(p.createdAt, true)}
                  </button>
                ))}
              </div>
            </details>
          )}
          {!packet ? (
            <>
              <div className="intent-options">
                {(
                  [
                    [
                      "continue",
                      "Continue elsewhere",
                      "A self-contained starting point for your next AI chat.",
                    ],
                    [
                      "share",
                      "Share the result",
                      "The finished work you want to share.",
                    ],
                    [
                      "transcript",
                      "Keep the conversation",
                      "Preserve the selected conversation.",
                    ],
                  ] as const
                ).map(([id, title, description]) => (
                  <button
                    key={id}
                    className={intent === id ? "selected" : ""}
                    onClick={() => {
                      setIntent(id);
                      setSelected(
                        view.messages
                          .filter(
                            (m) =>
                              !["queued", "streaming"].includes(m.status) &&
                              (id !== "share" || m.role === "assistant"),
                          )
                          .map((m) => m.id),
                      );
                    }}
                  >
                    <span>
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </span>
                    {intent === id && <Check size={18} />}
                  </button>
                ))}
              </div>
              {intent === "continue" && (
                <label>
                  What should the next AI help you do?
                  <textarea
                    rows={2}
                    value={nextTask}
                    onChange={(e) => setNextTask(e.target.value)}
                    placeholder="Continue the idea, challenge an approach, or turn a decision into a plan…"
                  />
                </label>
              )}
              <details className="selection-details">
                <summary>
                  Conversation selection <span>{selected.length} messages</span>
                </summary>
                <div className="selection-list">
                  {view.messages.map((m) => (
                    <label className="check-line" key={m.id}>
                      <input
                        type="checkbox"
                        disabled={["queued", "streaming"].includes(m.status)}
                        checked={selected.includes(m.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, m.id]
                              : selected.filter((id) => id !== m.id),
                          )
                        }
                      />
                      <span>
                        <strong>{m.role}</strong>{" "}
                        {m.content.slice(0, 150) || "Response in progress"}
                      </span>
                    </label>
                  ))}
                </div>
              </details>
              <details className="selection-details">
                <summary>
                  Include original files <span>{files.length} selected</span>
                </summary>
                {view.sources.map((s) => (
                  <label className="check-line" key={s.id}>
                    <input
                      type="checkbox"
                      checked={files.includes(s.id)}
                      onChange={(e) =>
                        setFiles(
                          e.target.checked
                            ? [...files, s.id]
                            : files.filter((id) => id !== s.id),
                        )
                      }
                    />
                    {s.name}
                  </label>
                ))}
                <p className="muted small">
                  Originals travel in the source bundle. Drafting uses their
                  extracted text where available.
                </p>
              </details>
              <div className="modal-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => {
                    void perform(preview);
                  }}
                >
                  {busy ? (
                    <Busy />
                  ) : (
                    <>
                      Build preview <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="export-toolbar">
                <button
                  className="button subtle"
                  disabled={busy || active}
                  onClick={() => {
                    void perform(async () => {
                      await persist();
                      setPacket(null);
                      setDraft(null);
                    });
                  }}
                >
                  ← Selection
                </button>
                <span className="muted">
                  {
                    (active ? draft?.content || "" : content)
                      .trim()
                      .split(/\s+/)
                      .filter(Boolean).length
                  }{" "}
                  words ·{" "}
                  {files.length
                    ? `${files.length} originals`
                    : "one Markdown file"}
                </span>
                <button
                  className="button"
                  disabled={active || busy}
                  onClick={() => setEditing(!editing)}
                >
                  {editing ? "Read preview" : "Edit text"}
                </button>
              </div>
              {intent === "continue" && (
                <div className="draft-controls">
                  <label>
                    Drafting model
                    <select
                      aria-label="Drafting model"
                      value={modelId}
                      disabled={active || busy}
                      onChange={(e) => {
                        setModelId(e.target.value);
                        setEffort("default");
                      }}
                    >
                      <option value="">Choose a model</option>
                      {boot.models
                        .filter((m) => m.verifiedAt)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <EffortSelect
                    model={model}
                    value={effort}
                    onChange={setEffort}
                    disabled={active || busy}
                  />
                  {active ? (
                    <button
                      className="button"
                      disabled={busy || draft?.cancelRequested}
                      onClick={() => {
                        void perform(async () => {
                          await api("drafts/" + draft!.id + "/stop", {});
                          setDraft((d) =>
                            d ? { ...d, cancelRequested: true } : d,
                          );
                        });
                      }}
                    >
                      <Square size={14} />
                      {draft?.cancelRequested ? "Stopping…" : "Stop drafting"}
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      disabled={busy || !model?.verifiedAt}
                      onClick={() => {
                        void perform(generate);
                      }}
                    >
                      <Sparkles size={14} />
                      {draft ? "Draft again" : "Draft handoff"}
                    </button>
                  )}
                </div>
              )}
              {draft && <RunDetails run={draft} />}
              {draft?.error && (
                <p className="draft-error" role="status">
                  {draft.error}{" "}
                  {draft.content
                    ? "Review the partial draft below."
                    : "No draft text was received."}
                </p>
              )}
              {active ? (
                <div className="export-preview" aria-live="off">
                  {draft?.content ? (
                    <Markdown streaming>{draft.content}</Markdown>
                  ) : (
                    <div className="draft-waiting">
                      <Busy
                        label={
                          draft?.state === "queued"
                            ? "Queued for the local worker…"
                            : "Preparing your handoff…"
                        }
                      />
                      <p>The new draft will appear here as it arrives.</p>
                      <p className="muted small">
                        You can close this window and reopen Export to continue.
                      </p>
                    </div>
                  )}
                </div>
              ) : editing ? (
                <textarea
                  aria-label="Export text"
                  className="export-editor"
                  rows={18}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    if (saveRef.current) {
                      saveRef.current.text = e.target.value;
                      try {
                        sessionStorage.setItem(
                          "workbench-export-edit:" + saveRef.current.packet.id,
                          e.target.value,
                        );
                      } catch {}
                    }
                    void persist().catch((e) => notify(String(e)));
                  }}
                />
              ) : (
                <div className="export-preview">
                  <Markdown>{content}</Markdown>
                </div>
              )}
              <div className="export-save-status" role="status">
                {!active && saveStatus}
                {(saveStatus.startsWith("Not saved") ||
                  saveStatus.startsWith("Recovered")) && (
                  <button
                    onClick={() => {
                      void persist().catch((e) => notify(String(e)));
                    }}
                  >
                    Save edits
                  </button>
                )}
                {active &&
                  !boot.workerAlive &&
                  "Worker may be offline. Start Workbench to process queued work."}
              </div>
              <div className="modal-actions">
                <button
                  className="button"
                  disabled={active || busy || !content.trim()}
                  onClick={() => {
                    void perform(async () => {
                      await persist();
                      await navigator.clipboard.writeText(content);
                      notify("Export copied.");
                    });
                  }}
                >
                  <Copy size={15} />
                  Copy
                </button>
                {intent === "share" && (
                  <button
                    className="button"
                    disabled={active || busy}
                    onClick={() => {
                      void perform(async () => {
                        await persist();
                        downloadExport(packet.id, "html");
                      });
                    }}
                  >
                    Print-friendly HTML
                  </button>
                )}
                <button
                  className="button primary"
                  disabled={active || busy || !content.trim()}
                  onClick={() => {
                    void perform(async () => {
                      await persist();
                      downloadExport(packet.id, "download");
                    });
                  }}
                >
                  <Download size={16} />
                  Markdown
                </button>
                {files.length > 0 && (
                  <button
                    className="button"
                    disabled={active || busy}
                    onClick={() => {
                      void perform(async () => {
                        await persist();
                        downloadExport(packet.id, "bundle");
                      });
                    }}
                  >
                    Bundle with originals
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
