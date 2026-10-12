"use client";
import { Dialog } from "radix-ui";
import { X, LoaderCircle } from "lucide-react";
import { Streamdown } from "streamdown";
import type { ReactNode } from "react";
export async function api<T>(
  path: string,
  data?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(
    "/api/" + path,
    data === undefined
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={"modal " + (wide ? "modal-wide" : "")}>
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description || "Review and edit your selection."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Markdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  return (
    <div className="markdown">
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        controls={false}
        components={{
          img: ({ alt }) => (
            <span className="muted">[Image: {alt || "external image"}]</span>
          ),
        }}
      >
        {children}
      </Streamdown>
    </div>
  );
}
export function Busy({ label = "Working…" }: { label?: string }) {
  return (
    <span className="inline-status">
      <LoaderCircle size={14} className="spin" />
      {label}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function relativeDate(value: string) {
  const date = new Date(value),
    days = Math.floor((Date.now() - date.getTime()) / 86400000);
  return days === 0
    ? "Today"
    : days === 1
      ? "Yesterday"
      : date.toLocaleDateString("en-GB", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
}
export function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
    ...(withTime
      ? ({ hour: "2-digit", minute: "2-digit", timeZoneName: "short" } as const)
      : {}),
  }).format(new Date(value));
}
