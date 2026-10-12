"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowUp,
  Paperclip,
  SlidersHorizontal,
  ArrowUpRight,
  Copy,
  Bookmark,
  GitBranch,
  Square,
  FileText,
  X,
  Check,
  Folder,
  Trash2,
  MessageCircleDashed,
  Plus,
  RefreshCw,
} from "lucide-react";
import type {
  Effort,
  ThreadView,
  Selection,
  Source,
  Snapshot,
  Thread,
  Message,
  Output,
} from "@/domain/types";
import { api, Modal, Markdown, Busy } from "./ui";
import { useWorkspace } from "./shell";
import { EffortSelect, RunDetails } from "./run-activity";
import { ExportDialog } from "./export-dialog";
export function Conversation({ initial }: { initial: ThreadView }) {
  const [view, setView] = useState(initial),
    [draft, setDraft] = useState(initial.thread.draft),
    [effort, setEffort] = useState<Effort>(initial.thread.effort || "default"),
    [modelId, setModelId] = useState(initial.thread.modelId),
    [selections, setSelections] = useState<Selection[]>(
      initial.thread.sourceIds,
    ),
    [includeBrief, setIncludeBrief] = useState(initial.thread.includeBrief),
    [contextOpen, setContextOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [sourceOpen, setSourceOpen] = useState<Source | null>(null),
    [inspect, setInspect] = useState<Snapshot | null>(null),
    [saving, setSaving] = useState<Message | null>(null),
    [editing, setEditing] = useState<Message | null>(null),
    [editText, setEditText] = useState("");
  const { boot, refresh, notify } = useWorkspace(),
    router = useRouter(),
    fileInput = useRef<HTMLInputElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    stick = useRef(true),
    threadId = initial.thread.id;
  const temporary = !!view.thread.temporary;
  const active = view.generations.find(
    (g) => g.state === "queued" || g.state === "running",
  );
  const pollingFast =
    Boolean(active) ||
    view.drafts.some((d) => ["queued", "running"].includes(d.state)) ||
    view.sources.some((s) => ["queued", "processing"].includes(s.status));
  const reload = useCallback(async () => {
    const result = await api<ThreadView>("threads/" + threadId);
    setView(result);
  }, [threadId]);
  useEffect(() => {
    let alive = true;
    const timer = setInterval(
      async () => {
        try {
          const result = await api<ThreadView>("threads/" + threadId);
          if (alive) setView(result);
        } catch (error) {
          if (alive && temporary && /not found|expired/i.test(String(error))) {
            alive = false;
            notify("This temporary chat has ended or expired.");
            void refresh();
            router.replace("/");
          }
        }
      },
      pollingFast ? 650 : 5000,
    );
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId, pollingFast, temporary, notify, refresh, router]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void api("threads/" + threadId, { draft }, "PATCH").catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, threadId]);
  useEffect(() => {
    if (stick.current)
      bottom.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [view.messages]);
  async function persistContext(next: Selection[], brief = includeBrief) {
    setSelections(next);
    setIncludeBrief(brief);
    try {
      await api(
        "threads/" + threadId,
        { sourceIds: next, includeBrief: brief },
        "PATCH",
      );
    } catch (e) {
      notify(String(e));
    }
  }
  async function send() {
    if (!draft.trim() || busy || active) return;
    setBusy(true);
    try {
      await api("chat", {
        threadId,
        text: draft,
        modelId,
        effort,
        sources: selections,
        includeBrief,
      });
      setDraft("");
      stick.current = true;
      await reload();
      await refresh();
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("threadId", threadId);
      form.set("projectId", view.thread.projectId || "");
      Array.from(files).forEach((f) => form.append("files", f));
      const response = await fetch("/api/sources", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const next = [...selections];
      for (const s of result as Source[])
        if (!next.some((item) => item.id === s.id))
          next.push({
            id: s.id,
            mode: s.mime.startsWith("image/") ? "original" : "full",
          });
      await persistContext(next);
      await reload();
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function fork(message: Message, edited?: string) {
    try {
      const next = await api<Thread>("branch", {
        threadId,
        messageId: message.id,
        ...(edited === undefined ? {} : { text: edited }),
      });
      await refresh();
      router.push("/chat/" + next.id);
    } catch (e) {
      notify(String(e));
    }
  }
  return (
    <div className="conversation-page">
      <header className="conversation-header">
        <div>
          <span className="breadcrumb">
            {temporary ? (
              "Temporary chat"
            ) : view.project ? (
              <Link href={"/projects/" + view.project.id}>
                {view.project.name}
              </Link>
            ) : (
              "Quick conversation"
            )}
            {view.thread.parentId && " / branch"}
          </span>
          <h1>{temporary ? "Temporary chat" : view.thread.title}</h1>
        </div>
        <div className="header-actions">
          <button
            className={
              "button context-toggle " + (contextOpen ? "selected" : "")
            }
            onClick={() => setContextOpen(!contextOpen)}
          >
            <SlidersHorizontal size={15} />
            Context
            <span className="count">
              {selections.length + (includeBrief && view.brief ? 1 : 0)}
            </span>
          </button>
          {!temporary && (
            <>
              <button className="button" onClick={() => setExportOpen(true)}>
                <ArrowUpRight size={16} />
                Export
              </button>
              <button
                className="icon-button"
                aria-label="Move conversation to trash"
                onClick={async () => {
                  try {
                    await api(
                      "threads/" + threadId,
                      { deletedAt: new Date().toISOString() },
                      "PATCH",
                    );
                    await refresh();
                    router.push("/");
                    notify(
                      "Conversation moved to Trash. You can restore it in Settings.",
                    );
                  } catch (e) {
                    notify(String(e));
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </header>
      {temporary && (
        <div className="temporary-banner">
          <MessageCircleDashed size={20} />
          <div>
            <strong>This chat is temporary</strong>
            <p>
              Separate from history, search, and backups. No project memory.
            </p>
            <details>
              <summary>How temporary works</summary>
              <p>
                Messages and attachments are held on this Mac so refreshes and
                ongoing responses work. End & delete removes them, or they
                expire after 24 hours without activity. Your selected model
                provider still receives your requests.
              </p>
            </details>
          </div>
          <div className="temporary-actions">
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("threads/" + threadId + "/keep", {});
                  await reload();
                  await refresh();
                  notify("Chat kept. It is now part of your saved history.");
                } catch (e) {
                  notify(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Keep chat
            </button>
            <button
              className="button subtle"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("threads/" + threadId + "/end", {});
                  await refresh();
                  router.replace("/");
                  router.refresh();
                  notify("Temporary chat and its attachments deleted.");
                } catch (e) {
                  notify(String(e));
                  setBusy(false);
                }
              }}
            >
              End & delete
            </button>
          </div>
        </div>
      )}
      <div className="conversation-body">
        <div className="chat-column">
          <div
            className="message-scroll"
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 160;
            }}
          >
            <div className="messages">
              {!view.messages.length && (
                <div className="conversation-empty">
                  <span className="brand-symbol large">
                    w<span>•</span>
                  </span>
                  <h2>
                    {temporary
                      ? "A fresh space for this conversation."
                      : "What are we working on?"}
                  </h2>
                  <p>
                    {temporary
                      ? "Ask a quick question or explore an idea. Keep this chat only if you choose to."
                      : view.project
                        ? "Your approved project context comes with you. Add any sources you need below."
                        : "Start with a question, an idea, or a few files. There is room to figure it out."}
                  </p>
                  <div className="starter-prompts">
                    {[
                      "Help me think through a decision",
                      "Find the important parts of my documents",
                      "Turn this context into a clear plan",
                    ].map((s) => (
                      <button key={s} onClick={() => setDraft(s)}>
                        {s}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {view.drafts.some((d) => d.kind === "handoff") && (
                <button
                  className="draft-return"
                  onClick={() => setExportOpen(true)}
                >
                  <ArrowUpRight size={16} />
                  <span>
                    <strong>
                      {view.drafts.some(
                        (d) =>
                          d.kind === "handoff" &&
                          ["queued", "running"].includes(d.state),
                      )
                        ? "Handoff in progress"
                        : "Saved handoff"}
                    </strong>
                    <small>Open saved work and drafting history</small>
                  </span>
                </button>
              )}
              {view.messages.map((message) => (
                <article
                  id={"message-" + message.id}
                  key={message.id}
                  className={"message message-" + message.role}
                >
                  <div className="message-label">
                    {message.role === "user"
                      ? "You"
                      : message.role === "system"
                        ? "Imported system context"
                        : view.generations.find(
                            (g) => g.messageId === message.id,
                          )?.modelName || "Workbench"}
                    {message.status !== "complete" && message.content && (
                      <span className="message-state">{message.status}</span>
                    )}
                  </div>
                  {message.generationId &&
                    (() => {
                      const run = view.generations.find(
                        (g) => g.id === message.generationId,
                      );
                      return run ? <RunDetails run={run} /> : null;
                    })()}
                  {message.content ? (
                    <Markdown streaming={message.status === "streaming"}>
                      {message.content}
                    </Markdown>
                  ) : ["queued", "streaming"].includes(message.status) ? (
                    <Busy
                      label={
                        message.status === "queued"
                          ? "Waiting for model…"
                          : "Responding…"
                      }
                    />
                  ) : (
                    <p className="muted">No response text was received.</p>
                  )}
                  {message.sourceIds.length > 0 && (
                    <div className="message-files">
                      {message.sourceIds.map((id) => (
                        <span key={id}>
                          <Paperclip size={12} />
                          {view.sources.find((s) => s.id === id)?.name ||
                            "Source"}
                        </span>
                      ))}
                    </div>
                  )}
                  {message.content && (
                    <div className="message-actions">
                      {message.generationId && (
                        <button
                          aria-label="Inspect response context"
                          onClick={async () => {
                            const generation = view.generations.find(
                              (g) => g.id === message.generationId,
                            );
                            if (generation)
                              try {
                                setInspect(
                                  await api<Snapshot>(
                                    "snapshots/" + generation.snapshotId,
                                  ),
                                );
                              } catch (error) {
                                notify(String(error));
                              }
                          }}
                        >
                          <SlidersHorizontal size={14} />
                        </button>
                      )}

                      <button
                        title="Copy message"
                        aria-label="Copy message"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(message.content)
                            .then(() => notify("Copied."))
                            .catch((e) => notify(String(e)))
                        }
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        disabled={temporary}
                        title={
                          temporary
                            ? "Keep this chat first to save an output"
                            : "Save output"
                        }
                        aria-label="Save output"
                        onClick={() => setSaving(message)}
                      >
                        <Bookmark size={14} />
                      </button>
                      <button
                        disabled={temporary}
                        title={
                          temporary
                            ? "Keep this chat first to branch"
                            : "Continue in a branch"
                        }
                        aria-label="Continue in a branch"
                        onClick={() => {
                          if (message.role === "user") {
                            setEditing(message);
                            setEditText(message.content);
                          } else void fork(message);
                        }}
                      >
                        <GitBranch size={14} />
                      </button>
                      {view.project && (
                        <button
                          title="Propose for project brief"
                          onClick={async () => {
                            try {
                              await api("briefs", {
                                projectId: view.project!.id,
                                content:
                                  (view.brief?.content || "") +
                                  "\n\n## Proposed addition\n" +
                                  message.content,
                                previousId: view.brief?.id || null,
                                evidence: [message.id],
                                accept: false,
                              });
                              notify(
                                "Saved as a proposal. Review it in the project brief.",
                              );
                            } catch (e) {
                              notify(String(e));
                            }
                          }}
                        >
                          <Folder size={14} />
                          <span>Save to project</span>
                        </button>
                      )}
                    </div>
                  )}
                  {view.generations
                    .filter((g) => g.messageId === message.id && g.error)
                    .map((g) => (
                      <div className="inline-error" key={g.id}>
                        <p>{g.error}</p>
                        <button
                          className="text-link"
                          disabled={temporary}
                          onClick={() => fork(message)}
                        >
                          <RefreshCw size={13} />
                          Retry in a branch
                        </button>
                      </div>
                    ))}
                </article>
              ))}
              <div ref={bottom} />
            </div>
          </div>
          <div className="composer-area">
            {active && (
              <div className="activity-line">
                <Busy
                  label={
                    active.cancelRequested
                      ? "Stopping…"
                      : active.state === "queued"
                        ? "Queued"
                        : "Responding"
                  }
                />
                <Elapsed since={active.createdAt} />
                <details>
                  <summary>Details</summary>
                  <span>
                    Response saved locally as it arrives.{" "}
                    {active.id.slice(0, 8)}
                  </span>
                </details>
                <button
                  onClick={async () => {
                    try {
                      await api("generations/" + active.id + "/stop", {});
                      await reload();
                    } catch (e) {
                      notify(String(e));
                    }
                  }}
                >
                  <Square size={12} />
                  Stop
                </button>
              </div>
            )}
            <div
              className="composer"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void upload(e.dataTransfer.files);
              }}
            >
              {selections.length > 0 && (
                <div className="composer-sources">
                  {selections.map((selection) => {
                    const s = view.sources.find((s) => s.id === selection.id);
                    return (
                      <span className="source-chip" key={selection.id}>
                        <FileText size={13} />
                        <button onClick={() => setContextOpen(true)}>
                          {s?.name || "Loading source"}
                          {s && s.status !== "ready" ? " · " + s.status : ""}
                        </button>
                        <button
                          aria-label={"Remove " + s?.name}
                          onClick={() =>
                            persistContext(
                              selections.filter((x) => x.id !== selection.id),
                            )
                          }
                        >
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <textarea
                aria-label="Message"
                placeholder="Ask, explore, or bring something to work on…"
                value={draft}
                rows={3}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-toolbar">
                <div>
                  <button
                    className="icon-button"
                    aria-label="Attach files"
                    onClick={() => fileInput.current?.click()}
                    disabled={busy}
                  >
                    <Plus size={20} />
                  </button>
                  <input
                    type="file"
                    ref={fileInput}
                    multiple
                    className="visually-hidden"
                    onChange={(e) => upload(e.target.files)}
                  />
                  <select
                    aria-label="Choose model"
                    value={modelId}
                    onChange={(e) => {
                      setModelId(e.target.value);
                      setEffort("default");
                      void api(
                        "threads/" + threadId,
                        { modelId: e.target.value, effort: "default" },
                        "PATCH",
                      ).catch((e) => notify(String(e)));
                    }}
                  >
                    <option value="">Choose a model</option>
                    {boot.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.verifiedAt ? "" : " · untested"}
                      </option>
                    ))}
                  </select>
                  <EffortSelect
                    model={boot.models.find((m) => m.id === modelId)}
                    value={effort}
                    disabled={!!active || busy}
                    onChange={(value) => {
                      setEffort(value);
                      void api(
                        "threads/" + threadId,
                        { effort: value },
                        "PATCH",
                      ).catch((e) => notify(String(e)));
                    }}
                  />
                </div>
                <button
                  className="send-button"
                  aria-label="Send message"
                  disabled={busy || !!active || !draft.trim() || !modelId}
                  onClick={send}
                >
                  {busy ? <Busy label="" /> : <ArrowUp size={19} />}
                </button>
              </div>
            </div>
            <div className="composer-footnote">
              <span>
                {includeBrief && view.brief ? (
                  <>
                    <Check size={12} />
                    Project brief included
                  </>
                ) : (
                  "Only the context you choose"
                )}
              </span>
              {!boot.configured ? (
                <Link href="/settings">Connect a model to begin →</Link>
              ) : (
                <span>Enter to send · Shift + Enter for a new line</span>
              )}
            </div>
          </div>
        </div>
        {contextOpen && (
          <aside className="context-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">For this conversation</span>
                <h2>Working context</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close context"
                onClick={() => setContextOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="panel-content">
              {view.project && (
                <section>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={includeBrief}
                      onChange={(e) =>
                        persistContext(selections, e.target.checked)
                      }
                    />
                    <strong>Project brief</strong>
                  </label>
                  <p className="muted small">
                    {view.brief
                      ? "Approved context, carried into each message."
                      : "No approved brief yet."}
                  </p>
                  {view.brief && (
                    <details className="brief-peek">
                      <summary>Read included brief</summary>
                      <Markdown>{view.brief.content}</Markdown>
                    </details>
                  )}
                  <Link
                    className="text-link"
                    href={"/projects/" + view.project.id}
                  >
                    Manage project brief
                    <ArrowUpRight size={13} />
                  </Link>
                </section>
              )}
              <section>
                <div className="section-heading">
                  <h3>Sources</h3>
                  <button
                    className="icon-button"
                    aria-label="Add a source"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {view.sources.length === 0 && (
                  <p className="muted small">
                    Attach files here or drop them into the composer.
                  </p>
                )}
                {view.sources.map((s) => {
                  const selected = selections.find((x) => x.id === s.id);
                  return (
                    <div className="source-row" key={s.id}>
                      <label className="check-line">
                        <input
                          type="checkbox"
                          checked={!!selected}
                          onChange={(e) =>
                            persistContext(
                              e.target.checked
                                ? [
                                    ...selections,
                                    {
                                      id: s.id,
                                      mode: s.mime.startsWith("image/")
                                        ? "original"
                                        : "full",
                                    },
                                  ]
                                : selections.filter((x) => x.id !== s.id),
                            )
                          }
                        />
                        <span>{s.name}</span>
                      </label>
                      <span
                        className={
                          "source-status " + (s.error ? "warning" : "")
                        }
                      >
                        {s.error || s.status}
                      </span>
                      {selected && (
                        <select
                          aria-label={"Input mode for " + s.name}
                          value={selected.mode}
                          onChange={(e) =>
                            persistContext(
                              selections.map((x) =>
                                x.id === s.id
                                  ? {
                                      ...x,
                                      mode: e.target.value as Selection["mode"],
                                    }
                                  : x,
                              ),
                            )
                          }
                        >
                          {!s.mime.startsWith("image/") && (
                            <>
                              <option value="full">
                                Complete extracted text
                              </option>
                              <option value="excerpts">
                                Relevant excerpts
                              </option>
                            </>
                          )}
                          {(s.mime.startsWith("image/") ||
                            s.mime === "application/pdf") && (
                            <option value="original">Original file</option>
                          )}
                        </select>
                      )}
                      <div className="source-actions">
                        <button
                          onClick={async () => {
                            try {
                              setSourceOpen(
                                await api<Source>("sources/" + s.id),
                              );
                            } catch (e) {
                              notify(String(e));
                            }
                          }}
                        >
                          Preview
                        </button>
                        {s.status === "failed" && (
                          <button
                            onClick={async () => {
                              try {
                                await api("sources/" + s.id + "/retry", {});
                                await reload();
                              } catch (e) {
                                notify(String(e));
                              }
                            }}
                          >
                            Retry
                          </button>
                        )}
                        <a href={"/api/sources/" + s.id + "/download"}>
                          Original
                        </a>
                      </div>
                    </div>
                  );
                })}
              </section>
              <button
                className="button full-width"
                disabled={!modelId}
                onClick={async () => {
                  try {
                    setInspect(
                      await api<Snapshot>("context", {
                        threadId,
                        text: draft,
                        modelId,
                        sources: selections,
                        includeBrief,
                      }),
                    );
                  } catch (e) {
                    notify(String(e));
                  }
                }}
              >
                Inspect next message context
              </button>
              <p className="muted small">
                Each response keeps a snapshot of what the model received.
              </p>
              {view.outputs.length > 0 && (
                <section>
                  <h3>Saved outputs</h3>
                  {view.outputs.slice(0, 8).map((o) => (
                    <Link
                      className="saved-link"
                      key={o.id}
                      href={"/outputs/" + o.id}
                    >
                      <Bookmark size={14} />
                      {o.title}
                    </Link>
                  ))}
                </section>
              )}
            </div>
          </aside>
        )}
      </div>
      {exportOpen && (
        <ExportDialog view={view} close={() => setExportOpen(false)} />
      )}
      <Modal
        open={!!sourceOpen}
        onClose={() => setSourceOpen(null)}
        title={sourceOpen?.name || "Source preview"}
        description="Extracted text is separate from the original document."
        wide
      >
        {sourceOpen?.mime.startsWith("image/") && (
          <Image
            src={"/api/sources/" + sourceOpen.id + "/preview"}
            alt={sourceOpen.name}
            width={600}
            height={450}
            unoptimized
            style={{
              maxWidth: "100%",
              height: "auto",
              maxHeight: "55vh",
              objectFit: "contain",
            }}
          />
        )}
        <pre className="source-preview">
          {sourceOpen?.text ||
            "No extracted text. Use the original with a compatible model."}
        </pre>
      </Modal>
      <Modal
        open={!!inspect}
        onClose={() => setInspect(null)}
        title="Context for the next message"
        description="Frozen at send time. Source coverage is shown below."
        wide
      >
        <p className="note">
          Approximately {inspect?.estimatedTokens.toLocaleString()} text tokens.
          Native file tokens are measured by the provider.
        </p>
        {inspect?.sources.map((s) => (
          <p key={s.id} className="check-line">
            <Check size={14} />
            {s.name} · {s.coverage}
          </p>
        ))}
        <details>
          <summary>Included project brief and source text</summary>
          <pre className="source-preview">{inspect?.system}</pre>
        </details>
        <p className="muted">
          {inspect?.history.length} prior messages will also be included.
        </p>
      </Modal>
      <Modal
        open={!!saving}
        onClose={() => setSaving(null)}
        title="Save a useful output"
        description="Keep a result you can edit, revisit, and export."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              const output = await api<Output>("outputs", {
                threadId,
                title: form.get("title"),
                content: saving!.content,
                evidence: [saving!.id],
              });
              setSaving(null);
              router.push("/outputs/" + output.id);
            } catch (error) {
              notify(String(error));
            }
          }}
        >
          <label>
            Title
            <input name="title" required defaultValue={view.thread.title} />
          </label>
          <div className="modal-actions">
            <button className="button primary">Save output</button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Explore another direction"
        description="This creates a branch. Your original conversation is preserved."
      >
        <textarea
          rows={7}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
        />
        <div className="modal-actions">
          <button
            className="button primary"
            onClick={() => editing && fork(editing, editText)}
          >
            Create branch
          </button>
        </div>
      </Modal>
    </div>
  );
}
function Elapsed({ since }: { since: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - Date.parse(since)) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [since]);
  return <span className="elapsed">{seconds}s</span>;
}
