"use client";
import { useState } from "react";
import type { Effort, Model, ReasoningConfig } from "@/domain/types";
import { effortLabel } from "@/domain/reasoning";
import { api, Busy } from "./ui";
import { useWorkspace } from "./shell";

export function ReasoningSettings({ model }: { model: Model }) {
  const { refresh, notify } = useWorkspace();
  const [mode, setMode] = useState<ReasoningConfig["mode"] | "default">(
    model.reasoning?.mode || "default",
  );
  const [efforts, setEfforts] = useState<Exclude<Effort, "default">[]>(
    model.reasoning?.efforts || ["low", "medium", "high"],
  );
  const [summary, setSummary] = useState(model.reasoning?.summary || false);
  const [testEffort, setTestEffort] = useState<Effort>("medium");
  const [busy, setBusy] = useState(false);
  if (model.protocol === "deepseek")
    return (
      <p className="muted small">
        Any reasoning returned by this deployment is shown with its response.
        Effort controls are not configured for the DeepSeek adapter.
      </p>
    );
  const choices: Exclude<Effort, "default">[] =
    mode === "openai"
      ? ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
      : mode === "budget"
        ? ["low", "medium", "high"]
        : ["low", "medium", "high", "xhigh", "max"];
  const selected = efforts.filter((e) => choices.includes(e));
  async function save(test: boolean) {
    setBusy(true);
    try {
      await api("models/" + model.id + "/reasoning", {
        config:
          mode === "default" ? null : { mode, efforts: selected, summary },
        ...(test ? { testEffort } : {}),
      });
      await refresh();
      notify(
        test
          ? `${effortLabel(testEffort)} effort accepted by ${model.name}. Settings saved.`
          : "Reasoning settings saved. Selected options will appear beside the model picker.",
      );
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="reasoning-settings">
      <summary>
        Reasoning controls
        {model.reasoning ? " · configured" : " · provider default"}
      </summary>
      <p className="muted small">
        Choose the controls supported by this deployment. Saved options are your
        configuration; use a test request to check an option against the
        provider.
      </p>
      <label>
        Reasoning mode
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="default">Provider default only</option>
          {model.protocol === "anthropic" ? (
            <>
              <option value="adaptive">Adaptive thinking</option>
              <option value="budget">Thinking token budget</option>
            </>
          ) : (
            <option value="openai">OpenAI reasoning effort</option>
          )}
        </select>
      </label>
      {mode !== "default" && (
        <>
          <fieldset>
            <legend>Supported effort options</legend>
            <div className="effort-options">
              {choices.map((e) => (
                <label className="check-line" key={e}>
                  <input
                    type="checkbox"
                    checked={selected.includes(e)}
                    onChange={(event) =>
                      setEfforts(
                        event.target.checked
                          ? [...selected, e]
                          : selected.filter((v) => v !== e),
                      )
                    }
                  />
                  {effortLabel(e)}
                </label>
              ))}
            </div>
          </fieldset>
          {mode === "budget" && (
            <p className="muted small">
              Low: 2,048 · Medium: 4,096 · High: 8,192 thinking tokens. These
              are Workbench budget presets.
            </p>
          )}
          {(mode === "adaptive" ||
            (mode === "openai" && model.protocol === "responses")) && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={summary}
                onChange={(e) => setSummary(e.target.checked)}
              />
              Request a reasoning summary when using a selected effort
            </label>
          )}
          <p className="muted small">
            Provider default sends no effort or summary override. Reasoning can
            increase latency and token usage.
          </p>
        </>
      )}
      <div className="form-actions">
        <button
          className="button"
          disabled={busy || (mode !== "default" && !selected.length)}
          onClick={() => {
            void save(false);
          }}
        >
          {busy ? <Busy /> : "Save reasoning controls"}
        </button>
        {mode !== "default" && (
          <>
            <select
              aria-label={"Test effort for " + model.name}
              value={testEffort}
              onChange={(e) => setTestEffort(e.target.value as Effort)}
            >
              {selected.map((e) => (
                <option key={e} value={e}>
                  {effortLabel(e)}
                </option>
              ))}
            </select>
            <button
              className="button subtle"
              disabled={
                busy ||
                !selected.includes(testEffort as Exclude<Effort, "default">)
              }
              onClick={() => {
                void save(true);
              }}
            >
              Test selected effort · uses API
            </button>
          </>
        )}
      </div>
    </details>
  );
}
