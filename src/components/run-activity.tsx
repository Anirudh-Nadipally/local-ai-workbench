"use client";
import { useEffect, useState } from "react";
import type { Model, Effort, RunActivity } from "@/domain/types";
import { effortLabel } from "@/domain/reasoning";
import { Markdown } from "./ui";

export function EffortSelect({
  model,
  value,
  onChange,
  disabled = false,
}: {
  model?: Model;
  value: Effort;
  onChange: (value: Effort) => void;
  disabled?: boolean;
}) {
  const options = model?.reasoning?.efforts || [];
  return (
    <label className="effort-control">
      <span>Effort</span>
      <select
        aria-label="Reasoning effort"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Effort)}
      >
        <option value="default">Provider default</option>
        {value !== "default" && !options.includes(value) && (
          <option value={value} disabled>
            {effortLabel(value)} · unavailable
          </option>
        )}
        {options.map((e) => (
          <option key={e} value={e}>
            {effortLabel(e)}
          </option>
        ))}
      </select>
      {!options.length && (
        <a
          href="/settings#reasoning"
          title="Configure supported effort options for this deployment"
        >
          Configure
        </a>
      )}
    </label>
  );
}

export function RunDetails({
  run,
}: {
  run: RunActivity & { state: string; createdAt: string };
}) {
  const [now, setNow] = useState(0);
  const active = ["queued", "running"].includes(run.state);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const elapsed = run.startedAt
    ? Math.max(
        0,
        Math.round(
          ((run.finishedAt
            ? Date.parse(run.finishedAt)
            : now || Date.parse(run.startedAt)) -
            Date.parse(run.startedAt)) /
            1000,
        ),
      )
    : 0;
  const label =
    run.state === "queued"
      ? "Queued"
      : active
        ? run.phase === "reasoning"
          ? "Thinking"
          : run.phase === "writing"
            ? "Writing"
            : "Waiting for model"
        : run.state === "complete"
          ? "Completed"
          : run.state === "cancelled"
            ? "Stopped"
            : "Interrupted";
  return (
    <details className="run-details">
      <summary>
        {label}
        {run.startedAt ? ` · ${elapsed}s` : ""}
        {run.effort && run.effort !== "default"
          ? ` · ${effortLabel(run.effort)} effort`
          : ""}
      </summary>
      <p className="muted small">
        Elapsed request time
        {run.reasoningTokens != null
          ? ` · ${run.reasoningTokens.toLocaleString()} reasoning tokens reported`
          : ""}
        .{" "}
        {run.effort === "default" || !run.effort
          ? "Using the provider’s default effort."
          : "Using your selected effort."}
      </p>
      {run.reasoning ? (
        <>
          <span className="eyebrow">Model-provided reasoning</span>
          <Markdown>{run.reasoning}</Markdown>
        </>
      ) : (
        <p className="muted small">
          No reasoning text has been returned by this API. The model may still
          reason internally.
        </p>
      )}
    </details>
  );
}
