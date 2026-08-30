"use client";

import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import {
  Activity,
  Check,
  Download,
  FileText,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Moon,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DeploymentProtocol, DeploymentRecord, SafeConfig } from "@/lib/types";
import { cn } from "@/lib/utils";
import { supportsNativeVisualInput } from "@/lib/attachments";

type AdapterChoice = DeploymentProtocol | "auto";
export type AnswerTextSize = "compact" | "comfortable" | "large";
type ExtendedConfig = SafeConfig & Partial<{
  mapperDeployment: string;
  alternativeDeployment: string;
  adversarialDeployment: string;
  evidenceDeployment: string;
  refinementDeployment: string;
}>;

type RoleKey =
  | "chatDeployment"
  | "memoryDeployment"
  | "mapperDeployment"
  | "alternativeDeployment"
  | "adversarialDeployment"
  | "evidenceDeployment"
  | "criticDeployment"
  | "refinementDeployment"
  | "synthesisDeployment";

type RoleValues = Record<RoleKey, string>;

const ROLE_ROWS: Array<{ key: RoleKey; label: string; hint: string }> = [
  { key: "chatDeployment", label: "Chat", hint: "New conversations" },
  { key: "memoryDeployment", label: "Memory", hint: "Structured curation" },
  { key: "mapperDeployment", label: "Mapper", hint: "Problem decomposition" },
  { key: "alternativeDeployment", label: "Alternative", hint: "Competing approaches" },
  { key: "adversarialDeployment", label: "Adversarial", hint: "Failure modes" },
  { key: "evidenceDeployment", label: "Evidence", hint: "Source audit" },
  { key: "criticDeployment", label: "Critic", hint: "Conflict review" },
  { key: "refinementDeployment", label: "Refinement", hint: "One targeted pass" },
  { key: "synthesisDeployment", label: "Final", hint: "Final synthesis" },
];

function rolesFromConfig(config: ExtendedConfig): RoleValues {
  return {
    chatDeployment: config.chatDeployment,
    memoryDeployment: config.memoryDeployment,
    mapperDeployment: config.mapperDeployment || config.branchDeployment,
    alternativeDeployment: config.alternativeDeployment || config.branchDeployment,
    adversarialDeployment: config.adversarialDeployment || config.branchDeployment,
    evidenceDeployment: config.evidenceDeployment || config.branchDeployment,
    criticDeployment: config.criticDeployment,
    refinementDeployment: config.refinementDeployment || config.criticDeployment,
    synthesisDeployment: config.synthesisDeployment,
  };
}

export function SettingsDialog({
  open,
  setOpen,
  config,
  deployments,
  routing,
  answerTextSize,
  onAnswerTextSizeChange,
  onRefresh,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  config: SafeConfig;
  deployments: DeploymentRecord[];
  routing?: { adjustments?: Array<{ role: string; requestedDeployment: string; deployment: string; reason: string }>; error?: string };
  answerTextSize: AnswerTextSize;
  onAnswerTextSizeChange: (size: AnswerTextSize) => void;
  onRefresh: () => Promise<void>;
}) {
  const { theme, setTheme } = useTheme();
  const [roles, setRoles] = useState<RoleValues>(() => rolesFromConfig(config as ExtendedConfig));
  const [savingRoles, setSavingRoles] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [modelName, setModelName] = useState("");
  const [adapter, setAdapter] = useState<AdapterChoice>("auto");
  const [showConnection, setShowConnection] = useState(false);
  const [connectionEndpoint, setConnectionEndpoint] = useState(config.endpoint);
  const [connectionKey, setConnectionKey] = useState("");
  const [savingConnection, setSavingConnection] = useState(false);

  const enabledDeployments = useMemo(() => deployments.filter((item) => item.enabled), [deployments]);

  async function syncDeployments() {
    setSyncing(true);
    try {
      await api("/api/deployments/sync", { method: "POST" });
      await onRefresh();
      toast.success("Azure deployments synchronized");
    } catch (error) {
      toast.error(messageOf(error, "Could not synchronize deployments."));
    } finally {
      setSyncing(false);
    }
  }

  async function addDeployment(event: React.FormEvent) {
    event.preventDefault();
    setAdding(true);
    try {
      await api("/api/deployments", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          modelName: modelName.trim() || null,
          protocol: adapter,
          probe: true,
        }),
      });
      setName("");
      setModelName("");
      setAdapter("auto");
      setShowAdd(false);
      await onRefresh();
      toast.success("Deployment registered and probed");
    } catch (error) {
      toast.error(messageOf(error, "Could not register deployment."));
    } finally {
      setAdding(false);
    }
  }

  async function probeDeployment(id: string) {
    try {
      await api(`/api/deployments/${id}/probe`, { method: "POST" });
      await onRefresh();
      toast.success("Capability probe complete");
    } catch (error) {
      toast.error(messageOf(error, "Capability probe failed."));
    }
  }

  async function updateDeployment(id: string, update: { protocol?: AdapterChoice; enabled?: boolean; modelName?: string | null }) {
    try {
      await api(`/api/deployments/${id}`, { method: "PATCH", body: JSON.stringify(update) });
      await onRefresh();
    } catch (error) {
      toast.error(messageOf(error, "Could not update deployment."));
    }
  }

  async function saveRoles() {
    setSavingRoles(true);
    try {
      await api("/api/settings/model-roles", { method: "PUT", body: JSON.stringify(roles) });
      await onRefresh();
      toast.success("Model roles saved");
    } catch (error) {
      toast.error(messageOf(error, "Could not save model roles."));
    } finally {
      setSavingRoles(false);
    }
  }

  async function saveConnection(event: React.FormEvent) {
    event.preventDefault();
    setSavingConnection(true);
    try {
      await api("/api/setup", {
        method: "POST",
        body: JSON.stringify({
          endpoint: connectionEndpoint.trim(),
          apiKey: connectionKey.trim() || undefined,
          manualDeployments: deployments.map((deployment) => deployment.name),
          roles,
        }),
      });
      setConnectionKey("");
      setShowConnection(false);
      await onRefresh();
      toast.success("Azure connection updated");
    } catch (error) {
      toast.error(messageOf(error, "Could not update the Azure connection."));
    } finally {
      setSavingConnection(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="grid max-h-[84dvh] min-h-0 w-[calc(100vw-1.5rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl duration-200 sm:w-[720px] sm:max-w-[720px]">
        <DialogHeader className="min-w-0 border-b px-5 py-3.5 pr-12">
          <DialogTitle className="text-base">Settings</DialogTitle>
          <DialogDescription className="text-xs">Models, routing, appearance, and local data.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="models" className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-0 sm:grid-cols-[138px_minmax(0,1fr)] sm:grid-rows-[minmax(0,1fr)]">
          <TabsList className="mx-3 mt-3 grid w-auto grid-cols-4 sm:m-0 sm:flex sm:h-full sm:w-full sm:flex-col sm:items-stretch sm:justify-start sm:rounded-none sm:border-r sm:bg-muted/15 sm:p-2.5">
            <TabsTrigger value="models" className="sm:h-9 sm:flex-none sm:justify-start sm:px-2.5 sm:after:hidden"><Activity /> Models</TabsTrigger>
            <TabsTrigger value="routing" className="sm:h-9 sm:flex-none sm:justify-start sm:px-2.5 sm:after:hidden"><Network /> Routing</TabsTrigger>
            <TabsTrigger value="appearance" className="sm:h-9 sm:flex-none sm:justify-start sm:px-2.5 sm:after:hidden"><Sun /> Appearance</TabsTrigger>
            <TabsTrigger value="data" className="sm:h-9 sm:flex-none sm:justify-start sm:px-2.5 sm:after:hidden"><FileText /> Data</TabsTrigger>
          </TabsList>

          <TabsContent value="models" className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-3 pb-0 pt-3 sm:px-4">
            <section className="min-w-0 space-y-3">
              <div className="min-w-0 rounded-xl border border-border/70 bg-muted/20 p-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-700/8 text-emerald-700 dark:text-emerald-400"><ShieldCheck className="size-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">Azure connection</p><Badge variant="secondary" className="text-[9px]">CONNECTED</Badge></div>
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={config.endpoint}>{config.endpoint}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{config.endpointKind === "foundry-project" ? "Foundry project" : "Azure OpenAI"} · encrypted locally</p>
                  </div>
                  <Button type="button" size="icon-sm" variant="ghost" className="shrink-0" onClick={() => setShowConnection((value) => !value)} aria-label="Edit Azure connection"><Pencil /></Button>
                </div>
                {showConnection && (
                  <form onSubmit={saveConnection} className="mt-4 grid gap-3 border-t pt-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="connection-endpoint">Endpoint</Label>
                      <Input id="connection-endpoint" type="url" value={connectionEndpoint} onChange={(event) => setConnectionEndpoint(event.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="connection-key">Replacement API key <span className="font-normal text-muted-foreground">optional</span></Label>
                      <Input id="connection-key" type="password" value={connectionKey} onChange={(event) => setConnectionKey(event.target.value)} placeholder="Leave blank to keep the current key" autoComplete="off" />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={() => { setShowConnection(false); setConnectionEndpoint(config.endpoint); setConnectionKey(""); }}>Cancel</Button>
                      <Button type="submit" disabled={savingConnection || !connectionEndpoint.trim()}>{savingConnection ? <Loader2 className="animate-spin" /> : <KeyRound />} Save & validate</Button>
                    </div>
                  </form>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                <div>
                  <h3 className="text-sm font-medium">Deployment registry</h3>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Your Azure deployments and verified capabilities.</p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={syncDeployments} disabled={syncing}>
                    {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync Azure
                  </Button>
                  <Button type="button" size="sm" onClick={() => setShowAdd((value) => !value)}>
                    <Plus /> Add model
                  </Button>
                </div>
              </div>

              {showAdd && (
                <form onSubmit={addDeployment} className="grid min-w-0 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="deployment-name">Deployment name</Label>
                    <Input id="deployment-name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Kimi-K2.6" autoFocus />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="model-name">Model name <span className="font-normal text-muted-foreground">optional</span></Label>
                    <Input id="model-name" value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="Kimi-K2.6" />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label>Adapter</Label>
                    <Select value={adapter} onValueChange={(value) => setAdapter(value as AdapterChoice)}>
                      <SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto probe</SelectItem>
                        <SelectItem value="responses">Responses</SelectItem>
                        <SelectItem value="chat">Chat Completions</SelectItem>
                        <SelectItem value="deepseek">DeepSeek chat</SelectItem>
                        <SelectItem value="anthropic">Anthropic / Claude</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-end gap-2">
                    <Button type="submit" className="flex-1" disabled={adding || !name.trim()}>
                      {adding && <Loader2 className="animate-spin" />} Add & probe
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
                  </div>
                </form>
              )}

              <div className="space-y-2">
                {deployments.map((deployment) => (
                  <DeploymentRow
                    key={`${deployment.id}:${deployment.modelName ?? ""}`}
                    deployment={deployment}
                    onProbe={() => probeDeployment(deployment.id)}
                    onProtocol={(protocol) => updateDeployment(deployment.id, { protocol })}
                    onModelName={(nextModelName) => updateDeployment(deployment.id, { modelName: nextModelName })}
                    onToggle={() => updateDeployment(deployment.id, { enabled: !deployment.enabled })}
                  />
                ))}
              </div>

            </section>
          </TabsContent>

          <TabsContent value="routing" className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-3 pb-0 pt-3 sm:px-4">
            <section className="min-w-0 space-y-3">
              <div className="px-0.5">
                <h3 className="text-sm font-medium">Model role routing</h3>
                <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">Choose the model used for chat and each specialist pass.</p>
              </div>
              {routing?.error && <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{routing.error}</p>}
              {!!routing?.adjustments?.length && (
                <div className="space-y-2">
                  {routing.adjustments.map((adjustment) => (
                    <p key={adjustment.role} className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-muted-foreground">{adjustment.reason}</p>
                  ))}
                </div>
              )}
              <div className="divide-y overflow-hidden rounded-xl border border-border/70">
                {ROLE_ROWS.map((role) => {
                  const selectedDeployment = deployments.find((item) => item.name === roles[role.key]);
                  const roleDeployments = selectedDeployment && !enabledDeployments.some((item) => item.id === selectedDeployment.id)
                    ? [selectedDeployment, ...enabledDeployments]
                    : enabledDeployments;

                  return (
                    <div key={role.key} className="flex min-w-0 items-center gap-3 bg-card/40 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <Label className="text-xs">{role.label}</Label>
                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{role.hint}</p>
                      </div>
                      <Select value={roles[role.key]} onValueChange={(value) => setRoles((current) => ({ ...current, [role.key]: value }))}>
                        <SelectTrigger size="sm" className="w-[min(58%,260px)] min-w-0"><SelectValue placeholder="Choose model" /></SelectTrigger>
                        <SelectContent className="w-[min(28rem,calc(100vw-2rem))]">
                          {roleDeployments.map((item) => {
                            const compatible = item.enabled && roleSupports(item, role.key);
                            return (
                              <SelectItem key={item.id} value={item.name} disabled={!compatible} textValue={item.name} className="min-w-0">
                                <span className="block min-w-0 max-w-[22rem] truncate">{item.name}{compatible ? "" : item.enabled ? " · incompatible/unprobed" : " · disabled"}</span>
                              </SelectItem>
                            );
                          })}
                          {!roleDeployments.length && <SelectItem value={`empty-${role.key}`} disabled>No enabled deployments</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </section>
            <div className="sticky bottom-0 -mx-3 mt-3 border-t bg-popover/95 px-3 py-3 backdrop-blur sm:-mx-4 sm:px-4">
              <Button onClick={saveRoles} disabled={savingRoles} className="w-full">{savingRoles ? <Loader2 className="animate-spin" /> : <Check />} Save routing</Button>
            </div>
          </TabsContent>

          <TabsContent value="appearance" className="min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4">
            <div className="space-y-5">
              <section>
                <div className="mb-3 px-0.5"><h3 className="text-sm font-medium">Theme</h3><p className="mt-0.5 text-[10px] text-muted-foreground">Choose how the workbench looks on this device.</p></div>
                <div className="grid grid-cols-3 gap-2">
                  {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Settings, "System"]] as const).map(([value, Icon, label]) => (
                    <Button key={value} variant={theme === value ? "default" : "outline"} className="h-11 gap-2" onClick={() => setTheme(value)}>
                      <Icon className="size-4" /> {label}
                    </Button>
                  ))}
                </div>
              </section>
              <section>
                <div className="mb-3 px-0.5"><h3 className="text-sm font-medium">Answer text</h3><p className="mt-0.5 text-[10px] text-muted-foreground">Changes model responses only, on this device.</p></div>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Answer text size">
                  {([
                    ["compact", "Compact", "text-sm"],
                    ["comfortable", "Comfortable", "text-base"],
                    ["large", "Large", "text-lg"],
                  ] as const).map(([value, label, previewClass]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={answerTextSize === value}
                      onClick={() => onAnswerTextSizeChange(value)}
                      className={cn("flex h-16 flex-col items-center justify-center rounded-xl border text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground", answerTextSize === value && "border-primary/45 bg-primary/8 text-foreground ring-1 ring-primary/15")}
                    >
                      <span className={cn("font-conversation leading-none", previewClass)}>Aa</span>
                      <span className="mt-1.5 text-[10px]">{label}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="data" className="min-h-0 space-y-2 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4">
            <div className="mb-3 px-0.5"><h3 className="text-sm font-medium">Local data</h3><p className="mt-0.5 text-[10px] text-muted-foreground">Export or restore the workbench without including your Azure key.</p></div>
            <a href="/api/backup"><Button variant="outline" className="w-full justify-start"><Download /> Download full backup</Button></a>
            <a href={`/api/export?projectId=${encodeURIComponent(config.defaultProjectId)}`}><Button variant="outline" className="w-full justify-start"><FileText /> Export project as Markdown</Button></a>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
              <Upload className="size-4" /> Restore backup
              <input type="file" accept=".zip" className="sr-only" onChange={(event) => void restoreBackup(event, onRefresh)} />
            </label>
            <p className="px-0.5 text-[10px] leading-4 text-muted-foreground">Backups include durable data and original files. The Azure key is excluded.</p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DeploymentRow({
  deployment,
  onProbe,
  onProtocol,
  onModelName,
  onToggle,
}: {
  deployment: DeploymentRecord;
  onProbe: () => Promise<void>;
  onProtocol: (protocol: AdapterChoice) => Promise<void>;
  onModelName: (modelName: string | null) => Promise<void>;
  onToggle: () => Promise<void>;
}) {
  const [probing, setProbing] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [modelName, setModelName] = useState(deployment.modelName ?? "");
  const capabilities = deployment.capabilities;
  const healthy = capabilities.textGeneration === true;
  const failed = capabilities.lastProbeOk === false || Boolean(capabilities.lastProbeError);
  const state = failed ? "Failed" : healthy ? "Healthy" : "Unprobed";
  const modelNameChanged = modelName.trim() !== (deployment.modelName ?? "");
  const identity = `${deployment.name} ${deployment.modelName ?? ""}`;
  const documentedThinking = /claude[- ]?(?:fable|sonnet|opus)?[- ]?5/i.test(identity) || /gpt[- ]?5\.6[- ]?luna/i.test(identity);
  const thinking = capabilities.thinkingObserved === true ? "observed" : documentedThinking ? "supported" : capabilities.reasoningMetadata ?? capabilities.reasoning;
  const cache = capabilities.cacheObserved === true ? "observed" : deployment.protocol === "anthropic" ? "supported" : "unknown";
  const capabilityLabels = [
    capabilities.streaming === true ? "Streaming" : null,
    capabilities.structuredOutput === true ? "Structured" : null,
    thinking === true || thinking === "observed" || thinking === "supported" ? "Thinking" : null,
    supportsNativeVisualInput(deployment) ? "Vision" : null,
    cache === "observed" ? "Cache seen" : cache === "supported" ? "Cache ready" : null,
  ].filter((value): value is string => Boolean(value));

  async function probe() {
    setProbing(true);
    try { await onProbe(); } finally { setProbing(false); }
  }

  async function saveModelName() {
    setSavingName(true);
    try { await onModelName(modelName.trim() || null); } finally { setSavingName(false); }
  }

  return (
    <div className={cn("min-w-0 rounded-xl border border-border/70 bg-card/35 p-3", !deployment.enabled && "opacity-60")}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-full", failed ? "bg-destructive" : healthy ? "bg-emerald-600" : "bg-muted-foreground")} />
            <p className="truncate text-sm font-medium">{deployment.name}</p>
            {state !== "Healthy" && <Badge variant="outline" className="shrink-0 font-mono text-[9px]">{state}</Badge>}
          </div>
          <p className="mt-1 truncate font-mono text-[10px] leading-4 text-muted-foreground">
            {deployment.protocol.toUpperCase()} · model {deployment.modelName || "not set"}
            {capabilities.lastProbeLatencyMs ? ` · ${capabilities.lastProbeLatencyMs}ms` : ""}
            {capabilities.lastProbeAt ? ` · ${formatProbeDate(String(capabilities.lastProbeAt))}` : ""}
            {capabilities.probeRequired ? " · probe required" : ""}
          </p>
          <div className="mt-2 flex min-h-5 flex-wrap gap-1.5">
            {capabilityLabels.slice(0, 3).map((label) => <Badge key={label} variant="secondary" className="font-mono text-[9px]">{label}</Badge>)}
            {capabilityLabels.length > 3 && <Badge variant="outline" className="font-mono text-[9px]">+{capabilityLabels.length - 3}</Badge>}
            {!capabilityLabels.length && <span className="text-[10px] text-muted-foreground">Capabilities not verified</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Select value={deployment.protocol} onValueChange={(value) => void onProtocol(value as AdapterChoice)}>
            <SelectTrigger size="sm" className="w-[108px] min-w-0" aria-label={`Adapter for ${deployment.name}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="responses">Responses</SelectItem>
              <SelectItem value="chat">Chat</SelectItem>
              <SelectItem value="deepseek">DeepSeek</SelectItem>
              <SelectItem value="anthropic">Anthropic / Claude</SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`More actions for ${deployment.name}`}><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => void probe()} disabled={probing}>{probing ? <Loader2 className="animate-spin" /> : <Activity />} Probe capabilities</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEditingName((value) => !value)}><Pencil /> Edit model name</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant={deployment.enabled ? "destructive" : "default"} onSelect={() => void onToggle()}>{deployment.enabled ? "Disable model" : "Enable model"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {editingName && (
        <div className="mt-3 flex min-w-0 flex-wrap items-end gap-2 border-t pt-3">
          <div className="min-w-0 basis-48 flex-1 space-y-1">
            <Label htmlFor={`model-name-${deployment.id}`} className="text-[10px] text-muted-foreground">Model name override</Label>
            <Input id={`model-name-${deployment.id}`} value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder={deployment.name} className="h-8 min-w-0 font-mono text-xs" />
          </div>
          <Button type="button" size="sm" variant="outline" disabled={!modelNameChanged || savingName} onClick={() => void saveModelName()}>{savingName && <Loader2 className="animate-spin" />} Save</Button>
        </div>
      )}
      {capabilities.lastProbeError && <p className="mt-2 break-words text-[10px] leading-4 text-destructive">{String(capabilities.lastProbeError)}</p>}
    </div>
  );
}

function roleSupports(deployment: DeploymentRecord, role: RoleKey) {
  if (deployment.protocol === "auto" || deployment.capabilities.textGeneration !== true) return false;
  if (role === "chatDeployment") return deployment.capabilities.streaming === true;
  if (role === "memoryDeployment") return deployment.capabilities.structuredOutput === true;
  return true;
}

async function restoreBackup(event: React.ChangeEvent<HTMLInputElement>, onRefresh: () => Promise<void>) {
  const file = event.target.files?.[0];
  if (!file) return;
  const form = new FormData();
  form.set("backup", file);
  try {
    await api("/api/restore", { method: "POST", body: form });
    await onRefresh();
    toast.success("Backup restored");
  } catch (error) {
    toast.error(messageOf(error, "Restore failed."));
  } finally {
    event.target.value = "";
  }
}

async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const headers = init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers };
  const response = await fetch(url, { ...init, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatProbeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
