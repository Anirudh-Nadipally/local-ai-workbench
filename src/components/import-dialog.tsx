"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, ArrowRight } from "lucide-react";
import { Modal, api, Busy } from "./ui";
import { useWorkspace } from "./shell";
import type { ImportMessage } from "@/domain/import";
import type { Thread } from "@/domain/types";
export function ImportDialog({
  open,
  close,
  projectId = null,
}: {
  open: boolean;
  close: () => void;
  projectId?: string | null;
}) {
  const [raw, setRaw] = useState(""),
    [title, setTitle] = useState("Imported conversation"),
    [preview, setPreview] = useState<{
      messages: ImportMessage[];
      ambiguous: boolean;
      preamble: string;
    } | null>(null),
    [asSource, setAsSource] = useState(false),
    [busy, setBusy] = useState(false);
  const { refresh, notify } = useWorkspace(),
    router = useRouter();
  return (
    <Modal
      open={open}
      onClose={close}
      title="Pick up a conversation"
      description="Bring a text or Markdown export from any AI chat. The original stays intact."
      wide
    >
      <div className="import-tools">
        <label className="button">
          <Upload size={16} />
          Choose text file
          <input
            type="file"
            accept=".txt,.md,.markdown"
            className="visually-hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setRaw(await f.text());
                setTitle(f.name.replace(/\.[^.]+$/, ""));
                setPreview(null);
              }
            }}
          />
        </label>
        <span className="muted">or paste below</span>
      </div>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {!preview ? (
        <textarea
          className="import-text mono"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={12}
          placeholder={
            "## User\nWhat should we build?\n\n## Assistant\nHere is where we left off…"
          }
        />
      ) : (
        <div className="import-preview">
          <p className="note">
            {preview.messages.length} messages recognized.{" "}
            {preview.ambiguous
              ? "Speaker boundaries are unclear. Import as a source, or correct the roles below."
              : "Review roles and content before importing."}
          </p>
          {preview.preamble && (
            <details>
              <summary>
                Text before the first message (preserved in original)
              </summary>
              <pre>{preview.preamble}</pre>
            </details>
          )}
          <label className="check-line">
            <input
              type="checkbox"
              checked={asSource}
              onChange={(e) => setAsSource(e.target.checked)}
            />
            Keep this as a reference document instead
          </label>
          {!asSource &&
            preview.messages.map((m, i) => (
              <div key={i} className="import-message">
                <select
                  aria-label={"Role for message " + (i + 1)}
                  value={m.role}
                  onChange={(e) =>
                    setPreview({
                      ...preview,
                      messages: preview.messages.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              role: e.target.value as ImportMessage["role"],
                            }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="user">User</option>
                  <option value="assistant">Assistant</option>
                  <option value="system">Historical system</option>
                </select>
                <textarea
                  aria-label={"Message " + (i + 1)}
                  value={m.content}
                  rows={4}
                  onChange={(e) =>
                    setPreview({
                      ...preview,
                      messages: preview.messages.map((x, j) =>
                        j === i ? { ...x, content: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
            ))}
        </div>
      )}
      <div className="modal-actions">
        {preview && (
          <button className="button" onClick={() => setPreview(null)}>
            Back to original
          </button>
        )}
        <button
          className="button primary"
          disabled={busy || !raw.trim() || !title.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              if (!preview) {
                const p = await api<{
                  messages: ImportMessage[];
                  ambiguous: boolean;
                  preamble: string;
                }>("imports/preview", { text: raw });
                setPreview(p);
                setAsSource(p.ambiguous);
              } else {
                if (!asSource && !preview.messages.length)
                  throw new Error(
                    "Use reference import for text without speaker boundaries.",
                  );
                const t = await api<Thread>("imports/commit", {
                  original: raw,
                  title,
                  projectId,
                  asSource,
                  messages: preview.messages,
                });
                await refresh();
                close();
                router.push("/chat/" + t.id);
              }
            } catch (error) {
              notify(String(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <Busy />
          ) : preview ? (
            "Import conversation"
          ) : (
            <>
              Review import
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}
