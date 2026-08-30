"use client";

import { useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { Clipboard, Download, ListChecks, MessageCircleQuestion, MessageSquareText, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  conversationExportFilename,
  conversationMessagesToMarkdown,
  selectConversationMessages,
  type ConversationExportMessage,
  type ConversationExportPreset,
} from "@/lib/conversation-export";

export type ConversationExportDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: UIMessage[];
  title?: string;
};

export function ConversationExportDialog({ open, setOpen, messages, title = "Conversation" }: ConversationExportDialogProps) {
  const exportMessages = useMemo<ConversationExportMessage[]>(
    () => messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.parts.filter((part) => part.type === "text").map((part) => part.text).join(""),
    })),
    [messages],
  );
  const [preset, setPreset] = useState<ConversationExportPreset>("all");
  // null represents the initial all-messages selection. This avoids syncing
  // derived props into state in an effect on every conversation update.
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [copied, setCopied] = useState(false);

  const currentSelection = useMemo(
    () => selectedIds ?? new Set(exportMessages.map((message) => message.id)),
    [exportMessages, selectedIds],
  );

  const selected = useMemo(
    () => selectConversationMessages(exportMessages, preset, currentSelection),
    [currentSelection, exportMessages, preset],
  );
  const markdown = useMemo(() => conversationMessagesToMarkdown(selected, title), [selected, title]);
  const selectedCount = selected.length;

  function choosePreset(next: ConversationExportPreset) {
    setPreset(next);
    if (next === "all") setSelectedIds(new Set(exportMessages.map((message) => message.id)));
    if (next === "questions") setSelectedIds(new Set(exportMessages.filter((message) => message.role === "user").map((message) => message.id)));
    if (next === "answers") setSelectedIds(new Set(exportMessages.filter((message) => message.role === "assistant").map((message) => message.id)));
  }

  function toggleMessage(id: string, checked: boolean) {
    setPreset("custom");
    setSelectedIds((current) => {
      const next = new Set(current ?? exportMessages.map((message) => message.id));
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function selectAll() {
    setPreset("custom");
    setSelectedIds(new Set(exportMessages.map((message) => message.id)));
  }

  function clearSelection() {
    setPreset("custom");
    setSelectedIds(new Set());
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      toast.success("Markdown copied");
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error("Could not copy Markdown");
    }
  }

  function downloadMarkdown() {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = conversationExportFilename(title);
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success("Markdown downloaded");
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setPreset("all");
      setSelectedIds(null);
    }
    setOpen(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="grid max-h-[90dvh] min-h-0 w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 pr-12 sm:px-6">
          <DialogTitle>Export conversation</DialogTitle>
          <DialogDescription>Choose the questions and answers to keep. Markdown inside each message stays unchanged.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Export presets">
            {(["all", "questions", "answers", "custom"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={preset === value ? "secondary" : "ghost"}
                onClick={() => choosePreset(value)}
              >
                {value === "all" ? <ListChecks /> : value === "questions" ? <MessageCircleQuestion /> : value === "answers" ? <MessageSquareText /> : <RotateCcw />}
                {value === "all" ? "All" : value === "questions" ? "Questions" : value === "answers" ? "Answers" : "Custom"}
              </Button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">{selectedCount} of {exportMessages.length} selected</span>
          </div>

          <div className="mt-3 flex gap-1.5">
            <Button type="button" size="xs" variant="outline" onClick={selectAll}>Select all</Button>
            <Button type="button" size="xs" variant="ghost" onClick={clearSelection}>Clear</Button>
          </div>

          <div className="mt-4 space-y-1.5">
            {exportMessages.map((message, index) => {
              const checked = currentSelection.has(message.id);
              const label = message.role === "user" ? "Question" : message.role === "assistant" ? "Answer" : "System";
              return (
                <label key={message.id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50", checked && "border-primary/40 bg-accent/20")}>
                  <Checkbox checked={checked} onCheckedChange={(value) => toggleMessage(message.id, value === true)} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-xs font-medium"><span>{label}</span><span className="font-mono text-[10px] text-muted-foreground">#{index + 1}</span></span>
                    <span className="mt-1 block whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{message.content || "(no text)"}</span>
                  </span>
                </label>
              );
            })}
            {!exportMessages.length && <p className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">There are no messages to export yet.</p>}
          </div>

          <details className="mt-4 rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Preview Markdown</summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t px-3 py-3 font-mono text-[10px] leading-5 text-muted-foreground">{markdown || "Nothing selected."}</pre>
          </details>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => void copyMarkdown()} disabled={!selectedCount}><Clipboard />{copied ? "Copied" : "Copy Markdown"}</Button>
            <Button type="button" onClick={downloadMarkdown} disabled={!selectedCount}><Download />Download .md</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
