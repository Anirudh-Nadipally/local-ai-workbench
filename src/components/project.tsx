"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import {
  Plus,
  ArrowUpRight,
  FileText,
  Bookmark,
  History,
  Check,
  Sparkles,
  Import,
  Paperclip,
} from "lucide-react";
import type {
  Project,
  Brief,
  Thread,
  Source,
  Output,
  DraftSummary,
  Effort,
  ThreadView,
} from "@/domain/types";
import { api, Markdown, Modal, Busy, relativeDate, formatDate } from "./ui";
import { useWorkspace } from "./shell";
import { EffortSelect, RunDetails } from "./run-activity";
import { ImportDialog } from "./import-dialog";
export type ProjectView = {
  project: Project;
  brief: Brief | null;
  revisions: Brief[];
  threads: Thread[];
  sources: Source[];
  outputs: Output[];
  drafts: DraftSummary[];
};
export function ProjectPage({ initial }: { initial: ProjectView }) {
  const [view, setView] = useState(initial),
    [editor, setEditor] = useState(false),
    [proposalId, setProposalId] = useState<string | null>(null),
    [content, setContent] = useState(""),
    [evidence, setEvidence] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState(false),
    [importing, setImporting] = useState(false);
  const [draftThread, setDraftThread] = useState(initial.threads[0]?.id || "");
  const [draftModel, setDraftModel] = useState(
    initial.threads[0]?.modelId || "",
  );
  const [effort, setEffort] = useState<Effort>("default");
  const [saveStatus, setSaveStatus] = useState("");
  const editRef = useRef<{
    record: Brief | null;
    text: string;
    evidence: string[];
    previousId: string | null;
    promise?: Promise<void>;
    dirty?: boolean;
  } | null>(null);
  const { boot, refresh, notify } = useWorkspace(),
    router = useRouter();
  const project = view.project;
  async function newChat() {
    try {
      const t = await api<Thread>("threads", { projectId: project.id });
      await refresh();
      router.push("/chat/" + t.id);
    } catch (e) {
      notify(String(e));
    }
  }
  async function reload() {
    setView(await api<ProjectView>("projects/" + project.id));
    await refresh();
  }
  const activeDraft = view.drafts.find(
    (d) => d.kind === "brief" && ["queued", "running"].includes(d.state),
  );
  const drafting = !!activeDraft;
  useEffect(() => {
    let alive = true;
    const timer = setInterval(
      async () => {
        try {
          const result = await api<ProjectView>(
            "projects/" + initial.project.id,
          );
          if (alive) setView(result);
        } catch {}
      },
      drafting ? 650 : 5000,
    );
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [initial.project.id, drafting]);
  function openEditor(record: Brief | null, text: string) {
    editRef.current = {
      record,
      text,
      evidence: record?.evidence || [],
      previousId: record ? record.previousId : view.brief?.id || null,
      dirty: false,
    };
    setContent(text);
    setEvidence(record?.evidence || []);
    setProposalId(record?.id || null);
    setSaveStatus(record ? "Saved locally" : "");
    setEditor(true);
  }
  async function saveProposal() {
    const state = editRef.current;
    if (!state || activeDraft || !state.text.trim() || !state.dirty) return;
    if (state.promise) return state.promise;
    state.promise = (async () => {
      while (!state.record || state.record.content !== state.text) {
        setSaveStatus("Saving…");
        const next = state.text;
        state.record = state.record
          ? await api<Brief>(
              "briefs/" + state.record.id,
              { content: next, updatedAt: state.record.updatedAt },
              "PATCH",
            )
          : await api<Brief>("briefs", {
              projectId: project.id,
              content: next,
              evidence: state.evidence,
              previousId: state.previousId,
              accept: false,
            });
        setProposalId(state.record.id);
      }
      state.dirty = false;
      setSaveStatus("Saved locally");
    })();
    try {
      await state.promise;
    } catch (e) {
      setSaveStatus("Edits not saved");
      throw e;
    } finally {
      state.promise = undefined;
    }
  }
  const newest = new Set(view.outputs.map((o) => o.previousId).filter(Boolean));
  return (
    <div className="project-page">
      <header className="page-top">
        <span className="eyebrow">Project workspace</span>
        <div className="header-actions">
          <button className="button" onClick={() => setImporting(true)}>
            <Import size={15} />
            Import
          </button>
          <button className="button primary" onClick={newChat}>
            <Plus size={16} />
            New conversation
          </button>
        </div>
      </header>
      <div className="project-intro">
        <span className="project-mark">{project.name[0].toUpperCase()}</span>
        <h1>{project.name}</h1>
        <p>
          {project.objective ||
            "A home for related thinking, decisions, and useful work."}
        </p>
      </div>
      <div className="project-columns">
        <section className="project-main">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Where things stand</span>
              <h2>Project brief</h2>
            </div>
            <button
              className="button"
              onClick={() => {
                openEditor(
                  null,
                  view.brief?.content ||
                    `## Objective\n${project.objective}\n\n## Constraints\n\n## Accepted decisions\n\n## Open questions\n\n## Next action\n`,
                );
              }}
            >
              {view.brief ? "Edit brief" : "Write a brief"}
            </button>
          </div>
          {view.brief ? (
            <div className="project-brief">
              <Markdown>{view.brief.content}</Markdown>
              <div className="brief-footer">
                <Check size={13} />
                Approved · included in project chats
                <button onClick={() => setHistory(true)}>
                  <History size={13} />
                  History
                </button>
              </div>
            </div>
          ) : (
            <div className="brief-empty">
              <FileText size={24} />
              <h3>A short brief goes a long way.</h3>
              <p>
                Keep the objective, constraints, decisions, and next action
                here. Approve it once, and it travels into new project
                conversations.
              </p>
            </div>
          )}
          {view.drafts
            .filter((d) => d.kind === "brief")
            .slice(0, 3)
            .map((d) => (
              <div className="draft-project-status" key={d.id}>
                <strong>Brief · {d.model.name}</strong>
                <RunDetails run={d} />
                {d.error && <p className="draft-error">{d.error}</p>}
                {["queued", "running"].includes(d.state) && (
                  <button
                    className="button"
                    onClick={() => {
                      void api("drafts/" + d.id + "/stop", {})
                        .then(reload)
                        .catch((e) => notify(String(e)));
                    }}
                  >
                    Stop drafting
                  </button>
                )}
              </div>
            ))}
          {view.revisions
            .filter((b) => b.status === "draft")
            .map((b) => (
              <div className="proposal" key={b.id}>
                <div>
                  <span className="eyebrow">Proposed update</span>
                  <p>{b.content.slice(0, 140)}</p>
                </div>
                <button
                  className="button"
                  onClick={() => {
                    openEditor(b, b.content);
                  }}
                >
                  Review
                </button>
                <button
                  className="button subtle"
                  onClick={async () => {
                    try {
                      await api("briefs/" + b.id + "/dismiss", {});
                      await reload();
                    } catch (error) {
                      notify(String(error));
                    }
                  }}
                >
                  Dismiss
                </button>
              </div>
            ))}
          <div className="section-heading spaced">
            <h2>Conversations</h2>
            <span>{view.threads.length}</span>
          </div>
          <div className="project-thread-list">
            {view.threads.map((t) => (
              <Link href={"/chat/" + t.id} key={t.id}>
                <div>
                  <strong>{t.title}</strong>
                  <span>{relativeDate(t.updatedAt)}</span>
                </div>
                <ArrowUpRight size={16} />
              </Link>
            ))}
            {!view.threads.length && (
              <p className="muted">
                Start a conversation to put your project in motion.
              </p>
            )}
          </div>
        </section>
        <aside className="project-aside">
          <section>
            <div className="section-heading">
              <h3>Saved outputs</h3>
              <Bookmark size={16} />
            </div>
            {view.outputs
              .filter((o) => !newest.has(o.id))
              .map((o) => (
                <Link
                  className="saved-link"
                  key={o.id}
                  href={"/outputs/" + o.id}
                >
                  <FileText size={15} />
                  {o.title}
                </Link>
              ))}
            {!view.outputs.length && (
              <p className="muted small">
                Save a useful answer from a conversation. It will be waiting
                here.
              </p>
            )}
          </section>
          <section>
            <div className="section-heading">
              <h3>Sources</h3>
              <label className="icon-button">
                <Plus size={16} />
                <span className="visually-hidden">Add project sources</span>
                <input
                  type="file"
                  multiple
                  className="visually-hidden"
                  onChange={async (e) => {
                    const form = new FormData();
                    form.set("projectId", project.id);
                    Array.from(e.target.files || []).forEach((f) =>
                      form.append("files", f),
                    );
                    try {
                      const response = await fetch("/api/sources", {
                        method: "POST",
                        body: form,
                      });
                      const data = await response.json();
                      if (!response.ok) throw new Error(data.error);
                      await reload();
                      notify(
                        "Sources added. Select them in a conversation when needed.",
                      );
                    } catch (error) {
                      notify(String(error));
                    }
                  }}
                />
              </label>
            </div>
            {view.sources.map((s) => (
              <a
                className="saved-link"
                href={"/api/sources/" + s.id + "/download"}
                key={s.id}
              >
                <Paperclip size={14} />
                {s.name}
              </a>
            ))}
            {!view.sources.length && (
              <p className="muted small">
                Keep supporting documents close. Sources are included only when
                selected.
              </p>
            )}
          </section>
        </aside>
      </div>
      <Modal
        open={editor}
        onClose={() => {
          void saveProposal()
            .then(() => {
              setEditor(false);
              void reload();
            })
            .catch((e) => notify(String(e)));
        }}
        title="Review project context"
        description="Accept only what should carry into future conversations. Earlier revisions remain available."
        wide
      >
        <div className="draft-controls">
          <label>
            Source conversation
            <select
              aria-label="Source conversation"
              value={draftThread}
              disabled={!!activeDraft || busy}
              onChange={(e) => setDraftThread(e.target.value)}
            >
              <option value="">Choose a conversation</option>
              {view.threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Drafting model
            <select
              aria-label="Drafting model"
              value={draftModel}
              disabled={!!activeDraft || busy}
              onChange={(e) => {
                setDraftModel(e.target.value);
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
            model={boot.models.find((m) => m.id === draftModel)}
            value={effort}
            onChange={setEffort}
            disabled={!!activeDraft || busy}
          />
          <button
            className="button"
            disabled={busy || !!activeDraft || !draftModel || !draftThread}
            onClick={async () => {
              setBusy(true);
              try {
                await saveProposal();
                const chat = await api<ThreadView>("threads/" + draftThread);
                await api<DraftSummary>("draft", {
                  threadId: draftThread,
                  modelId: draftModel,
                  effort,
                  kind: "brief",
                  messageIds: chat.messages
                    .filter((m) => !["queued", "streaming"].includes(m.status))
                    .map((m) => m.id),
                });
                setEditor(false);
                await reload();
                notify(
                  "Drafting in the background. Your proposed brief will appear here for review.",
                );
              } catch (e) {
                notify(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <Busy />
            ) : (
              <>
                <Sparkles size={14} />
                Draft proposed brief
              </>
            )}
          </button>
        </div>
        {activeDraft && (
          <p className="muted">
            A draft is running. Close this window to see its progress; the
            proposal will be saved for review.
          </p>
        )}
        <p className="muted small">
          {evidence.length
            ? `Based on ${evidence.length} conversation messages. `
            : ""}
          {saveStatus}
        </p>
        <div className="brief-comparison">
          <div>
            <span className="eyebrow">Currently approved</span>
            <Markdown>
              {view.brief?.content || "No approved brief yet."}
            </Markdown>
          </div>
          <div>
            <label>
              Proposed revision
              <textarea
                rows={18}
                value={content}
                disabled={!!activeDraft}
                onChange={(e) => {
                  setContent(e.target.value);
                  if (editRef.current) {
                    editRef.current.text = e.target.value;
                    editRef.current.dirty = true;
                  }
                  void saveProposal().catch((e) => notify(String(e)));
                }}
              />
            </label>
          </div>
        </div>
        <div className="modal-actions">
          <button
            className="button"
            onClick={() => {
              void saveProposal()
                .then(() => {
                  setEditor(false);
                  void reload();
                })
                .catch((e) => notify(String(e)));
            }}
          >
            Close
          </button>
          <button
            className="button primary"
            disabled={!content.trim() || busy || !!activeDraft}
            onClick={async () => {
              try {
                await saveProposal();
                await api("briefs", {
                  projectId: project.id,
                  content,
                  previousId: editRef.current?.previousId || null,
                  evidence,
                  accept: true,
                  proposalId: editRef.current?.record?.id || proposalId,
                });
                await reload();
                setEditor(false);
                notify("Project brief updated.");
              } catch (e) {
                notify(String(e));
              }
            }}
          >
            <Check size={15} />
            Accept revision
          </button>
        </div>
      </Modal>
      <Modal
        open={history}
        onClose={() => setHistory(false)}
        title="Brief history"
        description="Earlier decisions remain available."
      >
        {view.revisions
          .filter((b) => b.status === "accepted")
          .map((b) => (
            <details className="history-entry" key={b.id}>
              <summary>
                {formatDate(b.createdAt, true)}
                {b.id === view.brief?.id ? " · current" : ""}
              </summary>
              <Markdown>{b.content}</Markdown>
            </details>
          ))}
      </Modal>
      <ImportDialog
        open={importing}
        close={() => setImporting(false)}
        projectId={project.id}
      />
    </div>
  );
}
