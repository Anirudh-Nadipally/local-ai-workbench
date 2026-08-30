"use client";

import { useMemo, useState } from "react";
import { ArchiveRestore, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ThreadRecord } from "@/lib/types";

export function ConversationTrashDialog({
  open,
  setOpen,
  threads,
  loading,
  onRestore,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  threads: ThreadRecord[];
  loading: boolean;
  onRestore: (ids: string[]) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(false);
  const allSelected = threads.length > 0 && selectedIds.length === threads.length;
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  async function restore() {
    if (!selectedIds.length || restoring) return;
    setRestoring(true);
    try {
      await onRestore(selectedIds);
      setSelectedIds([]);
    } finally { setRestoring(false); }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setSelectedIds([]);
    setOpen(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="grid max-h-[82dvh] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conversation trash</DialogTitle>
          <DialogDescription>These conversations are hidden, not erased. Restore any of them with their messages intact.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {loading ? <p className="py-8 text-center text-xs text-muted-foreground">Loading trash…</p> : threads.length ? (
            <div className="space-y-2">
              <Button type="button" size="xs" variant="ghost" onClick={() => setSelectedIds(allSelected ? [] : threads.map((thread) => thread.id))}>
                <Check /> {allSelected ? "Clear" : "Select all"}
              </Button>
              {threads.map((thread) => (
                <label key={thread.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/45">
                  <Checkbox checked={selected.has(thread.id)} onCheckedChange={(checked) => setSelectedIds((ids) => checked === true ? [...ids, thread.id] : ids.filter((id) => id !== thread.id))} className="mt-0.5" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{thread.title}</span><span className="mt-1 block text-[10px] text-muted-foreground">Moved {thread.deletedAt ? new Date(thread.deletedAt).toLocaleString() : "to trash"}</span></span>
                </label>
              ))}
            </div>
          ) : <div className="grid place-items-center gap-2 rounded-lg border border-dashed py-10 text-center text-muted-foreground"><Trash2 className="size-5" /><p className="text-xs">Trash is empty.</p></div>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>Close</Button>
          <Button type="button" onClick={() => void restore()} disabled={!selectedIds.length || restoring}><ArchiveRestore />{restoring ? "Restoring…" : `Restore${selectedIds.length ? ` (${selectedIds.length})` : ""}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
