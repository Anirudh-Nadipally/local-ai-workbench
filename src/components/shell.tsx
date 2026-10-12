"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  Plus,
  Search,
  Folder,
  Settings,
  PanelLeft,
  Sun,
  Moon,
  Monitor,
  MessageSquare,
  MessageCircleDashed,
  Command,
  Trash2,
  X,
} from "lucide-react";
import { ThemeProvider, useTheme } from "next-themes";
import type { Boot, Thread, Project } from "@/domain/types";
import { api, Modal } from "./ui";
const subscribeMobile = (callback: () => void) => {
  const media = window.matchMedia("(max-width:700px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
const getMobile = () => window.matchMedia("(max-width:700px)").matches;
const WorkspaceContext = createContext<{
  boot: Boot;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}>({ boot: null!, refresh: async () => {}, notify: () => {} });
export const useWorkspace = () => useContext(WorkspaceContext);
export function Shell({
  initial,
  children,
}: {
  initial: Boot;
  children: ReactNode;
}) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <ShellInner initial={initial}>{children}</ShellInner>
    </ThemeProvider>
  );
}
function ShellInner({
  initial,
  children,
}: {
  initial: Boot;
  children: ReactNode;
}) {
  const [boot, setBoot] = useState(initial),
    [notice, setNotice] = useState(""),
    [menu, setMenu] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [projectOpen, setProjectOpen] = useState(false);
  const pathname = usePathname(),
    router = useRouter();
  const { setTheme } = useTheme();
  const refresh = useCallback(async () => setBoot(await api<Boot>("boot")), []);
  const notify = useCallback((message: string) => setNotice(message), []);
  const mobile = useSyncExternalStore(subscribeMobile, getMobile, () => false);
  useEffect(() => {
    if (!mobile || !menu) return;
    const nav = document.querySelector<HTMLElement>(".sidebar");
    nav?.querySelector<HTMLButtonElement>(".mobile-close")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(false);
        document.querySelector<HTMLButtonElement>(".mobile-menu")?.focus();
      }
      if (event.key === "Tab" && nav) {
        const items = [
          ...nav.querySelectorAll<HTMLElement>(
            "a[href],button:not([disabled])",
          ),
        ].filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobile, menu]);
  async function newChat(temporary = false) {
    try {
      const t = await api<Thread>("threads", { temporary });
      await refresh();
      router.push("/chat/" + t.id);
      setMenu(false);
    } catch (e) {
      notify(String(e));
    }
  }
  return (
    <WorkspaceContext.Provider value={{ boot, refresh, notify }}>
      <div className="app-frame">
        <button
          className="mobile-menu icon-button"
          aria-label="Toggle navigation"
          onClick={() => setMenu(!menu)}
        >
          <PanelLeft size={20} />
        </button>
        {menu && (
          <button
            className="nav-scrim"
            aria-label="Dismiss navigation"
            onClick={() => setMenu(false)}
          />
        )}
        <aside
          aria-label="Workspace navigation"
          inert={mobile && !menu}
          className={"sidebar " + (menu ? "sidebar-open" : "")}
        >
          <button
            className="mobile-close icon-button"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          >
            <X size={18} />
          </button>
          <Link href="/" className="brand" onClick={() => setMenu(false)}>
            <span className="brand-symbol">
              w<span>•</span>
            </span>
            workbench<span className="brand-local">LOCAL</span>
          </Link>
          <button
            className="new-chat"
            onClick={() => {
              void newChat();
            }}
          >
            <Plus size={17} />
            New conversation<span className="keycap">＋</span>
          </button>
          <button
            className="temporary-chat-button"
            onClick={() => {
              void newChat(true);
            }}
          >
            <MessageCircleDashed size={17} /> Temporary chat
          </button>
          <nav className="primary-nav">
            <Link
              href="/"
              className={pathname === "/" ? "active" : ""}
              onClick={() => setMenu(false)}
            >
              <Command size={16} />
              Your workspace
            </Link>
            <button
              onClick={() => {
                setMenu(false);
                setSearchOpen(true);
              }}
            >
              <Search size={16} />
              Search everything
            </button>
          </nav>
          <div className="sidebar-scroll">
            {boot.temporaryThreads.length > 0 && (
              <div className="temporary-nav">
                <div className="sidebar-section">
                  <span>Temporary sessions</span>
                </div>
                {boot.temporaryThreads.map((t, index) => (
                  <Link
                    key={t.id}
                    href={"/chat/" + t.id}
                    onClick={() => setMenu(false)}
                    className={pathname === "/chat/" + t.id ? "active" : ""}
                  >
                    <MessageCircleDashed size={14} />
                    <span>
                      Temporary chat
                      {boot.temporaryThreads.length > 1 ? ` ${index + 1}` : ""}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            <div className="sidebar-section">
              <span>Projects</span>
              <button
                className="icon-button"
                aria-label="Create project"
                onClick={() => {
                  setMenu(false);
                  setProjectOpen(true);
                }}
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="project-nav">
              {boot.projects.map((p) => (
                <Link
                  key={p.id}
                  href={"/projects/" + p.id}
                  onClick={() => setMenu(false)}
                  className={pathname === "/projects/" + p.id ? "active" : ""}
                >
                  <Folder size={15} />
                  <span>{p.name}</span>
                </Link>
              ))}
              {!boot.projects.length && (
                <p className="sidebar-hint">
                  A little structure for ongoing work.
                </p>
              )}
            </div>
            <div className="sidebar-section">
              <span>Recent conversations</span>
            </div>
            <div className="recent-nav">
              {boot.threads.slice(0, 12).map((t) => (
                <Link
                  key={t.id}
                  title={t.title}
                  href={"/chat/" + t.id}
                  onClick={() => setMenu(false)}
                  className={pathname === "/chat/" + t.id ? "active" : ""}
                >
                  <MessageSquare size={14} />
                  <span>{t.title}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="sidebar-footer">
            <Link
              href="/settings"
              className="settings-link"
              onClick={() => setMenu(false)}
            >
              <Settings size={16} />
              <span>Settings</span>
              <span
                className={"status-dot " + (boot.configured ? "online" : "")}
              />
            </Link>
            <div className="sidebar-bottom">
              <span>
                On your Mac <ArrowUpRight size={11} />
              </span>
              <div className="theme-buttons">
                <button
                  aria-label="Light theme"
                  onClick={() => setTheme("light")}
                >
                  <Sun size={14} />
                </button>
                <button
                  aria-label="Dark theme"
                  onClick={() => setTheme("dark")}
                >
                  <Moon size={14} />
                </button>
                <button
                  aria-label="System theme"
                  onClick={() => setTheme("system")}
                >
                  <Monitor size={14} />
                </button>
              </div>
            </div>
          </div>
        </aside>
        <main inert={mobile && menu} className="main-content" key={pathname}>
          {children}
        </main>
        {notice && (
          <div className="toast" role="status">
            <span>{notice}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
      </div>
      <SearchDialog open={searchOpen} close={() => setSearchOpen(false)} />
      <ProjectDialog open={projectOpen} close={() => setProjectOpen(false)} />
    </WorkspaceContext.Provider>
  );
}
function ProjectDialog({ open, close }: { open: boolean; close: () => void }) {
  const { refresh, notify } = useWorkspace(),
    router = useRouter();
  return (
    <Modal
      open={open}
      onClose={close}
      title="A place for ongoing work"
      description="Give related conversations, sources, and decisions a home."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          try {
            const p = await api<Project>("projects", {
              name: form.get("name"),
              objective: form.get("objective"),
            });
            await refresh();
            close();
            router.push("/projects/" + p.id);
          } catch (error) {
            notify(String(error));
          }
        }}
      >
        <label>
          Project name
          <input
            name="name"
            required
            autoFocus
            placeholder="e.g. Website launch"
            maxLength={120}
          />
        </label>
        <label>
          What are you working toward?
          <textarea
            name="objective"
            rows={3}
            placeholder="A sentence is enough to start."
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button className="button primary">Create project</button>
        </div>
      </form>
    </Modal>
  );
}
function SearchDialog({ open, close }: { open: boolean; close: () => void }) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<
      {
        id: string;
        kind: string;
        snippet: string;
        threadId?: string;
        projectId?: string;
      }[]
    >([]);
  const { notify } = useWorkspace();
  return (
    <Modal
      open={open}
      onClose={close}
      title="Find something useful"
      description="Search conversations, documents, projects, and saved outputs."
    >
      <form
        className="search-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setResults(await api("search?q=" + encodeURIComponent(query)));
          } catch (error) {
            notify(String(error));
          }
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your workspace…"
        />
        <button className="button primary">Search</button>
      </form>
      <div className="search-results">
        {results.map((hit) => (
          <Link
            key={hit.kind + hit.id}
            onClick={close}
            href={
              hit.kind === "project"
                ? "/projects/" + hit.id
                : hit.kind === "output"
                  ? "/outputs/" + hit.id
                  : hit.kind === "thread"
                    ? "/chat/" + hit.id
                    : hit.threadId
                      ? "/chat/" + hit.threadId
                      : hit.projectId
                        ? "/projects/" + hit.projectId
                        : "/"
            }
          >
            <span className="eyebrow">{hit.kind}</span>
            <p>{hit.snippet.slice(0, 230)}</p>
          </Link>
        ))}
      </div>
      <Link className="text-link" href="/settings#data" onClick={close}>
        <Trash2 size={14} />
        Looking for a deleted conversation? Open Trash.
      </Link>
    </Modal>
  );
}
