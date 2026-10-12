"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Import,
  MessageSquare,
  MessageCircleDashed,
  FolderOpen,
} from "lucide-react";
import { useWorkspace } from "./shell";
import { api, relativeDate } from "./ui";
import { ImportDialog } from "./import-dialog";
import type { Thread } from "@/domain/types";
export function Home() {
  const { boot, refresh, notify } = useWorkspace(),
    router = useRouter(),
    [importing, setImporting] = useState(false);
  async function create(temporary = false) {
    try {
      const t = await api<Thread>("threads", { temporary });
      await refresh();
      router.push("/chat/" + t.id);
    } catch (e) {
      notify(String(e));
    }
  }
  return (
    <div className="home-page">
      <header className="page-top">
        <span className="eyebrow">Your workspace</span>
        <span className="local-label">
          <span className="status-dot online" />
          Stored on this Mac
        </span>
      </header>
      <section className="home-intro">
        <div className="eyebrow intro-label">
          A little clarity. A useful next step.
        </div>
        <h1>
          Good work
          <br />
          starts with context<span className="accent">.</span>
        </h1>
        <p>
          Bring what matters, think it through, and take your work wherever it
          needs to go.
        </p>
        <div className="home-actions">
          <button
            className="button primary"
            onClick={() => {
              void create();
            }}
          >
            <Plus size={17} />
            New conversation
          </button>
          <button
            className="button"
            onClick={() => {
              void create(true);
            }}
          >
            <MessageCircleDashed size={17} /> Temporary chat
          </button>
          <button className="button" onClick={() => setImporting(true)}>
            <Import size={17} />
            Import a conversation
          </button>
        </div>
      </section>
      {!boot.configured && (
        <Link href="/settings" className="connect-banner">
          <div className="connect-icon">
            <ArrowUpRight size={20} />
          </div>
          <div>
            <strong>Connect your first model</strong>
            <span>
              Your files and conversations stay here. Choose the model you want
              to work with.
            </span>
          </div>
          <ArrowRight size={18} />
        </Link>
      )}
      <section className="recent-section">
        <div className="section-heading">
          <h2>Pick up where you left off</h2>
          <span>{boot.threads.length} conversations</span>
        </div>
        {boot.threads.length ? (
          <div className="conversation-list">
            {boot.threads.slice(0, 8).map((t) => (
              <Link href={"/chat/" + t.id} key={t.id}>
                <div className="row-icon">
                  <MessageSquare size={18} />
                </div>
                <div>
                  <strong>{t.title}</strong>
                  <span>
                    {boot.projects.find((p) => p.id === t.projectId)?.name ||
                      "Quick conversation"}
                  </span>
                </div>
                <time>{relativeDate(t.updatedAt)}</time>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="start-empty">
            <MessageSquare size={24} />
            <h3>Your next conversation belongs here.</h3>
            <p>
              Start fresh, or bring a chat you have already put thought into.
            </p>
          </div>
        )}
      </section>
      {boot.projects.length > 0 && (
        <section className="home-projects">
          <div className="section-heading">
            <h2>Ongoing work</h2>
            <span>Context that carries forward</span>
          </div>
          {boot.projects.map((p) => (
            <Link key={p.id} href={"/projects/" + p.id}>
              <FolderOpen size={20} />
              <div>
                <strong>{p.name}</strong>
                <p>{p.objective || "Open project"}</p>
              </div>
              <ArrowRight size={17} />
            </Link>
          ))}
        </section>
      )}
      <footer className="home-footer">
        <span className="brand-symbol mini">
          w<span>•</span>
        </span>
        <span>Your thinking, with room to continue.</span>
      </footer>
      <ImportDialog open={importing} close={() => setImporting(false)} />
    </div>
  );
}
