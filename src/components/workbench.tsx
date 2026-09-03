"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, FormEvent, ReactNode } from "react";
import { DefaultChatTransport, type SourceDocumentUIPart, type SourceUrlUIPart, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import {
  Archive, Brain, Check, ChevronDown, CircleAlert, Copy, Download, Eye, FileImage, FileText, Folder,
  Gauge, GitBranch, ListChecks, Loader2, Menu, MessageSquareText, PanelLeftClose, PanelLeftOpen, PanelRight, Pencil, Plus, RotateCcw,
  Save, Search, Settings, ShieldCheck, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { SetupScreen } from "@/components/setup-screen";
import { ConversationExportDialog } from "@/components/conversation-export-dialog";
import { ConversationTrashDialog } from "@/components/conversation-trash-dialog";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInputSubmit } from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { SettingsDialog, type AnswerTextSize } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { attachmentModeLabel, findTextPreparationDeployment, findVisualPreparationDeployment, isImageFile, isVisualAttachment, supportsNativeVisualInput, type AttachmentSelection } from "@/lib/attachments";
import { MEMORY_TYPES, type DeploymentRecord, type FileRecord, type GenerationRecord, type MemoryCandidateRecord, type MemoryRecord, type MemoryType, type MessageAttachmentRecord, type MessageRecord, type ProjectRecord, type SafeConfig, type SynthesisRunRecord, type ThreadRecord } from "@/lib/types";
import { normalizeMarkdownForDisplay } from "@/lib/message-markdown";
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
  generations: GenerationRecord[]; receipt: Record<string, unknown> | null; runs: Array<SynthesisRunRecord & { steps: Array<Record<string, unknown>> }>;
};

type RememberDraft = { messageId: string; type: MemoryType; title: string; content: string; scope: "conversation" | "project"; sensitivity: "normal" | "sensitive" };
type EditMessageDraft = { messageId: string; text: string; attachments: MessageAttachmentRecord[]; laterMessageCount: number };
type UploadingAttachment = { id: string; name: string };
type SavedComposerDraft = { text?: string; fileIds?: string[]; attachmentSelections?: Record<string, AttachmentSelection>; memoryIds?: string[] };
type WorkbenchMessage = UIMessage<{ attachments?: MessageAttachmentRecord[] }>;

const ACCEPTED_FILES = ".pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json,.jsonl,.png,.jpg,.jpeg,.webp,.gif";
const DRAFT_STORAGE_PREFIX = "local-ai-workbench:composer:";
const SIDEBAR_STORAGE_KEY = "local-ai-workbench:sidebar-collapsed";
const EFFORT_STORAGE_KEY = "local-ai-workbench:reasoning-effort";
const ANSWER_TEXT_SIZE_STORAGE_KEY = "local-ai-workbench:answer-text-size";
type ReasoningEffort = SafeConfig["reasoningEffort"];

export function Workbench() {
  const [boot, setBoot] = useState<BootstrapData | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeThreadId, setActiveThreadId] = useState("");
  const [threadData, setThreadData] = useState<ThreadData | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [attachmentSelections, setAttachmentSelections] = useState<Record<string, AttachmentSelection>>({});
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
  const [rememberDraft, setRememberDraft] = useState<RememberDraft | null>(null);
  const [editMessageDraft, setEditMessageDraft] = useState<EditMessageDraft | null>(null);
  const [branchingMessageId, setBranchingMessageId] = useState("");
  const [remembering, setRemembering] = useState(false);
  const [composer, setComposer] = useState("");
  const [uploadingAttachments, setUploadingAttachments] = useState<UploadingAttachment[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [draftContextThreadId, setDraftContextThreadId] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashedThreads, setTrashedThreads] = useState<ThreadRecord[]>([]);
  const [managingThreads, setManagingThreads] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [isWide, setIsWide] = useState(false);
  const [jobBusy, setJobBusy] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [answerTextSize, setAnswerTextSize] = useState<AnswerTextSize>("comfortable");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const chatRequestContextRef = useRef({ threadId: "", projectId: "", deployment: "", attachments: [] as AttachmentSelection[], memoryIds: [] as string[], reasoningEffort: "medium" as ReasoningEffort });
  const submittedDraftRef = useRef("");
  const previousStatusRef = useRef<"submitted" | "streaming" | "ready" | "error">("ready");

  const resizeComposer = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset before measuring so an earlier long draft can never become the
    // minimum height for the next message or conversation.
    textarea.style.height = "32px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 32), 144);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 144 ? "auto" : "hidden";
  }, []);

  const activeProject = boot?.projects.find((project) => project.id === activeProjectId) ?? boot?.projects[0];
  const activeThread = boot?.threads.find((thread) => thread.id === activeThreadId) ?? threadData?.thread;
  const deployment = activeThread?.deploymentId || boot?.config.chatDeployment || boot?.deployments.find((item) => item.enabled)?.name || "";
  const activeDeployment = boot?.deployments.find((item) => item.name === deployment);
  const attachments = useMemo(() => selectedFileIds.map((fileId) => attachmentSelections[fileId] ?? { fileId, mode: "direct" as const }), [attachmentSelections, selectedFileIds]);
  const selectedFilesPreparing = selectedFileIds.some((fileId) => boot?.files.find((file) => file.id === fileId)?.status !== "ready");

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

  const transport = useMemo(() => new DefaultChatTransport<WorkbenchMessage>({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => ({
      body: { id, messages, ...chatRequestContextRef.current, ...body, trigger, messageId },
    }),
  }), []);

  const { messages, setMessages, sendMessage, regenerate, stop, status, error } = useChat<WorkbenchMessage>({ id: activeThreadId || "local-draft", transport });
  const streaming = status === "submitted" || status === "streaming";
  const latestMessage = messages.at(-1);
  const latestAssistantHasText = latestMessage?.role === "assistant" && latestMessage.parts.some((part) =>
    part.type === "text" && part.text.trim().length > 0
  );
  const latestAssistantReasoningActive = latestMessage?.role === "assistant" && latestMessage.parts.some((part) =>
    part.type === "reasoning" && (part.state === "streaming" || (part.state === undefined && status === "streaming" && part.text.trim().length > 0))
  );
  const showAssistantActivity = status === "submitted" || (status === "streaming" && !latestAssistantHasText);
  const activeRequestGeneration = useMemo(() => [...(threadData?.generations ?? [])].reverse().find((item) => item.stage === "response" && item.status === "streaming"), [threadData?.generations]);
  const activePreparations = useMemo(() => activeRequestGeneration
    ? (threadData?.generations ?? []).filter((item) => item.settings.parentGenerationId === activeRequestGeneration.id)
    : [], [activeRequestGeneration, threadData?.generations]);
  const latestUserAttachments = useMemo(() => [...messages].reverse().find((message) => message.role === "user")?.metadata?.attachments ?? [], [messages]);

  useEffect(() => { void loadBootstrap(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
    const storedTextSize = window.localStorage.getItem(ANSWER_TEXT_SIZE_STORAGE_KEY);
    if (storedTextSize === "compact" || storedTextSize === "comfortable" || storedTextSize === "large") setAnswerTextSize(storedTextSize);
  }, []);
  useEffect(() => {
    const stored = window.localStorage.getItem(EFFORT_STORAGE_KEY);
    const next = stored === "none" || stored === "low" || stored === "medium" || stored === "high" ? stored : boot?.config.reasoningEffort;
    if (next) setReasoningEffort(next);
  }, [boot?.config.reasoningEffort]);
  useEffect(() => { if (activeThreadId) void loadThread(activeThreadId); }, [activeThreadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    chatRequestContextRef.current = {
      threadId: activeThreadId,
      projectId: activeProjectId,
      deployment,
      attachments,
      memoryIds: selectedMemoryIds,
      reasoningEffort,
    };
  }, [activeProjectId, activeThreadId, attachments, deployment, reasoningEffort, selectedMemoryIds]);
  useEffect(() => {
    if (!activeThreadId) return;
    let saved: SavedComposerDraft = {};
    const savedRaw = window.localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${activeThreadId}`);
    try { saved = JSON.parse(savedRaw ?? "{}"); }
    catch { saved = {}; }
    setComposer(saved.text ?? "");
    setSelectedFileIds(saved.fileIds ?? []);
    setAttachmentSelections(saved.attachmentSelections ?? {});
    setSelectedMemoryIds(saved.memoryIds ?? []);
    setDraftContextThreadId(activeThreadId);
  }, [activeThreadId]);
  useEffect(() => {
    if (!activeThreadId || draftContextThreadId !== activeThreadId) return;
    const draft: SavedComposerDraft = { text: composer, fileIds: selectedFileIds, attachmentSelections, memoryIds: selectedMemoryIds };
    window.localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${activeThreadId}`, JSON.stringify(draft));
  }, [activeThreadId, attachmentSelections, composer, draftContextThreadId, selectedFileIds, selectedMemoryIds]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1536px)");
    const update = () => setIsWide(query.matches); update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    resizeComposer();
  }, [activeThreadId, composer, draftContextThreadId, resizeComposer]);
  useEffect(() => {
    window.addEventListener("resize", resizeComposer);
    return () => window.removeEventListener("resize", resizeComposer);
  }, [resizeComposer]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((open) => !open); } };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => { if (status === "ready" && activeThreadId) { void loadThread(activeThreadId, true); void refreshLists(); } }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!streaming || !activeThreadId) return;
    void loadThread(activeThreadId, true);
    const timer = window.setInterval(() => void loadThread(activeThreadId, true), 850);
    return () => window.clearInterval(timer);
  }, [activeThreadId, loadThread, streaming]);
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

  async function createBranch(message: WorkbenchMessage) {
    if (!activeProjectId || !activeThreadId || branchingMessageId) return;
    setBranchingMessageId(message.id);
    try {
      const { thread } = await requestJson<{ thread: ThreadRecord }>("/api/threads", {
        method: "POST",
        body: JSON.stringify({
          projectId: activeProjectId,
          branchFrom: { threadId: activeThreadId, messageId: message.id, includeMessage: true },
        }),
      });
      setBoot((current) => current ? { ...current, threads: [thread, ...current.threads] } : current);
      setActiveThreadId(thread.id);
      setMessages([]);
      setThreadData(null);
      setMobileSidebarOpen(false);
      toast.success("Branched conversation created");
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (branchError) {
      toast.error(branchError instanceof Error ? branchError.message : "Could not create the branch.");
    } finally {
      setBranchingMessageId("");
    }
  }

  async function editMessage() {
    if (!editMessageDraft || !activeThreadId || !activeProjectId || streaming) return;
    const text = editMessageDraft.text.trim();
    if (!text) return;
    const editedAttachments = editMessageDraft.attachments.map(({ fileId, mode, preparationDeployment }) => ({
      fileId,
      mode,
      ...(preparationDeployment ? { preparationDeployment } : {}),
    }));
    const issue = attachmentCompatibilityIssue(
      editedAttachments.map((attachment) => attachment.fileId),
      Object.fromEntries(editedAttachments.map((attachment) => [attachment.fileId, attachment])),
      boot?.files ?? [],
      activeDeployment,
    );
    if (issue) { toast.error(issue); return; }

    const draft = editMessageDraft;
    setEditMessageDraft(null);
    try {
      await sendMessage(
        { messageId: draft.messageId, text, metadata: { attachments: draft.attachments } },
        { body: { ...chatRequestContextRef.current, attachments: editedAttachments, editedMessageId: draft.messageId } },
      );
      toast.success("Message updated in this conversation");
    } catch (editError) {
      setEditMessageDraft(draft);
      toast.error(editError instanceof Error ? editError.message : "Could not update the message.");
    }
  }

  async function trashConversations(ids: string[]) {
    if (!ids.length || !activeProjectId) return;
    if (!confirm(`Move ${ids.length} conversation${ids.length === 1 ? "" : "s"} to Trash? You can restore them later.`)) return;
    try {
      await requestJson<{ changed: number }>("/api/threads", {
        method: "PATCH",
        body: JSON.stringify({ projectId: activeProjectId, ids, action: "trash" }),
      });
      const removed = new Set(ids);
      const remaining = boot?.threads.filter((thread) => thread.projectId === activeProjectId && !removed.has(thread.id)) ?? [];
      setBoot((current) => current ? { ...current, threads: current.threads.filter((thread) => !removed.has(thread.id)) } : current);
      if (removed.has(activeThreadId)) {
        if (remaining.length) setActiveThreadId(remaining[0].id);
        else {
          const { thread } = await requestJson<{ thread: ThreadRecord }>("/api/threads", {
            method: "POST",
            body: JSON.stringify({ projectId: activeProjectId, deploymentId: deployment }),
          });
          setBoot((current) => current ? { ...current, threads: [thread, ...current.threads] } : current);
          setActiveThreadId(thread.id); setMessages([]); setThreadData(null);
        }
      }
      setSelectedThreadIds([]);
      setManagingThreads(false);
      toast.success(`${ids.length} conversation${ids.length === 1 ? "" : "s"} moved to Trash`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not move the conversations to Trash."); }
  }

  async function openConversationTrash() {
    if (!activeProjectId) return;
    setTrashOpen(true);
    setTrashLoading(true);
    try {
      const result = await requestJson<{ threads: ThreadRecord[] }>(`/api/threads?projectId=${encodeURIComponent(activeProjectId)}&trashed=1`);
      setTrashedThreads(result.threads);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load Trash."); }
    finally { setTrashLoading(false); }
  }

  async function restoreConversations(ids: string[]) {
    await requestJson<{ changed: number }>("/api/threads", {
      method: "PATCH",
      body: JSON.stringify({ projectId: activeProjectId, ids, action: "restore" }),
    });
    setTrashedThreads((threads) => threads.filter((thread) => !ids.includes(thread.id)));
    await loadBootstrap();
    toast.success(`${ids.length} conversation${ids.length === 1 ? "" : "s"} restored`);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault(); const text = composer.trim();
    if (!text || streaming || !activeThreadId) return;
    const issue = attachmentCompatibilityIssue(selectedFileIds, attachmentSelections, boot?.files ?? [], activeDeployment);
    if (issue) { toast.error(issue); return; }
    const retryingFailedChat = status === "error" && text === submittedDraftRef.current;
    const sentFileIds = [...selectedFileIds];
    const sentSelections = { ...attachmentSelections };
    const sentAttachments = attachments.map((attachment) => {
      const file = boot?.files.find((item) => item.id === attachment.fileId);
      if (!file) return null;
      return { fileId: file.id, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, mode: attachment.mode, ...(attachment.preparationDeployment ? { preparationDeployment: attachment.preparationDeployment } : {}) } satisfies MessageAttachmentRecord;
    }).filter((item): item is MessageAttachmentRecord => Boolean(item));
    const requestBody = { ...chatRequestContextRef.current, attachments };
    submittedDraftRef.current = text;
    setComposer("");
    setSelectedFileIds([]);
    setAttachmentSelections({});
    try {
      if (retryingFailedChat) await regenerate({ body: requestBody });
      else await sendMessage({ text, metadata: { attachments: sentAttachments } }, { body: requestBody });
    } catch (sendError) {
      setComposer(text);
      setSelectedFileIds(sentFileIds);
      setAttachmentSelections(sentSelections);
      toast.error(sendError instanceof Error ? sendError.message : "Could not send the message.");
    }
  }

  async function regenerateMessage(messageId: string) {
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    const originalUser = targetIndex >= 0
      ? messages.slice(0, targetIndex + 1).reverse().find((message) => message.role === "user")
      : [...messages].reverse().find((message) => message.role === "user");
    const originalAttachments = originalUser?.metadata?.attachments ?? [];
    await regenerate({
      messageId,
      body: {
        ...chatRequestContextRef.current,
        attachments: originalAttachments.map(({ fileId, mode, preparationDeployment }) => ({ fileId, mode, ...(preparationDeployment ? { preparationDeployment } : {}) })),
      },
    });
  }

  async function selectProject(id: string) {
    setManagingThreads(false); setSelectedThreadIds([]); setActiveProjectId(id); const first = boot?.threads.find((thread) => thread.projectId === id);
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

  async function uploadFiles(files: FileList | File[] | null) {
    if (!files?.length || !activeProjectId) return;
    const incoming = Array.from(files);
    const pending = incoming.map((file) => ({ id: crypto.randomUUID(), name: file.name }));
    setUploadingAttachments((current) => [...current, ...pending]);
    const form = new FormData(); form.set("projectId", activeProjectId); form.set("threadId", activeThreadId);
    incoming.forEach((file) => form.append("files", file));
    try {
      const result = await requestJson<{ files: FileRecord[] }>("/api/files", { method: "POST", body: form });
      const ids = result.files.map((file) => file.id);
      setBoot((current) => {
        if (!current) return current;
        const uploadedIds = new Set(ids);
        return { ...current, files: [...result.files, ...current.files.filter((file) => !uploadedIds.has(file.id))] };
      });
      setSelectedFileIds((current) => [...new Set([...current, ...ids])]);
      setAttachmentSelections((current) => ({ ...current, ...Object.fromEntries(ids.map((fileId) => [fileId, { fileId, mode: "direct" as const }])) }));
      void refreshLists();
      setLiveAnnouncement(`${result.files.length} file${result.files.length === 1 ? "" : "s"} ready for the next message.`);
      toast.success(`${result.files.length} file${result.files.length === 1 ? "" : "s"} ready for this message`);
    }
    catch (uploadError) { toast.error(uploadError instanceof Error ? uploadError.message : "Upload failed."); }
    finally {
      const pendingIds = new Set(pending.map((item) => item.id));
      setUploadingAttachments((current) => current.filter((item) => !pendingIds.has(item.id)));
    }
  }

  function handleDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    void uploadFiles(event.dataTransfer.files);
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

  async function saveRememberedMemory() {
    if (!rememberDraft || !activeProjectId || !activeThreadId || remembering) return;
    setRemembering(true);
    try {
      const { memory } = await requestJson<{ memory: MemoryRecord }>("/api/memory", { method: "POST", body: JSON.stringify({
        action: "create", projectId: activeProjectId, threadId: activeThreadId, messageId: rememberDraft.messageId,
        type: rememberDraft.type, title: rememberDraft.title, content: rememberDraft.content,
        scope: rememberDraft.scope, sensitivity: rememberDraft.sensitivity,
      }) });
      await loadThread(activeThreadId, true);
      setSelectedMemoryIds((ids) => [...new Set([...ids, memory.id])]);
      setRememberDraft(null);
      toast.success("Memory saved and selected");
    } catch (memoryError) { toast.error(memoryError instanceof Error ? memoryError.message : "Could not save memory."); }
    finally { setRemembering(false); }
  }

  function rememberMessage(message: UIMessage) {
    const content = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
    setRememberDraft({
      messageId: message.id, type: "episodic note", title: content.replace(/\s+/g, " ").slice(0, 72) || "Remembered note",
      content: content.slice(0, 1_200), scope: "conversation", sensitivity: "normal",
    });
  }

  if (loading && !boot) return <LoadingScreen />;
  if (!boot) return <FailureScreen retry={loadBootstrap} errorMessage={bootstrapError} />;
  if (!boot.config.configured) return <SetupScreen onComplete={loadBootstrap} />;

  const visibleThreads = boot.threads.filter((thread) => thread.projectId === activeProjectId);
  const sidebar = <Sidebar
    projects={boot.projects}
    threads={visibleThreads}
    activeProjectId={activeProjectId}
    activeThreadId={activeThreadId}
    managing={managingThreads}
    selectedIds={selectedThreadIds}
    onProject={selectProject}
    onThread={(id) => { setActiveThreadId(id); setMobileSidebarOpen(false); }}
    onNew={createConversation}
    onSearch={() => setCommandOpen(true)}
    onSettings={() => setSettingsOpen(true)}
    onToggleManaging={() => { setManagingThreads((value) => !value); setSelectedThreadIds([]); }}
    onToggleSelected={(id) => setSelectedThreadIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])}
    onSelectAll={() => setSelectedThreadIds(selectedThreadIds.length === visibleThreads.length ? [] : visibleThreads.map((thread) => thread.id))}
    onTrash={() => void trashConversations(selectedThreadIds)}
    onOpenTrash={() => void openConversationTrash()}
  />;
  const collapseSidebar = () => {
    setSidebarCollapsed(true);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "true");
  };
  const expandSidebar = () => {
    setSidebarCollapsed(false);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "false");
  };
  const context = <ContextPanel
    files={boot.files} deployments={boot.deployments} currentDeployment={activeDeployment}
    selectedFileIds={selectedFileIds} setSelectedFileIds={setSelectedFileIds}
    attachmentSelections={attachmentSelections} setAttachmentSelections={setAttachmentSelections}
    selectedMemoryIds={selectedMemoryIds} setSelectedMemoryIds={setSelectedMemoryIds}
    uploadFiles={uploadFiles} threadData={threadData} curateMemory={curateMemory} jobBusy={jobBusy} actOnMemory={actOnMemory}
  />;
  const proposedMemoryCount = threadData?.candidates.filter((item) => item.status === "proposed").length ?? 0;
  const contextAttentionCount = selectedFileIds.length + proposedMemoryCount;
  const contextBadgeVisible = contextAttentionCount > 0;
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
    <div
      className="workbench-shell flex h-dvh w-full overflow-hidden bg-background"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {draggingFiles && (
        <div className="pointer-events-none fixed inset-3 z-[100] grid place-items-center rounded-3xl border-2 border-dashed border-primary/55 bg-background/88 shadow-2xl backdrop-blur-md">
          <div className="rounded-2xl border bg-card px-8 py-6 text-center shadow-xl">
            <Upload className="mx-auto size-6 text-primary" />
            <p className="mt-3 text-sm font-medium">Drop files into this conversation</p>
            <p className="mt-1 text-xs text-muted-foreground">Images, PDF, DOCX, Markdown, JSON, CSV, and text</p>
          </div>
        </div>
      )}
      <aside
        className={cn(
          "hidden shrink-0 border-r border-sidebar-border/80 bg-sidebar/95 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block",
          sidebarCollapsed ? "w-[60px]" : "w-[256px]",
        )}
      >
        {sidebarCollapsed ? (
          <SidebarRail onExpand={expandSidebar} onNew={createConversation} onSearch={() => setCommandOpen(true)} onSettings={() => setSettingsOpen(true)} />
        ) : (
          <Sidebar
            projects={boot.projects}
            threads={visibleThreads}
            activeProjectId={activeProjectId}
            activeThreadId={activeThreadId}
            managing={managingThreads}
            selectedIds={selectedThreadIds}
            onProject={selectProject}
            onThread={(id) => setActiveThreadId(id)}
            onNew={createConversation}
            onSearch={() => setCommandOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            onToggleManaging={() => { setManagingThreads((value) => !value); setSelectedThreadIds([]); }}
            onToggleSelected={(id) => setSelectedThreadIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])}
            onSelectAll={() => setSelectedThreadIds(selectedThreadIds.length === visibleThreads.length ? [] : visibleThreads.map((thread) => thread.id))}
            onTrash={() => void trashConversations(selectedThreadIds)}
            onOpenTrash={() => void openConversationTrash()}
            onCollapse={collapseSidebar}
          />
        )}
      </aside>
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}><SheetContent side="left" className="w-[292px] p-0"><SheetHeader className="sr-only"><SheetTitle>Navigation</SheetTitle></SheetHeader>{sidebar}</SheetContent></Sheet>

      <main className="workspace-surface relative flex w-0 min-w-0 flex-1 flex-col">
        <header className="z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border/75 bg-background/88 px-3 backdrop-blur-xl sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation"><Menu /></Button>
          <div className="min-w-0 flex-1"><p className="truncate font-conversation text-[17px] font-medium tracking-[-0.018em]">{activeThread?.title || "New conversation"}</p><p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">{activeThread?.parentThreadId && <><GitBranch className="size-3 shrink-0" /><span>Branch</span><span>·</span></>}{activeProject?.name} · private workspace</p></div>
          <div className="hidden min-w-0 items-center gap-1.5 rounded-full border border-border/65 bg-card/60 px-1.5 py-1 sm:flex">
            <ModelSelector deployment={deployment} deployments={boot.deployments} onChange={updateThreadDeployment} disabled={streaming} compact />
            <ModelCapabilityCue deployment={activeDeployment} />
          </div>
          <div className="sm:hidden"><ModelSelector deployment={deployment} deployments={boot.deployments} onChange={updateThreadDeployment} disabled={streaming} compact /></div>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => setExportOpen(true)} disabled={!messages.length || streaming} aria-label="Export selected messages as Markdown"><Download /></Button></TooltipTrigger><TooltipContent>Export messages</TooltipContent></Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={contextOpen ? "secondary" : "ghost"}
                size="icon"
                className="relative"
                onClick={() => setContextOpen((open) => !open)}
                aria-label={contextBadgeVisible ? `Toggle evidence (${contextAttentionCount} item${contextAttentionCount === 1 ? "" : "s"} need attention)` : "Toggle evidence"}
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
                ? `Evidence · ${selectedFileIds.length ? `${selectedFileIds.length} source${selectedFileIds.length === 1 ? "" : "s"} selected` : ""}${selectedFileIds.length && proposedMemoryCount ? " · " : ""}${proposedMemoryCount ? `${proposedMemoryCount} memory review${proposedMemoryCount === 1 ? "" : "s"}` : ""}`
                : "Evidence, memory, and receipt"}
            </TooltipContent>
          </Tooltip>
        </header>

        <Conversation className="min-h-0">
          <ConversationContent className="mx-auto w-full max-w-[54rem] gap-8 px-4 py-8 sm:px-8 lg:py-11">
            <span className="sr-only" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>
            {!messages.length ? (
              <ConversationEmptyState className="min-h-[44vh]" icon={<div className="brand-mark grid size-10 place-items-center rounded-2xl"><MessageSquareText className="size-4.5" /></div>} title="Begin with a question" description="Attach a source, ask a question, and choose how each file should be used.">
                <div className="max-w-xl space-y-4 text-center"><p className="font-conversation text-2xl leading-tight tracking-[-0.025em] sm:text-[2rem]">What are we working through?</p><p className="mx-auto max-w-lg text-sm leading-6 text-muted-foreground">Files stay visible beside your message. Direct sends source content to the selected model; preparation is always your choice.</p><div className="flex flex-wrap justify-center gap-2">{["Summarize an attached file", "Challenge an idea", "Compare two options"].map((text) => <button key={text} onClick={() => { setComposer(text); textareaRef.current?.focus(); }} className="rounded-full border border-border/80 bg-card/75 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/25 hover:bg-accent/70 hover:text-foreground">{text}</button>)}</div></div>
              </ConversationEmptyState>
            ) : messages.map((message) => {
              const generation = (threadData?.generations ?? []).find((item) => item.messageId === message.id);
              const preparations = generation ? (threadData?.generations ?? []).filter((item) => item.settings.parentGenerationId === generation.id) : [];
              const latestUserId = [...messages].reverse().find((item) => item.role === "user")?.id;
              return <ChatMessage key={message.id} message={message} generation={generation} preparations={preparations} isStreaming={status === "streaming" && message.id === latestMessage?.id} isLatestUser={message.id === latestUserId} branchBusy={branchingMessageId === message.id} answerTextSize={answerTextSize} onRegenerate={() => void regenerateMessage(message.id)} onRemember={() => rememberMessage(message)} onBranch={() => void createBranch(message)} onEdit={() => setEditMessageDraft({ messageId: message.id, text: message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"), attachments: message.metadata?.attachments ?? [], laterMessageCount: messages.length - messages.findIndex((item) => item.id === message.id) - 1 })} />;
            })}
            {showAssistantActivity && <RequestProgress generation={activeRequestGeneration} preparations={activePreparations} deployment={deployment} attachments={latestUserAttachments} responseStreaming={status === "streaming"} reasoningStreaming={Boolean(latestAssistantReasoningActive)} />}
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

        <div className="shrink-0 bg-gradient-to-t from-background via-background/98 to-transparent px-3 pb-3 pt-2.5 sm:px-5 sm:pb-4">
          <form onSubmit={submit} className="composer-shell mx-auto max-w-[720px] overflow-hidden rounded-[1.25rem] border border-border/80 bg-card/98 shadow-[0_16px_38px_-28px_oklch(0.14_0.025_65/0.42)] backdrop-blur">
            <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_FILES} className="sr-only" aria-label="Choose files or images" onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ""; }} />
            {(uploadingAttachments.length > 0 || selectedFileIds.length > 0) && (
              <div className="border-b border-border/60 bg-muted/10 px-2.5 pb-2 pt-2.5">
                <div className="flex items-center gap-2 px-1 pb-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">For your next message</p>
                  {selectedFileIds.length > 0 && <button type="button" className="ml-auto text-[10px] text-muted-foreground hover:text-foreground" onClick={() => { setSelectedFileIds([]); setAttachmentSelections({}); }}>Clear all</button>}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-0.5">
                  {uploadingAttachments.map((file) => <UploadingAttachmentChip key={file.id} file={file} />)}
                  {selectedFileIds.map((id) => { const file = boot.files.find((item) => item.id === id); return file ? <AttachmentChip key={id} file={file} deployments={boot.deployments} currentDeployment={activeDeployment} selection={attachmentSelections[id] ?? { fileId: id, mode: "direct" }} onSelection={(selection) => setAttachmentSelections((current) => ({ ...current, [id]: selection }))} onRemove={() => { setSelectedFileIds((ids) => ids.filter((value) => value !== id)); setAttachmentSelections((current) => { const next = { ...current }; delete next[id]; return next; }); }} /> : null; })}
                </div>
              </div>
            )}
            <div className="flex min-h-10 items-end gap-1 px-1.5 py-0.5">
              <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="relative size-8 shrink-0 rounded-full text-muted-foreground" aria-label="Attach files or images" onClick={() => fileInputRef.current?.click()}><Plus className="size-4" />{selectedFileIds.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-3.5 place-items-center rounded-full bg-primary text-[8px] font-medium text-primary-foreground">{selectedFileIds.length > 9 ? "9+" : selectedFileIds.length}</span>}</Button></TooltipTrigger><TooltipContent>Attach files or images</TooltipContent></Tooltip>
              <Textarea key={activeThreadId || "new"} rows={1} ref={textareaRef} value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={selectedFileIds.length ? "Ask about the attached source…" : "Message a model…"} className="field-sizing-fixed min-h-8 max-h-36 flex-1 resize-none overflow-y-hidden border-0 bg-transparent px-1.5 py-1 text-[14px] leading-6 shadow-none focus-visible:ring-0" />
              <EffortSelector
                deployment={activeDeployment}
                effort={reasoningEffort}
                disabled={streaming}
                onChange={(effort) => { setReasoningEffort(effort); window.localStorage.setItem(EFFORT_STORAGE_KEY, effort); }}
              />
              <PromptInputSubmit
                status={status}
                onStop={stop}
                aria-label={streaming ? "Stop generation" : status === "error" ? "Retry message" : "Send message"}
                disabled={(!composer.trim() || uploadingAttachments.length > 0 || selectedFilesPreparing) && !streaming}
                className="ml-auto size-8 shrink-0 rounded-full"
              />
            </div>
          </form>
          <ComposerContextSummary files={boot.files} selectedFileIds={selectedFileIds} selections={attachmentSelections} selectedMemoryIds={selectedMemoryIds} deployment={activeDeployment} />
        </div>
      </main>

      <aside
        aria-hidden={!contextOpen}
        aria-label="Evidence"
        className={cn(
          "hidden shrink-0 overflow-hidden bg-background/92 opacity-0 transition-[width,opacity] duration-[175ms] ease-out motion-reduce:transition-none 2xl:block",
          contextOpen ? "w-[376px] border-l border-border/70 opacity-100" : "pointer-events-none w-0 border-l-0"
        )}
        inert={!contextOpen}
      ><div className="h-full w-[376px]">{context}</div></aside>
      {!isWide && <Sheet open={contextOpen} onOpenChange={setContextOpen}><SheetContent side="right" className="w-[min(92vw,380px)] p-0"><SheetHeader className="sr-only"><SheetTitle>Evidence</SheetTitle></SheetHeader>{context}</SheetContent></Sheet>}

      <CommandPalette open={commandOpen} setOpen={setCommandOpen} boot={boot} onThread={setActiveThreadId} onProject={selectProject} onNew={createConversation} onSettings={() => setSettingsOpen(true)} />
      {settingsOpen && <SettingsDialog key={settingsKey} open={settingsOpen} setOpen={setSettingsOpen} config={boot.config} deployments={boot.deployments} routing={boot.modelRouting} answerTextSize={answerTextSize} onAnswerTextSizeChange={(size) => { setAnswerTextSize(size); window.localStorage.setItem(ANSWER_TEXT_SIZE_STORAGE_KEY, size); }} onRefresh={loadBootstrap} />}
      <ConversationExportDialog open={exportOpen} setOpen={setExportOpen} messages={messages} title={activeThread?.title || "Conversation"} />
      <ConversationTrashDialog open={trashOpen} setOpen={setTrashOpen} threads={trashedThreads} loading={trashLoading} onRestore={restoreConversations} />
      <RememberDialog draft={rememberDraft} setDraft={setRememberDraft} saving={remembering} onSave={saveRememberedMemory} />
      <EditMessageDialog
        draft={editMessageDraft}
        setDraft={setEditMessageDraft}
        saving={streaming}
        onSave={() => void editMessage()}
      />
    </div>
  );
}

function EffortSelector({ deployment, effort, disabled, onChange }: {
  deployment?: DeploymentRecord; effort: ReasoningEffort; disabled: boolean; onChange: (effort: ReasoningEffort) => void;
}) {
  const supported = supportsEffortControl(deployment);
  if (!supported) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 rounded-full px-2 text-[10px] font-normal text-muted-foreground" disabled={disabled} title="Reasoning effort is automatic for this model" aria-label="Reasoning effort: Automatic">
            <Sparkles className="size-3" /> <span className="hidden sm:inline">Effort · </span>Auto<ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <p className="px-2 py-1.5 text-xs leading-5 text-muted-foreground">This deployment uses its provider default and does not expose an adjustable effort setting.</p>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 rounded-full px-2 text-[10px] font-normal text-muted-foreground" disabled={disabled} title="Reasoning effort for the next message" aria-label={`Reasoning effort: ${effortLabel(effort)}`}>
          <Sparkles className="size-3" /> <span className="hidden sm:inline">Effort · </span>{effortLabel(effort)}<ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={effort} onValueChange={(value) => onChange(value as ReasoningEffort)}>
          <DropdownMenuRadioItem value="none">Off <span className="ml-auto text-[10px] text-muted-foreground">direct</span></DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="low">Low <span className="ml-auto text-[10px] text-muted-foreground">quick</span></DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="medium">Medium <span className="ml-auto text-[10px] text-muted-foreground">balanced</span></DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="high">High <span className="ml-auto text-[10px] text-muted-foreground">deeper</span></DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function supportsEffortControl(deployment?: DeploymentRecord) {
  if (!deployment) return false;
  const identity = `${deployment.name} ${deployment.modelName ?? ""}`;
  if (deployment.protocol === "anthropic") return /claude[- ]?(?:fable|sonnet|opus)?[- ]?5/i.test(identity);
  if (deployment.capabilities.reasoningEffort !== true || /flash/i.test(identity)) return false;
  return !(deployment.protocol === "chat" && /kimi/i.test(identity));
}

function effortLabel(effort: ReasoningEffort) {
  return effort === "none" ? "Off" : effort.charAt(0).toUpperCase() + effort.slice(1);
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
          const vision = supportsNativeVisualInput(item);
          return (
          <SelectItem key={item.id} value={item.name} disabled={!runnable} textValue={item.name} className="min-w-0 items-start">
            <div className="min-w-0 max-w-full py-0.5">
              <p className="break-all text-xs font-medium leading-4">
                {item.name}{!item.enabled ? " · disabled" : item.protocol === "auto" ? " · probe required" : ""}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {protocolLabel(item.protocol)}{vision ? " · Vision" : ""}{item.capabilities.reasoning ? " · Reasoning" : ""}{item.modelName ? ` · ${item.modelName}` : ""}
              </p>
            </div>
          </SelectItem>
        ); })}
        {!options.length && <SelectItem value="__no-enabled-models" disabled>No enabled models</SelectItem>}
      </SelectContent>
    </Select>
  );
}

function ModelCapabilityCue({ deployment }: { deployment?: DeploymentRecord }) {
  if (!deployment) return null;
  const vision = supportsNativeVisualInput(deployment);
  const label = vision ? "Vision" : deployment.capabilities.reasoning ? "Reasoning" : "Text";
  const detail = deployment.capabilities.lastProbeOk === false ? "needs attention" : protocolLabel(deployment.protocol);
  return (
    <span className={cn("hidden items-center gap-1 rounded-full px-2 py-1 font-mono text-[9px] sm:inline-flex", vision ? "bg-emerald-700/9 text-emerald-800 dark:text-emerald-300" : "bg-muted/70 text-muted-foreground")} title={`${label} · ${detail}`}>
      {vision ? <Eye className="size-3" /> : <Gauge className="size-3" />}
      {label}
    </span>
  );
}

function canChatWithDeployment(deployment: DeploymentRecord) {
  if (!deployment.enabled || deployment.protocol === "auto") return false;
  return deployment.capabilities.textGeneration !== false && deployment.capabilities.streaming !== false;
}

const ANSWER_TEXT_SIZE_CLASSES: Record<AnswerTextSize, string> = {
  compact: "text-[14px] leading-[1.7] sm:text-[15px]",
  comfortable: "text-[15px] leading-7 sm:text-[16px] sm:leading-[1.75]",
  large: "text-[17px] leading-[1.75] sm:text-[18px] sm:leading-[1.8]",
};

function ChatMessage({ message, generation, preparations, isStreaming, isLatestUser, branchBusy, answerTextSize, onRegenerate, onRemember, onBranch, onEdit }: {
  message: WorkbenchMessage; generation?: GenerationRecord; preparations: GenerationRecord[]; isStreaming: boolean; isLatestUser: boolean; branchBusy: boolean;
  answerTextSize: AnswerTextSize;
  onRegenerate: () => void; onRemember: () => void; onBranch: () => void; onEdit: () => void;
}) {
  const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const attachments = message.metadata?.attachments ?? [];
  const hasRenderableAssistantContent = message.parts.some((part) => part.type !== "text" || part.text.trim());
  return (
    <Message from={message.role} className="scroll-mt-24">
      <MessageContent className={message.role === "assistant" ? cn("atelier-response w-full rounded-r-2xl px-5 py-4 font-conversation sm:px-6 sm:py-5 [&_h1]:text-[1.8rem] [&_h1]:leading-tight [&_h2]:mt-8 [&_h2]:text-[1.45rem] [&_h2]:leading-snug [&_h3]:mt-6 [&_h3]:text-[1.12rem] [&_h3]:leading-snug", ANSWER_TEXT_SIZE_CLASSES[answerTextSize]) : "rounded-2xl rounded-br-md border border-border/65 bg-card/90 px-4 py-3 text-[14px] leading-6 shadow-[0_1px_2px_oklch(0.2_0.02_65/0.04)]"}>
        {message.role === "user" && attachments.length > 0 && <SentMessageAttachments attachments={attachments} />}
        {message.role === "assistant" && !isStreaming && !hasRenderableAssistantContent
          ? <p className="text-sm italic text-muted-foreground">No response content was returned.</p>
          : renderMessageParts(message, isStreaming)}
      </MessageContent>
      <MessageActions
        aria-label={message.role === "user" ? "Message actions" : "Response actions"}
        className={cn(
          "transition-opacity focus-within:opacity-100",
          isLatestUser ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          message.role === "user" && "justify-end",
        )}
      >
        <MessageAction tooltip="Copy" onClick={() => { void navigator.clipboard.writeText(text); toast.success("Copied"); }}><Copy /></MessageAction>
        {message.role === "user" && (
          <MessageAction className="px-2 text-xs" size="sm" tooltip="Edit message" onClick={onEdit}>
            <Pencil />
            <span aria-hidden="true">Edit</span>
          </MessageAction>
        )}
        <MessageAction className="px-2 text-xs" size="sm" tooltip="Branch from here" onClick={onBranch}>
          {branchBusy ? <Loader2 className="animate-spin" /> : <GitBranch />}
          <span aria-hidden="true">Branch</span>
        </MessageAction>
        <MessageAction tooltip="Remember this" onClick={onRemember}><Brain /></MessageAction>
        {message.role === "assistant" && <MessageAction tooltip="Regenerate" onClick={onRegenerate}><RotateCcw /></MessageAction>}
      </MessageActions>
      {message.role === "assistant" && generation && <GenerationReceipt generation={generation} preparations={preparations} />}
    </Message>
  );
}

function SentMessageAttachments({ attachments }: { attachments: MessageAttachmentRecord[] }) {
  return (
    <div className="mb-2.5 flex max-w-full flex-wrap gap-1.5" aria-label={`${attachments.length} attachment${attachments.length === 1 ? "" : "s"} on this message`}>
      {attachments.map((attachment) => (
        <div key={`${attachment.fileId}-${attachment.mode}`} className="flex max-w-[260px] items-center gap-2 rounded-xl border border-border/65 bg-background/55 py-1.5 pl-1.5 pr-2.5">
          {isImageFile(attachment)
            ? <div role="img" aria-label={`Preview of ${attachment.originalName}`} className="size-8 shrink-0 rounded-lg border bg-cover bg-center" style={{ backgroundImage: `url(/api/files/${encodeURIComponent(attachment.fileId)}?content=1)` }} />
            : <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/80"><FileText className="size-3.5 text-muted-foreground" /></div>}
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium leading-4" title={attachment.originalName}>{attachment.originalName}</p>
            <p className="truncate text-[9px] leading-3.5 text-muted-foreground">{attachmentModeLabel(attachment.mode, attachment.preparationDeployment)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function GenerationReceipt({ generation, preparations }: { generation: GenerationRecord; preparations: GenerationRecord[] }) {
  const totalPreparationInput = preparations.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0);
  const cacheLabel = generation.cacheStatus === "hit" ? `${formatTokens(generation.cacheReadTokens)} reused`
    : generation.cacheStatus === "written" ? `${formatTokens(generation.cacheWriteTokens)} cached`
      : generation.cacheStatus === "not-reused" ? "No reuse this turn" : "Not reported";
  return (
    <details className="group/receipt mt-0.5 w-fit max-w-full rounded-lg border border-transparent px-1.5 py-0.5 text-[10px] text-muted-foreground open:w-full open:border-border/45 open:bg-card/25 open:px-2.5 open:py-2">
      <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1.5 select-none" title="Generation details">
        <Gauge className="size-3" />
        <span className="max-w-44 truncate">{generation.deploymentId}</span>
        <span className="text-border">·</span>
        <span>{cacheLabel}</span>
        {(generation.thinkingTokens ?? 0) > 0 && <><span className="text-border">·</span><span>{formatTokens(generation.thinkingTokens)} thinking</span></>}
        {generation.durationMs && <><span className="hidden text-border sm:inline">·</span><span className="hidden sm:inline">{(generation.durationMs / 1_000).toFixed(1)}s</span></>}
        <ChevronDown className="size-3 transition-transform group-open/receipt:rotate-180" />
      </summary>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border/45 pt-2 font-mono text-[9px]">
        <ReceiptMetric label="Uncached input" value={formatTokens(generation.uncachedInputTokens ?? generation.inputTokens)} />
        <ReceiptMetric label="Cache read" value={formatTokens(generation.cacheReadTokens)} />
        <ReceiptMetric label="Cache write" value={formatTokens(generation.cacheWriteTokens)} />
        <ReceiptMetric label="Output" value={formatTokens(generation.outputTokens)} />
        <ReceiptMetric label="Thinking" value={formatTokens(generation.thinkingTokens)} />
        <ReceiptMetric label="Duration" value={generation.durationMs ? `${(generation.durationMs / 1_000).toFixed(1)}s` : "—"} />
        <ReceiptMetric label="Effort" value={String(generation.settings.reasoningEffort ?? "—")} />
        <ReceiptMetric label="Preparation" value={preparations.length ? `${preparations.length} call${preparations.length === 1 ? "" : "s"} · ${formatTokens(totalPreparationInput)}` : "None"} />
      </dl>
      {preparations.length > 0 && (
        <div className="mt-2 space-y-1.5 border-t border-border/45 pt-2">
          <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">Source preparation</p>
          {preparations.map((preparation) => (
            <details key={preparation.id} className="group/packet rounded-lg border border-border/55 bg-background/35 px-2.5 py-2">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px]">
                <FileText className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-foreground/85">{String(preparation.settings.fileName ?? "Prepared source")}</span>
                <span className="hidden font-mono sm:inline">{formatTokens(preparation.inputTokens)} → {formatTokens(preparation.outputTokens)}</span>
                <span className="font-mono">{preparation.durationMs ? `${(preparation.durationMs / 1_000).toFixed(1)}s` : preparation.status}</span>
                <ChevronDown className="size-3 transition-transform group-open/packet:rotate-180" />
              </summary>
              <div className="mt-2 border-t border-border/45 pt-2">
                <p className="mb-2 font-mono text-[9px] text-muted-foreground">{preparation.deploymentId} · {preparation.status === "complete" ? "packet saved" : preparation.status}</p>
                {preparation.outputText
                  ? <MessageResponse className="max-h-72 overflow-y-auto rounded-md bg-muted/20 p-2 text-[11px] leading-5 text-foreground/85">{normalizeMarkdownForDisplay(preparation.outputText)}</MessageResponse>
                  : <p className="text-[10px] leading-4">No packet text was saved for this older preparation.</p>}
              </div>
            </details>
          ))}
        </div>
      )}
    </details>
  );
}

function RequestProgress({ generation, preparations, deployment, attachments, responseStreaming, reasoningStreaming }: {
  generation?: GenerationRecord; preparations: GenerationRecord[]; deployment: string; attachments: MessageAttachmentRecord[]; responseStreaming: boolean; reasoningStreaming: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const fallbackStart = Date.now();
    const update = () => {
      const startedAt = generation?.startedAt ? Date.parse(generation.startedAt) : fallbackStart;
      setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1_000)));
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [generation?.startedAt]);
  const preparedAttachments = attachments.filter((attachment) => attachment.mode !== "direct");
  const activePreparation = preparations.find((item) => item.status === "streaming");
  const completedPreparations = preparations.filter((item) => item.status === "complete");
  const title = activePreparation
    ? "Preparing your source"
    : responseStreaming
      ? (reasoningStreaming ? "Reasoning details are arriving" : "Writing the answer")
      : completedPreparations.length
        ? `Prepared source ready · asking ${deployment}`
        : preparedAttachments.length
          ? "Starting source preparation"
          : `Connecting to ${deployment}`;
  const subtitle = activePreparation
    ? `${String(activePreparation.settings.fileName ?? "Attached source")} · ${activePreparation.deploymentId}`
    : preparedAttachments.length
      ? "Two-stage request · preparation first, answer second"
      : "One-stage request";
  const steps = preparedAttachments.length ? [
    { label: "Source attached", state: "done" as const },
    { label: activePreparation ? `Building a faithful packet with ${activePreparation.deploymentId}` : completedPreparations.length ? `Packet ready · ${formatPreparationSummary(completedPreparations)}` : "Waiting for the preparation call", state: activePreparation ? "active" as const : completedPreparations.length ? "done" as const : "active" as const },
    { label: responseStreaming ? `${deployment} is writing the answer` : `${deployment} answers after preparation`, state: responseStreaming ? "active" as const : "pending" as const },
  ] : [
    { label: `${deployment} is preparing the response`, state: "active" as const },
  ];
  return (
    <div className="w-full max-w-xl rounded-2xl border border-border/65 bg-card/65 p-3.5 shadow-[0_12px_35px_-28px_oklch(0.15_0.03_50/0.5)] backdrop-blur" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-accent/55 text-accent-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><p className="text-sm font-medium text-foreground">{title}</p><span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">{elapsed}s</span></div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>
          <div className="mt-3 space-y-2">
            {steps.map((step) => <ProgressStep key={step.label} label={step.label} state={step.state} />)}
          </div>
          <p className="mt-3 border-t border-border/45 pt-2 text-[10px] leading-4 text-muted-foreground">Thinking tokens appear only when the provider reports them. These stages show the actual request workflow.</p>
        </div>
      </div>
    </div>
  );
}

function ProgressStep({ label, state }: { label: string; state: "done" | "active" | "pending" }) {
  return <div className={cn("flex items-center gap-2 text-[11px]", state === "pending" ? "text-muted-foreground/55" : "text-muted-foreground")}>
    <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", state === "done" ? "border-emerald-600/35 bg-emerald-600/10 text-emerald-600" : state === "active" ? "border-primary/35 bg-primary/8 text-primary" : "border-border/70")}>
      {state === "done" ? <Check className="size-2.5" /> : state === "active" ? <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" /> : null}
    </span>
    <span>{label}</span>
  </div>;
}

function formatPreparationSummary(preparations: GenerationRecord[]) {
  const duration = preparations.reduce((sum, item) => sum + (item.durationMs ?? 0), 0);
  const output = preparations.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0);
  return `${formatTokens(output)} packet tokens · ${(duration / 1_000).toFixed(1)}s`;
}

function ReceiptMetric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline gap-1"><dt className="text-muted-foreground/70">{label}</dt><dd className="text-foreground/85">{value}</dd></div>;
}

type SourcePart = SourceUrlUIPart | SourceDocumentUIPart;

function renderMessageParts(message: WorkbenchMessage, isStreaming: boolean): ReactNode[] {
  const rendered: ReactNode[] = [];
  const reasoningParts = message.parts.filter((part) => part.type === "reasoning");
  if (reasoningParts.length) {
    const reasoningStreaming = reasoningParts.some((part) => part.state === "streaming" || (part.state === undefined && isStreaming));
    rendered.push(
      <Reasoning className="w-full" isStreaming={reasoningStreaming} key={`${message.id}-reasoning`}>
        <ReasoningTrigger />
        <ReasoningContent>{reasoningParts.map((part) => part.text).join("\n\n")}</ReasoningContent>
      </Reasoning>
    );
  }

  for (let index = 0; index < message.parts.length; index += 1) {
    const part = message.parts[index];
    const key = `${message.id}-${index}-${part.type}`;

    if (part.type === "text") {
      rendered.push(<MessageResponse isAnimating={isStreaming && part.state !== "done"} key={key}>{message.role === "assistant" ? normalizeMarkdownForDisplay(part.text) : part.text}</MessageResponse>);
      continue;
    }

    if (part.type === "reasoning") {
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

function Sidebar({ projects, threads, activeProjectId, activeThreadId, managing, selectedIds, onProject, onThread, onNew, onSearch, onSettings, onToggleManaging, onToggleSelected, onSelectAll, onTrash, onOpenTrash, onCollapse }: {
  projects: ProjectRecord[]; threads: ThreadRecord[]; activeProjectId: string; activeThreadId: string;
  onProject: (id: string) => void; onThread: (id: string) => void; onNew: () => void; onSearch: () => void; onSettings: () => void;
  managing: boolean; selectedIds: string[]; onToggleManaging: () => void; onToggleSelected: (id: string) => void;
  onSelectAll: () => void; onTrash: () => void; onOpenTrash: () => void; onCollapse?: () => void;
}) {
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const selected = new Set(selectedIds);
  const allSelected = threads.length > 0 && selectedIds.length === threads.length;
  return (
    <div className="flex h-full flex-col p-3.5">
      <div className="mb-3 flex items-center gap-3 px-1.5 py-1">
        <div className="brand-mark grid size-9 shrink-0 place-items-center rounded-xl font-conversation text-base">L</div>
        <div className="min-w-0"><p className="truncate text-sm font-semibold tracking-[-0.015em]">Local AI</p><p className="text-[10px] text-muted-foreground">Private workbench</p></div>
        {onCollapse && <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="ml-auto size-8 shrink-0 rounded-lg text-muted-foreground" onClick={onCollapse} aria-label="Collapse sidebar"><PanelLeftClose className="size-4" /></Button></TooltipTrigger><TooltipContent side="right">Collapse sidebar</TooltipContent></Tooltip>}
      </div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="mb-2 h-auto w-full justify-between rounded-xl border border-transparent px-2.5 py-2 hover:border-border/70 hover:bg-background/60"><span className="min-w-0 text-left"><span className="block text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Project</span><span className="mt-0.5 block truncate text-sm">{activeProject?.name}</span></span><ChevronDown className="size-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent className="w-60" align="start">{projects.map((project) => <DropdownMenuItem key={project.id} onClick={() => onProject(project.id)}><Folder />{project.name}{project.id === activeProjectId && <Check className="ml-auto" />}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
      <Button onClick={onNew} className="h-10 justify-start rounded-xl shadow-sm"><Plus /> New conversation</Button>
      <Button onClick={onSearch} variant="ghost" className="mt-1.5 h-9 justify-start rounded-xl text-muted-foreground"><Search /> Search <kbd className="ml-auto rounded border border-border/70 bg-background/40 px-1.5 py-0.5 font-mono text-[9px]">⌘K</kbd></Button>
      <div className="mt-6 flex items-center justify-between gap-2 px-2"><span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Recent conversations</span><Button type="button" size="xs" variant="ghost" onClick={onToggleManaging}><ListChecks />{managing ? "Done" : "Manage"}</Button></div>
      <nav className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5" aria-label="Recent conversations">
        {threads.map((thread) => (
          <div key={thread.id} className="group/row relative flex items-center">
            {managing && <Checkbox checked={selected.has(thread.id)} onCheckedChange={() => onToggleSelected(thread.id)} className="ml-1 mr-1" aria-label={`Select ${thread.title}`} />}
            <button
              onClick={() => managing ? onToggleSelected(thread.id) : onThread(thread.id)}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[13px] transition-[background-color,color,transform] duration-150",
                thread.id === activeThreadId ? "bg-accent/75 text-accent-foreground shadow-sm" : "text-muted-foreground hover:translate-x-0.5 hover:bg-muted/75 hover:text-foreground"
              )}
            >
              {thread.parentThreadId ? <GitBranch className="size-3.5 shrink-0" /> : <MessageSquareText className="size-3.5 shrink-0" />}
              <span className="truncate">{thread.title}</span>
            </button>
          </div>
        ))}
      </nav>
      {managing && <div className="mb-2 space-y-2 rounded-xl border bg-card/70 p-2.5"><div className="flex items-center justify-between gap-2"><Button type="button" size="xs" variant="ghost" onClick={onSelectAll}><Check />{allSelected ? "Clear" : "Select all"}</Button><span className="text-[10px] text-muted-foreground">{selectedIds.length} selected</span></div><div className="grid grid-cols-2 gap-2"><Button type="button" size="sm" variant="outline" onClick={onOpenTrash}><Trash2 />Trash</Button><Button type="button" size="sm" variant="destructive" onClick={onTrash} disabled={!selectedIds.length}><Archive />Move ({selectedIds.length})</Button></div></div>}
      <Separator className="my-2" />
      <Button onClick={onSettings} variant="ghost" className="justify-start rounded-xl text-muted-foreground"><Settings /> Settings</Button>
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-emerald-700/10 bg-emerald-700/5 px-2.5 py-2 text-[10px] text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-600" /><span>Local only · 127.0.0.1</span><ShieldCheck className="ml-auto size-3" /></div>
    </div>
  );
}

function SidebarRail({ onExpand, onNew, onSearch, onSettings }: { onExpand: () => void; onNew: () => void; onSearch: () => void; onSettings: () => void }) {
  return (
    <div className="flex h-full flex-col items-center gap-1.5 py-3">
      <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl" onClick={onExpand} aria-label="Expand sidebar"><PanelLeftOpen className="size-4.5" /></Button></TooltipTrigger><TooltipContent side="right">Expand sidebar</TooltipContent></Tooltip>
      <Separator className="my-1 w-7" />
      <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl" onClick={onNew} aria-label="New conversation"><Plus className="size-4.5" /></Button></TooltipTrigger><TooltipContent side="right">New conversation</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl" onClick={onSearch} aria-label="Search conversations"><Search className="size-4.5" /></Button></TooltipTrigger><TooltipContent side="right">Search conversations</TooltipContent></Tooltip>
      <div className="flex-1" />
      <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl" onClick={onSettings} aria-label="Settings"><Settings className="size-4.5" /></Button></TooltipTrigger><TooltipContent side="right">Settings</TooltipContent></Tooltip>
      <span className="mt-1 size-1.5 rounded-full bg-emerald-600" title="Local only" />
    </div>
  );
}

function ContextPanel({ files, deployments, currentDeployment, selectedFileIds, setSelectedFileIds, attachmentSelections, setAttachmentSelections, selectedMemoryIds, setSelectedMemoryIds, uploadFiles, threadData, curateMemory, jobBusy, actOnMemory }: {
  files: FileRecord[]; deployments: DeploymentRecord[]; currentDeployment?: DeploymentRecord;
  selectedFileIds: string[]; setSelectedFileIds: React.Dispatch<React.SetStateAction<string[]>>;
  attachmentSelections: Record<string, AttachmentSelection>; setAttachmentSelections: React.Dispatch<React.SetStateAction<Record<string, AttachmentSelection>>>;
  selectedMemoryIds: string[]; setSelectedMemoryIds: React.Dispatch<React.SetStateAction<string[]>>;
  uploadFiles: (files: FileList | null) => Promise<void>;
  threadData: ThreadData | null; curateMemory: () => Promise<void>; jobBusy: boolean; actOnMemory: (action: "accept" | "reject" | "delete", id: string) => Promise<void>;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/70 bg-card/35 px-5 py-5"><p className="atelier-kicker text-[10px] font-medium text-muted-foreground">Evidence</p><p className="mt-1 font-conversation text-lg font-medium tracking-[-0.018em]">Sources, memory, and receipt</p><p className="mt-1 text-[13px] leading-5 text-muted-foreground">Review the context selected for your next request.</p></div>
      <Tabs defaultValue="files" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-3 grid grid-cols-3"><TabsTrigger value="files">Sources</TabsTrigger><TabsTrigger value="memory">Memory</TabsTrigger><TabsTrigger value="receipt">Receipt</TabsTrigger></TabsList>
        <TabsContent value="files" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-xs text-muted-foreground transition-colors hover:bg-muted"><Upload className="size-4" /> Add files or images<input type="file" multiple accept={ACCEPTED_FILES} className="sr-only" onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ""; }} /></label>
          <div className="mt-4 space-y-2">
            {!files.length && <EmptyNote>PDF, DOCX, text, Markdown, HTML, CSV, JSON, screenshots, and common image formats are supported.</EmptyNote>}
            {files.map((file) => {
              const selected = selectedFileIds.includes(file.id);
              const toggleReadyFile = () => {
                if (file.status !== "ready") return;
                setSelectedFileIds((ids) => (selected ? ids.filter((id) => id !== file.id) : [...ids, file.id]));
                setAttachmentSelections((current) => selected ? current : { ...current, [file.id]: current[file.id] ?? { fileId: file.id, mode: "direct" } });
              };
              return (
                <div
                  key={file.id}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    selected && "border-primary/45 bg-accent/25",
                  )}
                >
                  <Checkbox
                    checked={selected}
                    disabled={file.status !== "ready"}
                    className="mt-0.5"
                    onCheckedChange={() => toggleReadyFile()}
                    aria-label={`Select ${file.originalName}`}
                  />
                  <div className="min-w-0 flex-1">
                    <button type="button" className="block w-full text-left" disabled={file.status !== "ready"} onClick={toggleReadyFile}>
                      <span className="block truncate text-xs font-medium">{file.originalName}</span>
                      <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                        {file.status === "failed" ? file.error : file.status === "ready" ? file.summary || "Ready" : file.status === "extracting" ? "Extracting and indexing locally…" : "Queued for local extraction…"}
                      </span>
                      {(file.status === "queued" || file.status === "extracting") && <Progress value={file.status === "extracting" ? 55 : 12} className="mt-2 h-1" />}
                    </button>
                    {selected && file.status === "ready" && <div className="mt-2"><AttachmentModeMenu file={file} deployments={deployments} currentDeployment={currentDeployment} selection={attachmentSelections[file.id] ?? { fileId: file.id, mode: "direct" }} onSelection={(selection) => setAttachmentSelections((current) => ({ ...current, [file.id]: selection }))} compact /></div>}
                  </div>
                  <FileStatus status={file.status} />
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">Direct is the default. Visual sources require a compatible selected model; prepared sources use the preparation choice shown on each item. Large text sources may use relevant excerpts to fit model context.</p>
        </TabsContent>
        <TabsContent value="memory" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <Button onClick={curateMemory} disabled={jobBusy || !threadData?.messages.length} variant="outline" className="mt-2 w-full">{jobBusy ? <Loader2 className="animate-spin" /> : <Brain />} {jobBusy ? "Curating…" : "Curate memory"}</Button>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">Nothing is remembered or selected automatically. Curating proposes candidates; checked accepted memories are included in the next request.</p>
          {!!threadData?.candidates.filter((item) => item.status === "proposed").length && <SectionLabel>Needs review</SectionLabel>}
          {threadData?.candidates.filter((item) => item.status === "proposed").map((candidate) => <div key={candidate.id} className="mt-2 rounded-lg border bg-card p-3"><div className="flex items-center gap-2"><Badge variant="secondary" className="font-mono text-[9px]">{candidate.type}</Badge><span className="ml-auto font-mono text-[9px] text-muted-foreground">{Math.round(candidate.confidence * 100)}%</span></div><p className="mt-2 text-xs font-medium">{candidate.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{candidate.content}</p><div className="mt-3 flex gap-1"><Button size="xs" onClick={() => void actOnMemory("accept", candidate.id)}><Check /> Accept</Button><Button size="xs" variant="ghost" onClick={() => void actOnMemory("reject", candidate.id)}><X /> Reject</Button></div></div>)}
          {!!threadData?.memories.length && <div className="mt-6 flex items-center gap-2"><SectionLabel className="mt-0">Accepted</SectionLabel><span className="ml-auto text-[9px] text-muted-foreground">~{estimateMemoryTokens(threadData.memories.filter((memory) => selectedMemoryIds.includes(memory.id)))} tokens selected</span><Button size="xs" variant="ghost" onClick={() => setSelectedMemoryIds(selectedMemoryIds.length === threadData.memories.length ? [] : threadData.memories.map((memory) => memory.id))}>{selectedMemoryIds.length === threadData.memories.length ? "Clear" : "Select all"}</Button></div>}
          {threadData?.memories.map((memory) => {
            const selected = selectedMemoryIds.includes(memory.id);
            return <div key={memory.id} className={cn("mt-2 rounded-lg border p-3 transition-colors", selected && "border-primary/40 bg-accent/20")}><div className="flex items-center gap-2"><Checkbox checked={selected} onCheckedChange={() => setSelectedMemoryIds((ids) => selected ? ids.filter((id) => id !== memory.id) : [...ids, memory.id])} aria-label={`Use ${memory.title} in the next message`} /><Badge variant="outline" className="font-mono text-[9px]">{memory.type}</Badge><Button size="icon-xs" variant="ghost" className="ml-auto" onClick={() => void actOnMemory("delete", memory.id)} aria-label={`Delete ${memory.title}`}><Trash2 /></Button></div><p className="mt-2 text-xs font-medium">{memory.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{memory.content}</p><p className="mt-2 font-mono text-[9px] text-muted-foreground">{memory.scope} · {memory.explicit ? "explicit" : "inferred"}</p></div>;
          })}
          {!threadData?.memories.length && !threadData?.candidates.some((item) => item.status === "proposed") && <EmptyNote>No accepted memory in this conversation.</EmptyNote>}
        </TabsContent>
        <TabsContent value="receipt" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {!threadData?.receipt ? <EmptyNote>Send a message to create a context receipt.</EmptyNote> : <Receipt receipt={threadData.receipt} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ComposerContextSummary({ files, selectedFileIds, selections, selectedMemoryIds, deployment }: {
  files: FileRecord[]; selectedFileIds: string[]; selections: Record<string, AttachmentSelection>; selectedMemoryIds: string[]; deployment?: DeploymentRecord;
}) {
  const selectedFiles = files.filter((file) => selectedFileIds.includes(file.id));
  const directFiles = selectedFiles.filter((file) => (selections[file.id]?.mode ?? "direct") === "direct");
  const preparedFiles = selectedFiles.filter((file) => (selections[file.id]?.mode ?? "direct") !== "direct");
  const directVisualFiles = directFiles.filter(isVisualAttachment);
  const pieces = [
    directFiles.length ? `${directFiles.length} direct source${directFiles.length === 1 ? "" : "s"}` : "",
    preparedFiles.length ? `${preparedFiles.length} prepared source${preparedFiles.length === 1 ? "" : "s"}` : "",
    selectedMemoryIds.length ? `${selectedMemoryIds.length} selected memor${selectedMemoryIds.length === 1 ? "y" : "ies"}` : "",
  ].filter(Boolean);
  const visualNeedsCompatibility = directVisualFiles.length > 0 && !supportsNativeVisualInput(deployment);

  return (
    <p className="mx-auto mt-2 flex max-w-[720px] items-center gap-1.5 px-1 text-[11px] leading-4 text-muted-foreground" aria-live="polite">
      <span className={cn("size-1.5 shrink-0 rounded-full", visualNeedsCompatibility ? "bg-amber-600" : "bg-emerald-700/75")} aria-hidden />
      {pieces.length ? <span>Next request: {pieces.join(" · ")}{visualNeedsCompatibility ? " · visual source needs a compatible model" : ""}</span> : <span>Next request: no additional sources or memories selected.</span>}
    </p>
  );
}

function AttachmentChip({ file, deployments, currentDeployment, selection, onSelection, onRemove }: {
  file: FileRecord; deployments: DeploymentRecord[]; currentDeployment?: DeploymentRecord; selection: AttachmentSelection;
  onSelection: (selection: AttachmentSelection) => void; onRemove: () => void;
}) {
  const incompatible = selection.mode === "direct" && isVisualAttachment(file) && !supportsNativeVisualInput(currentDeployment);
  const textPreparation = findTextPreparationDeployment(deployments);
  const visualPreparation = findVisualPreparationDeployment(deployments);
  const visual = isVisualAttachment(file);
  return (
    <div className={cn("w-[260px] shrink-0 rounded-xl border bg-card p-2 shadow-sm", incompatible && "border-amber-500/40 bg-amber-500/5")}>
      <div className="flex items-center gap-2">
        {isImageFile(file)
          ? <div role="img" aria-label={`Preview of ${file.originalName}`} className="size-9 shrink-0 rounded-lg border bg-cover bg-center" style={{ backgroundImage: `url(/api/files/${encodeURIComponent(file.id)}?content=1)` }} />
          : <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><FileText className="size-4 text-muted-foreground" /></div>}
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={file.originalName}>{file.originalName}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{file.status === "ready" ? incompatible ? "Choose an image-capable model or prepare first" : "Ready for your next message" : file.status === "failed" ? file.error || "Preparation failed" : "Preparing source…"}</p></div>
        <button type="button" onClick={onRemove} className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${file.originalName}`}><X className="size-3" /></button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-0.5" aria-label={`How to use ${file.originalName}`}>
        <button type="button" onClick={() => onSelection({ fileId: file.id, mode: "direct" })} className={cn("rounded-md px-2 py-1 text-[10px] transition-colors", selection.mode === "direct" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><Eye className="mr-1 inline size-3" />Direct</button>
        {!visual ? (
          <button type="button" disabled={!textPreparation} title={textPreparation ? "Prepare a query-focused source packet with DeepSeek V4 Flash" : "V4 Flash is not enabled"} onClick={() => textPreparation && onSelection({ fileId: file.id, mode: "prepare-text", preparationDeployment: textPreparation.name })} className={cn("rounded-md px-2 py-1 text-[10px] transition-colors disabled:opacity-45", selection.mode === "prepare-text" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><Sparkles className="mr-1 inline size-3" />V4 Flash</button>
        ) : (
          <button type="button" disabled={!visualPreparation} title={visualPreparation ? `Prepare a visual packet with ${visualPreparation.name}` : "Enable an image-capable deployment, then sync"} onClick={() => visualPreparation && onSelection({ fileId: file.id, mode: "prepare-visual", preparationDeployment: visualPreparation.name })} className={cn("rounded-md px-2 py-1 text-[10px] transition-colors disabled:opacity-45", selection.mode === "prepare-visual" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><Sparkles className="mr-1 inline size-3" />Prepare</button>
        )}
      </div>
    </div>
  );
}

function UploadingAttachmentChip({ file }: { file: UploadingAttachment }) {
  return <div className="flex w-[220px] shrink-0 items-center gap-2 rounded-xl border bg-card p-2 shadow-sm"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted"><Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" /></div><div className="min-w-0"><p className="truncate text-xs font-medium">{file.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">Uploading and preparing…</p></div></div>;
}

function AttachmentModeMenu({ file, deployments, currentDeployment, selection, onSelection, compact = false }: {
  file: FileRecord; deployments: DeploymentRecord[]; currentDeployment?: DeploymentRecord; selection: AttachmentSelection;
  onSelection: (selection: AttachmentSelection) => void; compact?: boolean;
}) {
  const textPreparation = findTextPreparationDeployment(deployments);
  const visualPreparation = findVisualPreparationDeployment(deployments);
  const visual = isVisualAttachment(file);
  const nativeCompatible = supportsNativeVisualInput(currentDeployment);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs" className={cn("h-6 max-w-40 gap-1 px-1.5 text-[9px] font-normal", compact && "max-w-32", selection.mode === "direct" && visual && !nativeCompatible && "text-amber-700 dark:text-amber-300")}>
          {selection.mode === "direct" ? <Eye className="size-3" /> : <Sparkles className="size-3" />}
          <span className="truncate">{selection.mode === "direct" && visual && !nativeCompatible ? "Needs visual model" : attachmentModeLabel(selection.mode, selection.preparationDeployment)}</span>
          <ChevronDown className="size-2.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem onClick={() => onSelection({ fileId: file.id, mode: "direct" })}>
          <Eye /><span><span className="block text-xs">Direct</span><span className="block text-[10px] text-muted-foreground">{visual ? "Original file to the selected image-capable model" : "Extracted text; large sources use relevant excerpts"}</span></span>{selection.mode === "direct" && <Check className="ml-auto" />}
        </DropdownMenuItem>
        {!isImageFile(file) && <DropdownMenuItem disabled={!textPreparation} onClick={() => textPreparation && onSelection({ fileId: file.id, mode: "prepare-text", preparationDeployment: textPreparation.name })}>
          <FileText /><span><span className="block text-xs">Prepare with V4 Flash</span><span className="block text-[10px] text-muted-foreground">{textPreparation ? "Query-focused working packet" : "Deploy or enable V4 Flash first"}</span></span>{selection.mode === "prepare-text" && <Check className="ml-auto" />}
        </DropdownMenuItem>}
        {visual && <DropdownMenuItem disabled={!visualPreparation} onClick={() => visualPreparation && onSelection({ fileId: file.id, mode: "prepare-visual", preparationDeployment: visualPreparation.name })}>
          <FileImage /><span><span className="block text-xs">Prepare{visualPreparation ? ` with ${visualPreparation.name}` : " visually"}</span><span className="block text-[10px] text-muted-foreground">{visualPreparation ? "Azure visual transcription and source packet" : "Enable an image-capable deployment, then sync"}</span></span>{selection.mode === "prepare-visual" && <Check className="ml-auto" />}
        </DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RememberDialog({ draft, setDraft, saving, onSave }: {
  draft: RememberDraft | null; setDraft: React.Dispatch<React.SetStateAction<RememberDraft | null>>; saving: boolean; onSave: () => Promise<void>;
}) {
  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) setDraft(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Remember this</DialogTitle><DialogDescription>Review the memory before saving it. It will be selected for the next message, but never used silently later.</DialogDescription></DialogHeader>
        {draft && <div className="grid gap-4 py-2">
          <div className="grid gap-1.5"><Label htmlFor="memory-title">Title</Label><Input id="memory-title" value={draft.title} onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="memory-content">Memory</Label><Textarea id="memory-content" value={draft.content} onChange={(event) => setDraft((current) => current ? { ...current, content: event.target.value } : current)} className="min-h-32" /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label>Type</Label><Select value={draft.type} onValueChange={(value) => setDraft((current) => current ? { ...current, type: value as MemoryType } : current)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{MEMORY_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label>Scope</Label><Select value={draft.scope} onValueChange={(value) => setDraft((current) => current ? { ...current, scope: value as RememberDraft["scope"] } : current)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="conversation">Conversation</SelectItem><SelectItem value="project">Project</SelectItem></SelectContent></Select></div>
            <div className="grid gap-1.5"><Label>Sensitivity</Label><Select value={draft.sensitivity} onValueChange={(value) => setDraft((current) => current ? { ...current, sensitivity: value as RememberDraft["sensitivity"] } : current)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">Normal</SelectItem><SelectItem value="sensitive">Sensitive</SelectItem></SelectContent></Select></div>
          </div>
        </div>}
        <DialogFooter><Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button><Button type="button" onClick={() => void onSave()} disabled={saving || !draft?.title.trim() || !draft?.content.trim()}>{saving ? <Loader2 className="animate-spin" /> : <Save />} Save memory</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditMessageDialog({ draft, setDraft, saving, onSave }: {
  draft: EditMessageDraft | null;
  setDraft: React.Dispatch<React.SetStateAction<EditMessageDraft | null>>;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open && !saving) setDraft(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit message</DialogTitle>
          <DialogDescription>This updates the current conversation from this turn onward. Use Branch when you want to preserve both paths.</DialogDescription>
        </DialogHeader>
        {draft && (
          <div className="grid gap-3 py-2">
            <Label htmlFor="edit-message">Revised message</Label>
            <Textarea
              id="edit-message"
              autoFocus
              value={draft.text}
              onChange={(event) => setDraft((current) => current ? { ...current, text: event.target.value } : current)}
              className="min-h-32 resize-y"
            />
            {draft.laterMessageCount > 0 && <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-muted-foreground">Updating this message removes {draft.laterMessageCount} later message{draft.laterMessageCount === 1 ? "" : "s"} and generates a new answer here.</p>}
            {draft.attachments.length > 0 && <p className="text-xs leading-5 text-muted-foreground">{draft.attachments.length} attachment{draft.attachments.length === 1 ? " stays" : "s stay"} with this message.</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={onSave} disabled={saving || !draft?.text.trim()}>{saving ? <Loader2 className="animate-spin" /> : <RotateCcw />} Update & regenerate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Receipt({ receipt }: { receipt: Record<string, unknown> }) {
  const memories = parseJsonArray(receipt.memory_ids_json); const chunks = parseJsonArray(receipt.file_chunk_ids_json);
  return <div className="mt-3 space-y-4"><div className="rounded-lg border bg-card p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-600" /><p className="text-xs font-medium">Context recorded</p></div><dl className="mt-4 grid grid-cols-3 gap-2 text-center"><div><dt className="font-mono text-lg">{memories.length}</dt><dd className="text-[9px] text-muted-foreground">MEMORIES</dd></div><div><dt className="font-mono text-lg">{chunks.length}</dt><dd className="text-[9px] text-muted-foreground">CHUNKS</dd></div><div><dt className="font-mono text-lg">{String(receipt.estimated_tokens ?? 0)}</dt><dd className="text-[9px] text-muted-foreground">EST. TOKENS</dd></div></dl></div><details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs font-medium">Exact rendered context</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-5 text-muted-foreground">{String(receipt.rendered_context || "No additional context.")}</pre></details></div>;
}

function CommandPalette({ open, setOpen, boot, onThread, onProject, onNew, onSettings }: { open: boolean; setOpen: (open: boolean) => void; boot: BootstrapData; onThread: (id: string) => void; onProject: (id: string) => void; onNew: () => void; onSettings: () => void }) {
  const run = (action: () => void) => { action(); setOpen(false); };
  return <CommandDialog open={open} onOpenChange={setOpen}><CommandInput placeholder="Search conversations, projects, files, or actions…" /><CommandList><CommandEmpty>No local result found.</CommandEmpty><CommandGroup heading="Actions"><CommandItem onSelect={() => run(onNew)}><Plus /> New conversation</CommandItem><CommandItem onSelect={() => run(onSettings)}><Settings /> Settings</CommandItem></CommandGroup><CommandSeparator /><CommandGroup heading="Conversations">{boot.threads.slice(0, 30).map((thread) => <CommandItem key={thread.id} value={`${thread.title} conversation`} onSelect={() => run(() => onThread(thread.id))}>{thread.parentThreadId ? <GitBranch /> : <MessageSquareText />}{thread.title}</CommandItem>)}</CommandGroup><CommandGroup heading="Projects">{boot.projects.map((project) => <CommandItem key={project.id} value={`${project.name} project`} onSelect={() => run(() => onProject(project.id))}><Folder />{project.name}</CommandItem>)}</CommandGroup><CommandGroup heading="Files">{boot.files.map((file) => <CommandItem key={file.id} value={`${file.originalName} file`}><FileText />{file.originalName}</CommandItem>)}</CommandGroup></CommandList></CommandDialog>;
}

function FileStatus({ status }: { status: FileRecord["status"] }) { if (status === "ready") return <Check className="size-3.5 text-emerald-600" />; if (status === "failed") return <CircleAlert className="size-3.5 text-destructive" />; return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />; }
function EmptyNote({ children }: { children: React.ReactNode }) { return <div className="mt-6 rounded-lg border border-dashed p-5 text-center text-xs leading-5 text-muted-foreground">{children}</div>; }
function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) { return <p className={cn("mt-6 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground", className)}>{children}</p>; }
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
function toUIMessage(message: MessageRecord): WorkbenchMessage { return { id: message.id, role: message.role, metadata: { attachments: message.attachments }, parts: [{ type: "text", text: message.content }] }; }
function protocolLabel(protocol: DeploymentRecord["protocol"]) { if (protocol === "responses") return "Responses"; if (protocol === "chat") return "Chat Completions"; if (protocol === "deepseek") return "DeepSeek chat"; if (protocol === "anthropic") return "Anthropic / Claude"; return "Probe required"; }
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
function attachmentCompatibilityIssue(selectedFileIds: string[], selections: Record<string, AttachmentSelection>, files: FileRecord[], deployment?: DeploymentRecord) {
  const incompatible = selectedFileIds.map((id) => files.find((file) => file.id === id)).filter((file): file is FileRecord => Boolean(file))
    .find((file) => (selections[file.id]?.mode ?? "direct") === "direct" && isVisualAttachment(file) && !supportsNativeVisualInput(deployment));
  return incompatible ? `${incompatible.originalName} needs an image-capable model. Choose one from the model menu, sync your deployments, or explicitly prepare it first.` : "";
}
function estimateMemoryTokens(memories: MemoryRecord[]) { return Math.ceil(memories.reduce((sum, memory) => sum + memory.title.length + memory.content.length + 24, 0) / 4); }
function formatTokens(value: number | null | undefined) { return value === null || value === undefined ? "—" : value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K` : String(value); }
function parseJsonArray(value: unknown) { try { const result = JSON.parse(String(value ?? "[]")); return Array.isArray(result) ? result : []; } catch { return []; } }
async function requestJson<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, init); const data = await response.json(); if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`); return data as T; }
async function waitForJob(id: string) { for (let index = 0; index < 300; index += 1) { const { job } = await requestJson<{ job: Record<string, unknown> }>(`/api/jobs/${id}`); if (job.status === "completed") return; if (job.status === "failed" || job.status === "cancelled") throw new Error(String(job.error || "Background job failed.")); await new Promise((resolve) => setTimeout(resolve, 1_000)); } throw new Error("The local worker did not finish in time."); }
