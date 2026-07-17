"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { DefaultChatTransport, type SourceDocumentUIPart, type SourceUrlUIPart, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import {
  Brain, Check, ChevronDown, CircleAlert, Copy, FileText, Folder, Layers3,
  Loader2, Menu, MessageSquareText, PanelRight, Paperclip, Plus, RotateCcw,
  Search, Settings, ShieldCheck, Square, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { SetupScreen } from "@/components/setup-screen";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInputSubmit } from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DeploymentRecord, FileRecord, MemoryCandidateRecord, MemoryRecord, MessageRecord, ProjectRecord, SafeConfig, SynthesisRunRecord, ThreadRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

type BootstrapData = {
  config: SafeConfig;
  projects: ProjectRecord[];
  threads: ThreadRecord[];
  deployments: DeploymentRecord[];
  files: FileRecord[];
  modelRouting?: { adjustments?: Array<{ role: string; requestedDeployment: string; deployment: string; reason: string }>; error?: string };
};
type ThreadData = {
  thread: ThreadRecord; messages: MessageRecord[]; memories: MemoryRecord[]; candidates: MemoryCandidateRecord[];
  receipt: Record<string, unknown> | null; runs: Array<SynthesisRunRecord & { steps: Array<Record<string, unknown>> }>;
};

export function Workbench() {
  const [boot, setBoot] = useState<BootstrapData | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeThreadId, setActiveThreadId] = useState("");
  const [threadData, setThreadData] = useState<ThreadData | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [composer, setComposer] = useState("");
  const [mode, setMode] = useState<"chat" | "synthesis">("chat");
  const [contextOpen, setContextOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const [jobBusy, setJobBusy] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittedDraftRef = useRef("");
  const previousStatusRef = useRef<"submitted" | "streaming" | "ready" | "error">("ready");

  const activeProject = boot?.projects.find((project) => project.id === activeProjectId) ?? boot?.projects[0];
  const activeThread = boot?.threads.find((thread) => thread.id === activeThreadId) ?? threadData?.thread;
  const deployment = activeThread?.deploymentId || boot?.config.chatDeployment || boot?.deployments.find((item) => item.enabled)?.name || "";

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setBootstrapError(null);
    try {
      let data = await requestJson<BootstrapData>("/api/bootstrap");
      const projectId = activeProjectId || data.config.defaultProjectId || data.projects[0]?.id;
      if (data.config.configured && projectId && !data.threads.some((thread) => thread.projectId === projectId)) {
        const created = await requestJson<{ thread: ThreadRecord }>("/api/threads", { method: "POST", body: JSON.stringify({ projectId }) });
        data = await requestJson<BootstrapData>("/api/bootstrap");
        setActiveThreadId(created.thread.id);
      }
      setBoot(data);
      setActiveProjectId((current) => current || projectId || "");
      setActiveThreadId((current) => current || data.threads.find((thread) => thread.projectId === projectId)?.id || "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open the workbench.";
      setBootstrapError(message);
      toast.error(message);
    }
    finally { setLoading(false); }
  }, [activeProjectId]);

  const loadThread = useCallback(async (id = activeThreadId, quiet = false) => {
    if (!id) return;
    try {
      const data = await requestJson<ThreadData>(`/api/threads/${id}`);
      setThreadData(data);
      if (!quiet) setMessages(data.messages.map(toUIMessage));
    } catch (error) { if (!quiet) toast.error(error instanceof Error ? error.message : "Could not load the conversation."); }
  // setMessages is stable in AI SDK's chat store.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ id, messages }) => ({
      body: { id, messages, threadId: activeThreadId, projectId: activeProjectId, deployment, fileIds: selectedFileIds, reasoningEffort: boot?.config.reasoningEffort ?? "medium" },
    }),
  }), [activeProjectId, activeThreadId, boot?.config.reasoningEffort, deployment, selectedFileIds]);

  const { messages, setMessages, sendMessage, regenerate, stop, status, error } = useChat({ id: activeThreadId || "local-draft", transport });
  const streaming = status === "submitted" || status === "streaming";
  const latestMessage = messages.at(-1);
  const latestAssistantHasText = latestMessage?.role === "assistant" && latestMessage.parts.some((part) =>
    part.type === "text" && part.text.trim().length > 0
  );
  const latestAssistantReasoningActive = latestMessage?.role === "assistant" && latestMessage.parts.some((part) =>
    part.type === "reasoning" && (part.state === "streaming" || (part.state === undefined && status === "streaming" && part.text.trim().length > 0))
  );
  const showAssistantActivity = status === "submitted" || latestAssistantReasoningActive || (status === "streaming" && !latestAssistantHasText);
  const assistantActivity = status === "submitted" ? `Connecting to ${deployment}…` : latestAssistantReasoningActive ? "Reasoning…" : "Thinking…";

  useEffect(() => { void loadBootstrap(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeThreadId) void loadThread(activeThreadId); }, [activeThreadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1536px)");
    const update = () => setIsWide(query.matches); update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 92), 220)}px`;
  }, [composer]);
  useEffect(() => {
    if (isWide && selectedFileIds.length > 0) setContextOpen(true);
  }, [isWide, selectedFileIds.length]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((open) => !open); } };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => { if (status === "ready" && activeThreadId) { void loadThread(activeThreadId, true); void refreshLists(); } }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    if (status === "submitted") setLiveAnnouncement(`Connecting to ${deployment}.`);
    else if (status === "streaming") setLiveAnnouncement("The assistant is responding.");
    else if (status === "error") setLiveAnnouncement("The response failed. Your message is ready to retry.");
    else if (previousStatus === "submitted" || previousStatus === "streaming") {
      setLiveAnnouncement("Response complete.");
      submittedDraftRef.current = "";
    }
    previousStatusRef.current = status;
  }, [deployment, status]);
  useEffect(() => {
    if (status === "error" && !composer.trim() && submittedDraftRef.current) {
      setComposer(submittedDraftRef.current);
    }
  }, [composer, status]);
  useEffect(() => {
    if (!boot?.files.some((file) => file.status === "queued" || file.status === "extracting")) return;
    const timer = window.setInterval(() => void refreshLists(), 1500); return () => window.clearInterval(timer);
  }, [boot?.files]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const activeRun = threadData?.runs.some((run) => run.status === "queued" || run.status === "running");
    if (!activeRun || !activeThreadId) return;
    const timer = window.setInterval(() => void loadThread(activeThreadId, true), 1200); return () => window.clearInterval(timer);
  }, [activeThreadId, threadData?.runs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshLists() {
    if (!activeProjectId) return;
    try {
      const [threads, files] = await Promise.all([
        requestJson<{ threads: ThreadRecord[] }>(`/api/threads?projectId=${encodeURIComponent(activeProjectId)}`),
        requestJson<{ files: FileRecord[] }>(`/api/files?projectId=${encodeURIComponent(activeProjectId)}`),
      ]);
      setBoot((current) => current ? { ...current, threads: threads.threads, files: files.files } : current);
    } catch { /* Background refresh stays quiet. */ }
  }

  async function createConversation() {
    if (!activeProjectId) return;
    try {
      const { thread } = await requestJson<{ thread: ThreadRecord }>("/api/threads", { method: "POST", body: JSON.stringify({ projectId: activeProjectId, deploymentId: deployment }) });
      setBoot((current) => current ? { ...current, threads: [thread, ...current.threads] } : current);
      setActiveThreadId(thread.id); setMessages([]); setThreadData(null); setMobileSidebarOpen(false); textareaRef.current?.focus();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create a conversation."); }
  }

  async function deleteConversation(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!confirm("Are you sure you want to delete this conversation? This action cannot be undone.")) return;
    try {
      const response = await fetch(`/api/threads/${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to delete conversation");
      
      const remaining = boot?.threads.filter((t) => t.id !== id && t.projectId === activeProjectId) || [];
      if (activeThreadId === id) {
        if (remaining.length > 0) {
          setActiveThreadId(remaining[0].id);
        } else {
          const { thread } = await requestJson<{ thread: ThreadRecord }>("/api/threads", {
            method: "POST",
            body: JSON.stringify({ projectId: activeProjectId, deploymentId: deployment }),
          });
          setBoot((current) => {
            if (!current) return current;
            const filtered = current.threads.filter((t) => t.id !== id);
            return { ...current, threads: [thread, ...filtered] };
          });
          setActiveThreadId(thread.id); setMessages([]); setThreadData(null);
          toast.success("Conversation deleted");
          return;
        }
      }
      
      setBoot((current) => {
        if (!current) return current;
        return { ...current, threads: current.threads.filter((t) => t.id !== id) };
      });
      toast.success("Conversation deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the conversation.");
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault(); const text = composer.trim();
    if (!text || streaming || !activeThreadId) return;
    const retryingFailedChat = mode === "chat" && status === "error" && text === submittedDraftRef.current;
    submittedDraftRef.current = text;
    setComposer("");
    if (mode === "chat") {
      try {
        if (retryingFailedChat) await regenerate();
        else await sendMessage({ text });
      } catch (sendError) {
        setComposer(text);
        toast.error(sendError instanceof Error ? sendError.message : "Could not send the message.");
      }
    } else {
      try {
        await requestJson("/api/runs", { method: "POST", body: JSON.stringify({
          projectId: activeProjectId, threadId: activeThreadId, question: text,
          branchDeployment: boot?.config.branchDeployment || deployment,
          criticDeployment: boot?.config.criticDeployment || deployment,
          synthesisDeployment: boot?.config.synthesisDeployment || deployment,
          maxBranches: 4, refinementRounds: 1, fileIds: selectedFileIds,
        }) });
        setContextOpen(true); await loadThread(activeThreadId); toast.success("Bounded synthesis started");
      } catch (runError) { setComposer(text); toast.error(runError instanceof Error ? runError.message : "Could not start synthesis."); }
    }
  }

  async function selectProject(id: string) {
    setActiveProjectId(id); const first = boot?.threads.find((thread) => thread.projectId === id);
    if (first) setActiveThreadId(first.id);
    else {
      try { const { thread } = await requestJson<{ thread: ThreadRecord }>("/api/threads", { method: "POST", body: JSON.stringify({ projectId: id }) }); setBoot((current) => current ? { ...current, threads: [thread, ...current.threads] } : current); setActiveThreadId(thread.id); }
      catch (projectError) { toast.error(projectError instanceof Error ? projectError.message : "Could not open project."); }
    }
  }

  async function updateThreadDeployment(name: string) {
    if (!activeThreadId || name === deployment) return;
    try {
      await requestJson(`/api/threads/${activeThreadId}`, { method: "PATCH", body: JSON.stringify({ deploymentId: name }) });
      setBoot((current) => current ? { ...current, threads: current.threads.map((thread) => thread.id === activeThreadId ? { ...thread, deploymentId: name } : thread) } : current);
      setThreadData((current) => current?.thread.id === activeThreadId ? { ...current, thread: { ...current.thread, deploymentId: name } } : current);
    } catch (deploymentError) {
      toast.error(deploymentError instanceof Error ? deploymentError.message : "Could not switch the chat model.");
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length || !activeProjectId) return;
    const form = new FormData(); form.set("projectId", activeProjectId); form.set("threadId", activeThreadId);
    Array.from(files).forEach((file) => form.append("files", file));
    try { const result = await requestJson<{ files: FileRecord[] }>("/api/files", { method: "POST", body: form }); setSelectedFileIds((current) => [...new Set([...current, ...result.files.map((file) => file.id)])]); await refreshLists(); toast.success(`${result.files.length} file${result.files.length === 1 ? "" : "s"} added`); }
    catch (uploadError) { toast.error(uploadError instanceof Error ? uploadError.message : "Upload failed."); }
  }

  async function curateMemory() {
    if (!activeThreadId || !activeProjectId || jobBusy) return; setJobBusy(true);
    try {
      const { job } = await requestJson<{ job: Record<string, unknown> }>("/api/memory/curate", { method: "POST", body: JSON.stringify({ projectId: activeProjectId, threadId: activeThreadId, deployment: boot?.config.memoryDeployment || deployment }) });
      await waitForJob(String(job.id)); await loadThread(activeThreadId); toast.success("Memory candidates are ready for review"); setContextOpen(true);
    } catch (memoryError) { toast.error(memoryError instanceof Error ? memoryError.message : "Memory curation failed."); }
    finally { setJobBusy(false); }
  }

  async function actOnMemory(action: "accept" | "reject" | "delete", id: string) {
    try { await requestJson("/api/memory", { method: "POST", body: JSON.stringify({ action, id }) }); await loadThread(activeThreadId, true); toast.success(action === "accept" ? "Memory accepted" : action === "reject" ? "Candidate rejected" : "Memory deleted"); }
    catch (memoryError) { toast.error(memoryError instanceof Error ? memoryError.message : "Memory update failed."); }
  }

  if (loading && !boot) return <LoadingScreen />;
  if (!boot) return <FailureScreen retry={loadBootstrap} errorMessage={bootstrapError} />;
  if (!boot.config.configured) return <SetupScreen onComplete={loadBootstrap} />;

  const sidebar = <Sidebar projects={boot.projects} threads={boot.threads.filter((thread) => thread.projectId === activeProjectId)} activeProjectId={activeProjectId} activeThreadId={activeThreadId} onProject={selectProject} onThread={(id) => { setActiveThreadId(id); setMobileSidebarOpen(false); }} onNew={createConversation} onSearch={() => setCommandOpen(true)} onSettings={() => setSettingsOpen(true)} onDelete={deleteConversation} />;
  const context = <ContextPanel files={boot.files} selectedFileIds={selectedFileIds} setSelectedFileIds={setSelectedFileIds} uploadFiles={uploadFiles} threadData={threadData} curateMemory={curateMemory} jobBusy={jobBusy} actOnMemory={actOnMemory} refresh={() => loadThread(activeThreadId, true)} />;
  const proposedMemoryCount = threadData?.candidates.filter((item) => item.status === "proposed").length ?? 0;
  const contextAttentionCount = selectedFileIds.length + proposedMemoryCount;
  const contextBadgeVisible = contextAttentionCount > 0;
  const modeSummary = mode === "chat"
    ? "Standard chat · uses header model and selected sources"
    : "Bounded synthesis · 4 branches · max 7 calls · no tools";

  const settingsKey = [
    boot.config.chatDeployment,
    boot.config.memoryDeployment,
    boot.config.branchDeployment,
    boot.config.mapperDeployment,
    boot.config.alternativeDeployment,
    boot.config.adversarialDeployment,
    boot.config.evidenceDeployment,
    boot.config.criticDeployment,
    boot.config.refinementDeployment,
    boot.config.synthesisDeployment,
  ].join("\u001f");

  return (
    <div className="workbench-shell flex h-dvh w-full overflow-hidden bg-background">
      <aside className="hidden w-[280px] shrink-0 border-r border-sidebar-border/80 bg-sidebar/95 lg:block">{sidebar}</aside>
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}><SheetContent side="left" className="w-[292px] p-0"><SheetHeader className="sr-only"><SheetTitle>Navigation</SheetTitle></SheetHeader>{sidebar}</SheetContent></Sheet>

      <main className="workspace-surface relative flex w-0 min-w-0 flex-1 flex-col">
        <header className="z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border/70 bg-background/72 px-3 backdrop-blur-xl sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation"><Menu /></Button>
          <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-medium tracking-[-0.01em]">{activeThread?.title || "New conversation"}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{activeProject?.name} · private workspace</p></div>
          <ModelSelector deployment={deployment} deployments={boot.deployments} onChange={updateThreadDeployment} disabled={streaming} compact />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={contextOpen ? "secondary" : "ghost"}
                size="icon"
                className="relative"
                onClick={() => setContextOpen((open) => !open)}
                aria-label={contextBadgeVisible ? `Toggle context (${contextAttentionCount} item${contextAttentionCount === 1 ? "" : "s"} need attention)` : "Toggle context"}
              >
                <PanelRight />
                {contextBadgeVisible && (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-[1.125rem] place-items-center rounded-full bg-primary px-1 text-[9px] font-medium leading-none text-primary-foreground">
                    {contextAttentionCount > 9 ? "9+" : contextAttentionCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {contextBadgeVisible
                ? `Context · ${selectedFileIds.length ? `${selectedFileIds.length} file${selectedFileIds.length === 1 ? "" : "s"} selected` : ""}${selectedFileIds.length && proposedMemoryCount ? " · " : ""}${proposedMemoryCount ? `${proposedMemoryCount} memory review${proposedMemoryCount === 1 ? "" : "s"}` : ""}`
                : "Context receipt & files"}
            </TooltipContent>
          </Tooltip>
        </header>

        <Conversation className="min-h-0">
          <ConversationContent className="mx-auto w-full max-w-4xl gap-8 px-4 py-10 sm:px-8 lg:py-12">
            <span className="sr-only" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>
            {!messages.length ? (
              <ConversationEmptyState className="min-h-[58vh]" icon={<div className="brand-mark grid size-11 place-items-center rounded-2xl"><MessageSquareText className="size-5" /></div>} title="Begin with a question" description="Chat with one model, bring in local sources, or ask several models to test an idea together.">
                <div className="max-w-2xl space-y-6 text-center"><p className="font-conversation text-3xl leading-[1.15] tracking-[-0.025em] sm:text-4xl">A clear space for difficult questions.</p><p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground">Your files, accepted memory, and model routing stay inspectable. Nothing is remembered without your approval.</p><div className="flex flex-wrap justify-center gap-2">{["Compare two approaches", "Find the weak assumptions", "Synthesize my source files"].map((text) => <button key={text} onClick={() => { setComposer(text); textareaRef.current?.focus(); }} className="rounded-full border border-border/80 bg-card/80 px-3.5 py-2 text-xs text-muted-foreground shadow-sm transition-[background-color,color,border-color,transform] duration-150 hover:-translate-y-px hover:border-primary/25 hover:bg-accent/70 hover:text-foreground">{text}</button>)}</div></div>
              </ConversationEmptyState>
            ) : messages.map((message) => <ChatMessage key={message.id} message={message} isStreaming={status === "streaming" && message.id === latestMessage?.id} onRegenerate={() => regenerate({ messageId: message.id })} />)}
            {showAssistantActivity && <div className="flex min-h-7 items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" /><span>{assistantActivity}</span></div>}
            {error && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <div className="flex items-start gap-2">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">Response failed</p>
                    <p className="text-xs leading-5 text-destructive/90">{error.message}</p>
                    {chatErrorHint(error.message) && <p className="text-xs leading-5 text-muted-foreground">{chatErrorHint(error.message)}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="xs" variant="outline" onClick={() => void submit()} disabled={streaming || !composer.trim()}>
                    <RotateCcw /> Retry
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setSettingsOpen(true)}>Change model</Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => { void navigator.clipboard.writeText(error.message); toast.success("Error copied"); }}><Copy /> Copy error</Button>
                </div>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="shrink-0 bg-gradient-to-t from-background via-background/96 to-transparent px-3 pb-4 pt-4 sm:px-6 sm:pb-6">
          <form onSubmit={submit} className="composer-shell mx-auto max-w-4xl overflow-hidden rounded-2xl border border-border/80 bg-card/96 shadow-[0_18px_55px_-26px_oklch(0.18_0.03_45/0.48)] backdrop-blur">
            {!!selectedFileIds.length && <div className="flex flex-wrap gap-1.5 border-b px-3 py-2">{selectedFileIds.map((id) => { const file = boot.files.find((item) => item.id === id); return file ? <Badge key={id} variant="secondary" className="gap-1 font-normal"><FileText className="size-3" />{file.originalName}<button type="button" onClick={() => setSelectedFileIds((ids) => ids.filter((value) => value !== id))} aria-label={`Remove ${file.originalName}`}><X className="size-3" /></button></Badge> : null; })}</div>}
            <Textarea ref={textareaRef} value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={mode === "chat" ? "Ask a question or work through an idea…" : "What should the models stress-test and synthesize?"} className="min-h-[92px] max-h-[220px] resize-none overflow-y-auto border-0 bg-transparent px-4 py-4 text-[15px] leading-6 shadow-none transition-[height] duration-150 focus-visible:ring-0 sm:px-5" />
            <div className="flex flex-wrap items-center gap-2 border-t border-border/65 bg-muted/15 px-2.5 py-2.5">
              <label><input type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json,.jsonl" className="sr-only" onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ""; }} /><Button type="button" asChild variant="ghost" size="icon" aria-label="Attach local files"><span><Paperclip /></span></Button></label>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="inline-flex shrink-0 rounded-lg border bg-muted/30 p-0.5" role="group" aria-label="Composer mode">
                  <button
                    type="button"
                    onClick={() => setMode("chat")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[calc(var(--radius-md)-2px)] px-2.5 py-1 text-xs font-medium transition-colors",
                      mode === "chat" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={mode === "chat"}
                  >
                    <MessageSquareText className="size-3.5" />
                    Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("synthesis")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[calc(var(--radius-md)-2px)] px-2.5 py-1 text-xs font-medium transition-colors",
                      mode === "synthesis" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={mode === "synthesis"}
                  >
                    <Layers3 className="size-3.5" />
                    Synthesis
                  </button>
                </div>
                <p className="hidden min-w-0 truncate text-[11px] leading-4 text-muted-foreground sm:block" title={modeSummary}>{modeSummary}</p>
              </div>
              <PromptInputSubmit
                status={status}
                onStop={stop}
                aria-label={streaming ? "Stop generation" : status === "error" ? "Retry message" : "Send message"}
                disabled={!composer.trim() && !streaming}
                className="ml-auto size-9 rounded-xl"
              />
            </div>
          </form>
          <p className="mx-auto mt-2.5 max-w-4xl text-center text-[10px] tracking-[0.02em] text-muted-foreground">Only selected context is sent to Azure · important outputs still deserve verification</p>
        </div>
      </main>

      <aside
        aria-hidden={!contextOpen}
        aria-label="Context"
        className={cn(
          "hidden shrink-0 overflow-hidden bg-background/92 opacity-0 transition-[width,opacity] duration-[175ms] ease-out motion-reduce:transition-none 2xl:block",
          contextOpen ? "w-[376px] border-l border-border/70 opacity-100" : "pointer-events-none w-0 border-l-0"
        )}
        inert={!contextOpen}
      ><div className="h-full w-[376px]">{context}</div></aside>
      {!isWide && <Sheet open={contextOpen} onOpenChange={setContextOpen}><SheetContent side="right" className="w-[min(92vw,380px)] p-0"><SheetHeader className="sr-only"><SheetTitle>Context</SheetTitle></SheetHeader>{context}</SheetContent></Sheet>}

      <CommandPalette open={commandOpen} setOpen={setCommandOpen} boot={boot} onThread={setActiveThreadId} onProject={selectProject} onNew={createConversation} onSettings={() => setSettingsOpen(true)} />
      {settingsOpen && <SettingsDialog key={settingsKey} open={settingsOpen} setOpen={setSettingsOpen} config={boot.config} deployments={boot.deployments} routing={boot.modelRouting} onRefresh={loadBootstrap} />}
    </div>
  );
}

function ModelSelector({
  deployment,
  deployments,
  onChange,
  disabled = false,
  compact = false,
  className,
}: {
  deployment: string;
  deployments: DeploymentRecord[];
  onChange: (name: string) => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const enabledDeployments = deployments.filter((item) => item.enabled);
  const currentDeployment = deployments.find((item) => item.name === deployment);
  const options = currentDeployment && !currentDeployment.enabled && !enabledDeployments.some((item) => item.id === currentDeployment.id)
    ? [currentDeployment, ...enabledDeployments]
    : enabledDeployments;
  const hasRunnableOptions = options.some(canChatWithDeployment);

  return (
    <Select value={deployment || undefined} onValueChange={(value) => void onChange(value)} disabled={disabled || !hasRunnableOptions}>
      <SelectTrigger
        aria-label="Choose chat model"
        className={cn(
          "min-w-0 text-xs",
          compact
            ? "h-8 max-w-[12rem] border-0 bg-transparent px-2 shadow-none sm:max-w-[15rem]"
            : "h-8 max-w-[13rem] bg-background px-2 sm:max-w-[16rem]",
          className,
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", currentDeployment?.enabled ? "bg-emerald-600" : "bg-muted-foreground")} />
        <SelectValue placeholder="No enabled model" />
      </SelectTrigger>
      <SelectContent align={compact ? "end" : "start"} className="w-[min(28rem,calc(100vw-2rem))]">
        {options.map((item) => {
          const runnable = canChatWithDeployment(item);
          return (
          <SelectItem key={item.id} value={item.name} disabled={!runnable} textValue={item.name} className="min-w-0 items-start">
            <div className="min-w-0 max-w-full py-0.5">
              <p className="break-all text-xs font-medium leading-4">
                {item.name}{!item.enabled ? " · disabled" : item.protocol === "auto" ? " · probe required" : ""}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {protocolLabel(item.protocol)}{item.modelName ? ` · ${item.modelName}` : ""}
              </p>
            </div>
          </SelectItem>
        ); })}
        {!options.length && <SelectItem value="__no-enabled-models" disabled>No enabled models</SelectItem>}
      </SelectContent>
    </Select>
  );
}

function canChatWithDeployment(deployment: DeploymentRecord) {
  if (!deployment.enabled || deployment.protocol === "auto") return false;
  return deployment.capabilities.textGeneration !== false && deployment.capabilities.streaming !== false;
}

function ChatMessage({ message, isStreaming, onRegenerate }: { message: UIMessage; isStreaming: boolean; onRegenerate: () => void }) {
  const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  return (
    <Message from={message.role} className="scroll-mt-24">
      <MessageContent className={message.role === "assistant" ? "w-full font-conversation text-[15px] leading-7 sm:text-[16px] sm:leading-[1.8]" : "rounded-2xl rounded-br-md bg-secondary/75 px-4 py-2.5 text-[14px] leading-6 shadow-sm"}>
        {renderMessageParts(message, isStreaming)}
      </MessageContent>
      <MessageActions className={cn("opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100", message.role === "user" && "justify-end")}>
        <MessageAction tooltip="Copy" onClick={() => { void navigator.clipboard.writeText(text); toast.success("Copied"); }}><Copy /></MessageAction>
        {message.role === "assistant" && <MessageAction tooltip="Regenerate" onClick={onRegenerate}><RotateCcw /></MessageAction>}
      </MessageActions>
    </Message>
  );
}

type SourcePart = SourceUrlUIPart | SourceDocumentUIPart;

function renderMessageParts(message: UIMessage, isStreaming: boolean): ReactNode[] {
  const rendered: ReactNode[] = [];

  for (let index = 0; index < message.parts.length; index += 1) {
    const part = message.parts[index];
    const key = `${message.id}-${index}-${part.type}`;

    if (part.type === "text") {
      rendered.push(<MessageResponse isAnimating={isStreaming && part.state !== "done"} key={key}>{part.text}</MessageResponse>);
      continue;
    }

    if (part.type === "reasoning") {
      const reasoningStreaming = part.state === "streaming" || (part.state === undefined && isStreaming);
      rendered.push(
        <Reasoning className="w-full" isStreaming={reasoningStreaming} key={key}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
      continue;
    }

    if (isSourcePart(part)) {
      const sources: SourcePart[] = [part];
      while (index + 1 < message.parts.length && isSourcePart(message.parts[index + 1])) {
        index += 1;
        sources.push(message.parts[index] as SourcePart);
      }
      rendered.push(
        <Sources key={key}>
          <SourcesTrigger count={sources.length} />
          <SourcesContent>
            {sources.map((source) => (
              <Source
                href={source.type === "source-url" ? source.url : undefined}
                key={source.sourceId}
                title={source.title || (source.type === "source-document" ? source.filename : undefined) || "Source"}
              />
            ))}
          </SourcesContent>
        </Sources>
      );
    }
  }

  return rendered;
}

function isSourcePart(part: UIMessage["parts"][number]): part is SourcePart {
  return part.type === "source-url" || part.type === "source-document";
}

function Sidebar({ projects, threads, activeProjectId, activeThreadId, onProject, onThread, onNew, onSearch, onSettings, onDelete }: {
  projects: ProjectRecord[]; threads: ThreadRecord[]; activeProjectId: string; activeThreadId: string;
  onProject: (id: string) => void; onThread: (id: string) => void; onNew: () => void; onSearch: () => void; onSettings: () => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
}) {
  const activeProject = projects.find((project) => project.id === activeProjectId);
  return (
    <div className="flex h-full flex-col p-3.5">
      <div className="mb-3 flex items-center gap-3 px-1.5 py-1">
        <div className="brand-mark grid size-9 shrink-0 place-items-center rounded-xl font-conversation text-base">L</div>
        <div className="min-w-0"><p className="truncate text-sm font-semibold tracking-[-0.015em]">Local AI</p><p className="text-[10px] text-muted-foreground">Private workbench</p></div>
      </div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="mb-2 h-auto w-full justify-between rounded-xl border border-transparent px-2.5 py-2 hover:border-border/70 hover:bg-background/60"><span className="min-w-0 text-left"><span className="block text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Project</span><span className="mt-0.5 block truncate text-sm">{activeProject?.name}</span></span><ChevronDown className="size-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent className="w-60" align="start">{projects.map((project) => <DropdownMenuItem key={project.id} onClick={() => onProject(project.id)}><Folder />{project.name}{project.id === activeProjectId && <Check className="ml-auto" />}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
      <Button onClick={onNew} className="h-10 justify-start rounded-xl shadow-sm"><Plus /> New conversation</Button>
      <Button onClick={onSearch} variant="ghost" className="mt-1.5 h-9 justify-start rounded-xl text-muted-foreground"><Search /> Search <kbd className="ml-auto rounded border border-border/70 bg-background/40 px-1.5 py-0.5 font-mono text-[9px]">⌘K</kbd></Button>
      <div className="mt-6 px-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Recent conversations</div>
      <nav className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5" aria-label="Recent conversations">
        {threads.map((thread) => (
          <div key={thread.id} className="group/row relative flex items-center">
            <button
              onClick={() => onThread(thread.id)}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 pr-8 text-left text-[13px] transition-[background-color,color,transform] duration-150",
                thread.id === activeThreadId ? "bg-accent/75 text-accent-foreground shadow-sm" : "text-muted-foreground hover:translate-x-0.5 hover:bg-muted/75 hover:text-foreground"
              )}
            >
              <MessageSquareText className="size-3.5 shrink-0" />
              <span className="truncate">{thread.title}</span>
            </button>
            <Button
              size="icon-xs"
              variant="ghost"
              className="absolute right-1 size-7 opacity-0 group-hover/row:opacity-100 transition-opacity text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:opacity-100"
              onClick={(event) => onDelete(thread.id, event)}
              aria-label={`Delete ${thread.title}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </nav>
      <Separator className="my-2" />
      <Button onClick={onSettings} variant="ghost" className="justify-start rounded-xl text-muted-foreground"><Settings /> Settings</Button>
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-emerald-700/10 bg-emerald-700/5 px-2.5 py-2 text-[10px] text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-600" /><span>Local only · 127.0.0.1</span><ShieldCheck className="ml-auto size-3" /></div>
    </div>
  );
}

function ContextPanel({ files, selectedFileIds, setSelectedFileIds, uploadFiles, threadData, curateMemory, jobBusy, actOnMemory, refresh }: {
  files: FileRecord[]; selectedFileIds: string[]; setSelectedFileIds: React.Dispatch<React.SetStateAction<string[]>>; uploadFiles: (files: FileList | null) => Promise<void>;
  threadData: ThreadData | null; curateMemory: () => Promise<void>; jobBusy: boolean; actOnMemory: (action: "accept" | "reject" | "delete", id: string) => Promise<void>; refresh: () => Promise<void> | void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/70 px-5 py-5"><p className="text-sm font-semibold tracking-[-0.01em]">Working context</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Review exactly what the next model call may receive.</p></div>
      <Tabs defaultValue="files" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-3 grid grid-cols-4"><TabsTrigger value="files">Files</TabsTrigger><TabsTrigger value="memory">Memory</TabsTrigger><TabsTrigger value="receipt">Receipt</TabsTrigger><TabsTrigger value="runs">Runs</TabsTrigger></TabsList>
        <TabsContent value="files" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-xs text-muted-foreground transition-colors hover:bg-muted"><Upload className="size-4" /> Add local sources<input type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json,.jsonl" className="sr-only" onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ""; }} /></label>
          <div className="mt-4 space-y-2">
            {!files.length && <EmptyNote>PDF, DOCX, text, Markdown, HTML, CSV, JSON, and JSONL are supported.</EmptyNote>}
            {files.map((file) => {
              const selected = selectedFileIds.includes(file.id);
              const toggleReadyFile = () => {
                if (file.status !== "ready") return;
                setSelectedFileIds((ids) => (selected ? ids.filter((id) => id !== file.id) : [...ids, file.id]));
              };
              return (
                <div
                  key={file.id}
                  role={file.status === "ready" ? "button" : undefined}
                  tabIndex={file.status === "ready" ? 0 : undefined}
                  onClick={toggleReadyFile}
                  onKeyDown={(event) => {
                    if (file.status !== "ready") return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleReadyFile();
                    }
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    selected && "border-primary/45 bg-accent/25",
                    file.status === "ready" ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <Checkbox
                    checked={selected}
                    disabled={file.status !== "ready"}
                    className="mt-0.5"
                    onCheckedChange={() => toggleReadyFile()}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{file.originalName}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                      {file.status === "failed" ? file.error : file.status === "ready" ? file.summary || "Ready" : file.status === "extracting" ? "Extracting and indexing locally…" : "Queued for local extraction…"}
                    </p>
                    {(file.status === "queued" || file.status === "extracting") && <Progress value={file.status === "extracting" ? 55 : 12} className="mt-2 h-1" />}
                  </div>
                  <FileStatus status={file.status} />
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-[10px] leading-4 text-muted-foreground">Under 32K tokens, full selected text is used. Above that, summaries and the top twelve FTS-ranked chunks are chosen.</p>
        </TabsContent>
        <TabsContent value="memory" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <Button onClick={curateMemory} disabled={jobBusy || !threadData?.messages.length} variant="outline" className="mt-2 w-full">{jobBusy ? <Loader2 className="animate-spin" /> : <Brain />} {jobBusy ? "Curating…" : "Curate memory"}</Button>
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">Nothing is remembered automatically. Review every proposal before it becomes context.</p>
          {!!threadData?.candidates.filter((item) => item.status === "proposed").length && <SectionLabel>Needs review</SectionLabel>}
          {threadData?.candidates.filter((item) => item.status === "proposed").map((candidate) => <div key={candidate.id} className="mt-2 rounded-lg border bg-card p-3"><div className="flex items-center gap-2"><Badge variant="secondary" className="font-mono text-[9px]">{candidate.type}</Badge><span className="ml-auto font-mono text-[9px] text-muted-foreground">{Math.round(candidate.confidence * 100)}%</span></div><p className="mt-2 text-xs font-medium">{candidate.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{candidate.content}</p><div className="mt-3 flex gap-1"><Button size="xs" onClick={() => void actOnMemory("accept", candidate.id)}><Check /> Accept</Button><Button size="xs" variant="ghost" onClick={() => void actOnMemory("reject", candidate.id)}><X /> Reject</Button></div></div>)}
          {!!threadData?.memories.length && <SectionLabel>Accepted</SectionLabel>}
          {threadData?.memories.map((memory) => <div key={memory.id} className="mt-2 rounded-lg border p-3"><div className="flex items-center"><Badge variant="outline" className="font-mono text-[9px]">{memory.type}</Badge><Button size="icon-xs" variant="ghost" className="ml-auto" onClick={() => void actOnMemory("delete", memory.id)} aria-label={`Delete ${memory.title}`}><Trash2 /></Button></div><p className="mt-2 text-xs font-medium">{memory.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{memory.content}</p></div>)}
          {!threadData?.memories.length && !threadData?.candidates.some((item) => item.status === "proposed") && <EmptyNote>No accepted memory in this conversation.</EmptyNote>}
        </TabsContent>
        <TabsContent value="receipt" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {!threadData?.receipt ? <EmptyNote>Send a message to create a context receipt.</EmptyNote> : <Receipt receipt={threadData.receipt} />}
        </TabsContent>
        <TabsContent value="runs" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {!threadData?.runs.length && <EmptyNote>Deep synthesis runs will appear here with every branch and stage inspectable.</EmptyNote>}
          {threadData?.runs.map((run) => <RunCard key={run.id} run={run} refresh={refresh} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RunCard({ run, refresh }: { run: ThreadData["runs"][number]; refresh: () => Promise<void> | void }) {
  const progress = run.status === "completed" ? 100 : run.status === "queued" ? 5 : Math.min(92, 15 + run.steps.filter((step) => step.status === "completed").length * 18);
  return <div className="mt-3 rounded-lg border p-3"><div className="flex items-center gap-2"><Layers3 className="size-4" /><p className="line-clamp-1 text-xs font-medium">{run.question}</p><Badge variant="outline" className="ml-auto text-[9px]">{run.status}</Badge></div><Progress value={progress} className="mt-3 h-1" /><div className="mt-3 space-y-1">{run.steps.map((step) => <details key={String(step.id)} className="rounded-md bg-muted/50 px-2 py-1.5"><summary className="cursor-pointer text-[11px] font-medium">{String(step.role)} · {String(step.status)}</summary><p className="mt-2 whitespace-pre-wrap font-conversation text-xs leading-5 text-muted-foreground">{String(step.output || step.error || "Waiting…")}</p></details>)}</div>{run.status === "running" && <Button variant="ghost" size="xs" className="mt-2" onClick={async () => { await requestJson(`/api/runs/${run.id}`, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) }); await refresh(); }}><Square /> Cancel</Button>}</div>;
}

function Receipt({ receipt }: { receipt: Record<string, unknown> }) {
  const memories = parseJsonArray(receipt.memory_ids_json); const chunks = parseJsonArray(receipt.file_chunk_ids_json);
  return <div className="mt-3 space-y-4"><div className="rounded-lg border bg-card p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-600" /><p className="text-xs font-medium">Context recorded</p></div><dl className="mt-4 grid grid-cols-3 gap-2 text-center"><div><dt className="font-mono text-lg">{memories.length}</dt><dd className="text-[9px] text-muted-foreground">MEMORIES</dd></div><div><dt className="font-mono text-lg">{chunks.length}</dt><dd className="text-[9px] text-muted-foreground">CHUNKS</dd></div><div><dt className="font-mono text-lg">{String(receipt.estimated_tokens ?? 0)}</dt><dd className="text-[9px] text-muted-foreground">EST. TOKENS</dd></div></dl></div><details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs font-medium">Exact rendered context</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-5 text-muted-foreground">{String(receipt.rendered_context || "No additional context.")}</pre></details></div>;
}

function CommandPalette({ open, setOpen, boot, onThread, onProject, onNew, onSettings }: { open: boolean; setOpen: (open: boolean) => void; boot: BootstrapData; onThread: (id: string) => void; onProject: (id: string) => void; onNew: () => void; onSettings: () => void }) {
  const run = (action: () => void) => { action(); setOpen(false); };
  return <CommandDialog open={open} onOpenChange={setOpen}><CommandInput placeholder="Search conversations, projects, files, or actions…" /><CommandList><CommandEmpty>No local result found.</CommandEmpty><CommandGroup heading="Actions"><CommandItem onSelect={() => run(onNew)}><Plus /> New conversation</CommandItem><CommandItem onSelect={() => run(onSettings)}><Settings /> Settings</CommandItem></CommandGroup><CommandSeparator /><CommandGroup heading="Conversations">{boot.threads.slice(0, 30).map((thread) => <CommandItem key={thread.id} value={`${thread.title} conversation`} onSelect={() => run(() => onThread(thread.id))}><MessageSquareText />{thread.title}</CommandItem>)}</CommandGroup><CommandGroup heading="Projects">{boot.projects.map((project) => <CommandItem key={project.id} value={`${project.name} project`} onSelect={() => run(() => onProject(project.id))}><Folder />{project.name}</CommandItem>)}</CommandGroup><CommandGroup heading="Files">{boot.files.map((file) => <CommandItem key={file.id} value={`${file.originalName} file`}><FileText />{file.originalName}</CommandItem>)}</CommandGroup></CommandList></CommandDialog>;
}

function FileStatus({ status }: { status: FileRecord["status"] }) { if (status === "ready") return <Check className="size-3.5 text-emerald-600" />; if (status === "failed") return <CircleAlert className="size-3.5 text-destructive" />; return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />; }
function EmptyNote({ children }: { children: React.ReactNode }) { return <div className="mt-6 rounded-lg border border-dashed p-5 text-center text-xs leading-5 text-muted-foreground">{children}</div>; }
function SectionLabel({ children }: { children: React.ReactNode }) { return <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{children}</p>; }
function LoadingScreen() {
  return (
    <div className="flex h-dvh flex-col bg-background lg:grid lg:grid-cols-[272px_1fr]">
      <div className="hidden space-y-3 border-r bg-sidebar p-4 lg:block" aria-hidden>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="mt-8 h-7 w-4/5" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-11/12" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-5 lg:hidden" aria-hidden>
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="h-3 w-28 max-w-full" />
          </div>
          <Skeleton className="size-9 shrink-0 rounded-md" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10 sm:px-8">
          <div className="w-full max-w-3xl space-y-4 lg:hidden" aria-hidden>
            <Skeleton className="mx-auto h-6 w-2/3 max-w-xs" />
            <Skeleton className="mx-auto h-4 w-full max-w-md" />
            <Skeleton className="mx-auto h-4 w-5/6 max-w-sm" />
          </div>
          <div className="text-center">
            <div className="mx-auto mb-4 grid size-10 place-items-center rounded-xl border bg-card">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            </div>
            <p className="font-conversation text-xl">Opening your workbench…</p>
            <p className="mt-2 text-sm text-muted-foreground">Loading local projects and settings</p>
          </div>
        </div>
        <div className="shrink-0 px-3 pb-4 sm:px-6 sm:pb-6 lg:hidden" aria-hidden>
          <Skeleton className="mx-auto h-28 max-w-3xl rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function FailureScreen({ retry, errorMessage }: { retry: () => void; errorMessage?: string | null }) {
  const failure = bootstrapFailureDetails(errorMessage);
  return (
    <div className="grid h-dvh place-items-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        <CircleAlert className="mx-auto mb-4 size-6 text-destructive" aria-hidden />
        <h1 className="font-conversation text-2xl leading-tight">{failure.title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{failure.description}</p>
        {errorMessage && (
          <p className="mt-3 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground break-words">
            {errorMessage}
          </p>
        )}
        <ul className="mt-5 space-y-2 text-left text-xs leading-5 text-muted-foreground">
          {failure.hints.map((hint) => (
            <li key={hint} className="flex gap-2">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
              <span>{hint}</span>
            </li>
          ))}
        </ul>
        <Button onClick={retry} className="mt-6 w-full sm:w-auto">
          <RotateCcw /> Try again
        </Button>
      </div>
    </div>
  );
}
function toUIMessage(message: MessageRecord): UIMessage { return { id: message.id, role: message.role, parts: [{ type: "text", text: message.content }] } as UIMessage; }
function protocolLabel(protocol: DeploymentRecord["protocol"]) { if (protocol === "responses") return "Responses"; if (protocol === "chat") return "Chat Completions"; if (protocol === "deepseek") return "DeepSeek chat"; return "Probe required"; }
function bootstrapFailureDetails(message?: string | null) {
  const lower = (message ?? "").toLowerCase();
  const serverUnreachable =
    !message ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network error") ||
    lower.includes("load failed") ||
    lower.includes("connection refused") ||
    lower.includes("econnrefused") ||
    lower.includes("request failed (0)") ||
    /\b(502|503|504)\b/.test(lower);

  if (serverUnreachable) {
    return {
      title: "Can't reach the local server",
      description: "The browser couldn't load /api/bootstrap. That usually means the Next.js dev server isn't running on this machine yet.",
      hints: [
        "In the project folder, run npm run dev (starts the web app and background worker together).",
        "If you only started the web UI, also confirm the worker process is running — file extraction and memory jobs need it.",
        "Open http://127.0.0.1:3000 after the terminal shows Next.js is ready, then try again.",
      ],
    };
  }

  const configOrData =
    lower.includes("migrate") ||
    lower.includes("database") ||
    lower.includes("sqlite") ||
    lower.includes("configured") ||
    lower.includes("deployment") ||
    lower.includes("api key") ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("403");

  if (configOrData) {
    return {
      title: "Local setup needs attention",
      description: "The server responded, but bootstrap failed — often migrations, the local database, or Azure connection settings.",
      hints: [
        "Run npm run db:migrate once if this is a fresh clone or after pulling schema changes.",
        "Open Settings after the app loads to verify your API key and enabled model deployments.",
        "Check the terminal running npm run dev for the exact API error, then retry.",
      ],
    };
  }

  return {
    title: "The local workbench could not open",
    description: "Something went wrong while loading projects and threads from this Mac.",
    hints: [
      "Run npm run dev from the project root and watch for errors in the web or worker logs.",
      "Confirm the background worker started (listed as worker in the dev terminal).",
      "Use Try again after fixing the issue; the launcher window may also show more detail.",
    ],
  };
}

function chatErrorHint(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("api key")) return "Check Settings → connection or re-enter your Azure API key.";
  if (lower.includes("404") || lower.includes("deployment")) return "Open Settings → Models and sync deployments, or pick another model in the header.";
  if (lower.includes("429") || lower.includes("rate")) return "Azure rate-limited this deployment. Wait a moment or switch models.";
  if (lower.includes("timeout") || lower.includes("timed out")) return "The model took too long. Retry or choose a faster deployment.";
  return "";
}
function parseJsonArray(value: unknown) { try { const result = JSON.parse(String(value ?? "[]")); return Array.isArray(result) ? result : []; } catch { return []; } }
async function requestJson<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, init); const data = await response.json(); if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`); return data as T; }
async function waitForJob(id: string) { for (let index = 0; index < 300; index += 1) { const { job } = await requestJson<{ job: Record<string, unknown> }>(`/api/jobs/${id}`); if (job.status === "completed") return; if (job.status === "failed" || job.status === "cancelled") throw new Error(String(job.error || "Background job failed.")); await new Promise((resolve) => setTimeout(resolve, 1_000)); } throw new Error("The local worker did not finish in time."); }
