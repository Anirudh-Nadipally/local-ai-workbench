"use client";
import { useState, useEffect } from "react";
import {
  Check,
  Plus,
  ArrowRight,
  Database,
  Download,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { ReasoningSettings } from "./reasoning-settings";
import { api, Busy, Modal } from "./ui";
import { useWorkspace } from "./shell";
import type { Thread } from "@/domain/types";
type Migration = {
  available: boolean;
  hasConnection: boolean;
  threads: { id: string; title: string; imported: boolean }[];
  error?: string;
};
export function SettingsPage() {
  const { boot, refresh, notify } = useWorkspace(),
    [endpoint, setEndpoint] = useState(boot.endpoint),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(""),
    [migration, setMigration] = useState<Migration | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [trash, setTrash] = useState<Thread[]>([]),
    [confirmTransfer, setConfirmTransfer] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([api<Migration>("migration"), api<Thread[]>("trash")])
      .then(([m, t]) => {
        if (alive) {
          setMigration(m);
          setTrash(t);
        }
      })
      .catch((e) => notify(String(e)));
    return () => {
      alive = false;
    };
  }, [notify]);
  async function perform(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    try {
      await action();
      await refresh();
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="settings-page">
      <header className="page-top">
        <span className="eyebrow">Settings</span>
        <span className="local-label">
          <ShieldCheck size={14} />
          Local workspace
        </span>
      </header>
      <h1>Make yourself at home.</h1>
      <p className="page-description">
        Connect your models. Keep control of your work.
      </p>
      <section className="settings-section">
        <div className="settings-section-title">
          <h2>Model connection</h2>
          <p>
            Connect your Azure OpenAI or Foundry project endpoint. Credentials
            stay on this Mac.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform("connection", async () => {
              await api("connection", { endpoint, key });
              setKey("");
              notify("Connection saved. Add or test your deployments below.");
            });
          }}
        >
          <label>
            Azure endpoint
            <input
              type="url"
              required
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://your-resource.openai.azure.com"
              autoComplete="off"
            />
          </label>
          <label>
            API key
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                boot.configured
                  ? "Stored securely · leave blank to keep"
                  : "Paste your API key"
              }
              autoComplete="new-password"
            />
          </label>
          <div className="form-actions">
            <button className="button primary" disabled={!!busy}>
              {busy === "connection" ? <Busy /> : "Save connection"}
            </button>
            {migration?.hasConnection && (
              <button
                type="button"
                className="button"
                onClick={() => setConfirmTransfer(true)}
              >
                Use previous workbench connection
              </button>
            )}
          </div>
        </form>
      </section>
      <section className="settings-section">
        <div className="settings-section-title">
          <h2 id="reasoning">Your deployments</h2>
          <p>
            Choose the exact deployment and protocol. Test image and PDF support
            separately.
          </p>
        </div>
        <div className="model-list">
          {boot.models.map((m) => (
            <div className="model-entry" key={m.id}>
              <div className="model-row">
                <div>
                  <strong>{m.name}</strong>
                  <span>
                    {m.protocol} ·{" "}
                    {m.verifiedAt ? "Text verified" : "Not tested"}
                    {m.image ? " · Images" : ""}
                    {m.pdf ? " · PDFs" : ""}
                  </span>
                </div>
                <div>
                  <button
                    className="button"
                    disabled={!!busy}
                    onClick={() =>
                      perform(m.id, async () => {
                        await api("models/" + m.id + "/probe", {});
                        notify(m.name + " text connection verified.");
                      })
                    }
                  >
                    {busy === m.id ? (
                      <Busy />
                    ) : m.verifiedAt ? (
                      <>
                        <Check size={14} />
                        Retest
                      </>
                    ) : (
                      "Test text"
                    )}
                  </button>
                  <button
                    className="button subtle"
                    disabled={!!busy || !m.verifiedAt}
                    onClick={() =>
                      perform(m.id + "image", async () => {
                        await api("models/" + m.id + "/image", {});
                        notify("Image input verified.");
                      })
                    }
                  >
                    {busy === m.id + "image" ? <Busy /> : "Test image"}
                  </button>
                  <button
                    className="button subtle"
                    disabled={!!busy || !m.verifiedAt}
                    onClick={() =>
                      perform(m.id + "pdf", async () => {
                        await api("models/" + m.id + "/pdf", {});
                        notify("PDF input verified.");
                      })
                    }
                  >
                    {busy === m.id + "pdf" ? <Busy /> : "Test PDF"}
                  </button>
                </div>
              </div>
              <ReasoningSettings model={m} />
            </div>
          ))}
        </div>
        <form
          className="add-model-form"
          onSubmit={(e) => {
            e.preventDefault();
            const element = e.currentTarget,
              form = new FormData(element);
            void perform("model", async () => {
              await api("models", {
                name: form.get("name"),
                protocol: form.get("protocol"),
                contextTokens: Number(form.get("contextTokens")),
              });
              element.reset();
            });
          }}
        >
          <label>
            Deployment name
            <input name="name" required placeholder="Your deployment name" />
          </label>
          <label>
            Protocol
            <select name="protocol">
              <option value="responses">Responses</option>
              <option value="chat">Chat Completions</option>
              <option value="deepseek">DeepSeek</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label>
            Context tokens
            <input
              name="contextTokens"
              type="number"
              min={16000}
              max={2000000}
              defaultValue={128000}
            />
          </label>
          <button className="button" disabled={!!busy}>
            <Plus size={15} />
            Add
          </button>
        </form>
      </section>
      <section className="settings-section" id="data">
        <div className="settings-section-title">
          <h2>Bring useful work forward</h2>
          <p>
            Select only the conversations you want from the previous workbench.
            Originals remain there. Imported memory starts as a proposal.
          </p>
        </div>
        {migration?.available ? (
          <>
            <div className="migration-list">
              {migration.threads.map((t) => (
                <label className="check-line" key={t.id}>
                  <input
                    type="checkbox"
                    disabled={t.imported}
                    checked={t.imported || selected.includes(t.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, t.id]
                          : selected.filter((id) => id !== t.id),
                      )
                    }
                  />
                  <span>{t.title}</span>
                  {t.imported && <small>Imported</small>}
                </label>
              ))}
            </div>
            <button
              className="button"
              disabled={!!busy || !selected.length}
              onClick={() =>
                perform("migration", async () => {
                  const report = await api<{
                    imported: string[];
                    warnings: string[];
                  }>("migration/commit", { ids: selected });
                  setMigration(await api<Migration>("migration"));
                  setSelected([]);
                  notify(
                    `${report.imported.length} conversations imported.${report.warnings.length ? " " + report.warnings.join(" ") : ""}`,
                  );
                })
              }
            >
              {busy === "migration" ? (
                <Busy />
              ) : (
                <>
                  <ArrowRight size={15} />
                  Import {selected.length || "selected"} conversations
                </>
              )}
            </button>
          </>
        ) : (
          <p className="muted">
            {migration?.error || "Checking the previous workspace…"}
          </p>
        )}
      </section>
      <section className="settings-section">
        <div className="settings-section-title">
          <h2>Backup and restore</h2>
          <p>
            Backups include your workspace and original files. Connection
            credentials are excluded. Restore requires an empty workspace.
          </p>
        </div>
        <div className="form-actions">
          <a className="button" href="/api/backup" download>
            <Download size={16} />
            Download backup
          </a>
          <label className="button">
            <Database size={16} />
            Restore backup
            <input
              className="visually-hidden"
              type="file"
              accept=".zip"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void perform("restore", async () => {
                  const form = new FormData();
                  form.set("file", file);
                  const response = await fetch("/api/restore", {
                    method: "POST",
                    body: form,
                  });
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error);
                  notify("Backup restored.");
                });
              }}
            />
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-title">
          <h2>Trash</h2>
          <p>Deleted conversations stay recoverable.</p>
        </div>
        {trash.length ? (
          trash.map((t) => (
            <div className="trash-row" key={t.id}>
              <span>{t.title}</span>
              <button
                className="button"
                onClick={() =>
                  perform(t.id, async () => {
                    await api("threads/" + t.id, { deletedAt: null }, "PATCH");
                    setTrash(await api<Thread[]>("trash"));
                    notify("Conversation restored.");
                  })
                }
              >
                Restore
              </button>
            </div>
          ))
        ) : (
          <p className="muted">No conversations in Trash.</p>
        )}
      </section>
      <div className="worker-health">
        <span className={"status-dot " + (boot.workerAlive ? "online" : "")} />
        {boot.workerAlive
          ? "Local worker is ready"
          : "Worker is offline. Start the app using the included launcher."}
        <button
          className="icon-button"
          aria-label="Refresh worker status"
          onClick={refresh}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <Modal
        open={confirmTransfer}
        onClose={() => setConfirmTransfer(false)}
        title="Use your existing connection?"
        description="This copies and re-encrypts the credential locally. It does not import conversations or change the previous app."
      >
        <p>
          Registered deployments will be added for testing. Existing
          capabilities will be checked again.
        </p>
        <div className="modal-actions">
          <button className="button" onClick={() => setConfirmTransfer(false)}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!!busy}
            onClick={() =>
              perform("transfer", async () => {
                await api("migration/connection", {});
                const b = await api<{ endpoint: string }>("boot");
                setEndpoint(b.endpoint);
                setConfirmTransfer(false);
                notify(
                  "Connection transferred. Test a deployment to start chatting.",
                );
              })
            }
          >
            Transfer connection
          </button>
        </div>
      </Modal>
      <Link className="text-link" href="/">
        ← Back to workspace
      </Link>
    </div>
  );
}
