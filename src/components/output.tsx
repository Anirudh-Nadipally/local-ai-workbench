"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, ArrowLeft } from "lucide-react";
import type { Output, ThreadView } from "@/domain/types";
import { api, Markdown, formatDate } from "./ui";
import { useWorkspace } from "./shell";
import { ExportDialog } from "./export-dialog";
export function OutputPage({ initial }: { initial: Output }) {
  const [content, setContent] = useState(initial.content),
    [title, setTitle] = useState(initial.title),
    [editing, setEditing] = useState(false),
    [exportView, setExportView] = useState<ThreadView | null>(null);
  const { notify } = useWorkspace(),
    router = useRouter();
  return (
    <div className="output-page">
      <header className="page-top">
        <Link className="text-link" href={"/chat/" + initial.threadId}>
          <ArrowLeft size={15} />
          Source conversation
        </Link>
        <div className="header-actions">
          <button className="button" onClick={() => setEditing(!editing)}>
            {editing ? "Preview" : "Edit output"}
          </button>
          <button
            className="button"
            onClick={async () => {
              try {
                setExportView(
                  await api<ThreadView>("threads/" + initial.threadId),
                );
              } catch (e) {
                notify(String(e));
              }
            }}
          >
            <ArrowUpRight size={15} />
            Export
          </button>
        </div>
      </header>
      <span className="eyebrow">
        Saved output · {formatDate(initial.createdAt)}
      </span>
      {editing ? (
        <>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <textarea
            className="output-editor mono"
            rows={25}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="modal-actions">
            <button
              className="button primary"
              onClick={async () => {
                try {
                  const next = await api<Output>("outputs", {
                    threadId: initial.threadId,
                    title,
                    content,
                    evidence: initial.evidence,
                    previousId: initial.id,
                  });
                  router.push("/outputs/" + next.id);
                  notify("Saved a new revision.");
                } catch (e) {
                  notify(String(e));
                }
              }}
            >
              <Check size={15} />
              Save revision
            </button>
          </div>
        </>
      ) : (
        <article className="output-document">
          <h1>{title}</h1>
          <Markdown>{content}</Markdown>
        </article>
      )}
      {initial.previousId && (
        <Link className="text-link" href={"/outputs/" + initial.previousId}>
          View previous revision
        </Link>
      )}
      {exportView && (
        <ExportDialog
          view={exportView}
          initialContent={content}
          close={() => setExportView(null)}
        />
      )}
    </div>
  );
}
