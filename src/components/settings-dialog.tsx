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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DeploymentProtocol, DeploymentRecord, SafeConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

type AdapterChoice = DeploymentProtocol | "auto";
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
  onRefresh,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  config: SafeConfig;
  deployments: DeploymentRecord[];
  routing?: { adjustments?: Array<{ role: string; requestedDeployment: string; deployment: string; reason: string }>; error?: string };
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
      <DialogContent className="grid max-h-[92dvh] min-h-0 w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl duration-200 sm:max-h-[calc(100dvh-2rem)] sm:w-[760px] sm:max-w-[760px]">
        <DialogHeader className="min-w-0 border-b px-6 py-5 pr-14">
          <DialogTitle className="text-lg">Settings</DialogTitle>
          <DialogDescription>Models, role routing, appearance, and local data.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="models" className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
          <TabsList className="mx-4 mt-4 grid grid-cols-4 sm:mx-6">
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="routing">Routing</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>

          <TabsContent value="models" className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-4 pb-0 pt-4 sm:px-6">
            <section className="min-w-0 space-y-4">
              <div className="min-w-0 rounded-2xl border border-border/75 bg-muted/25 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-700/8 text-emerald-700 dark:text-emerald-400"><ShieldCheck className="size-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">Azure connection</p><Badge variant="secondary" className="text-[9px]">CONNECTED</Badge></div>
                    <p className="mt-1 break-all font-mono text-[10px] leading-5 text-muted-foreground">{config.endpoint}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{config.endpointKind === "foundry-project" ? "Foundry project" : "Azure OpenAI"} · credential encrypted locally</p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={() => setShowConnection((value) => !value)}><Pencil /> Edit</Button>
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

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">Deployment registry</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Register deployments that already exist in Azure.</p>
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

          <TabsContent value="routing" className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-4 pb-0 pt-4 sm:px-6">
            <section className="min-w-0 space-y-5">
              <div className="flex items-start gap-3 rounded-2xl border border-border/75 bg-muted/25 p-4">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/70"><Network className="size-4" /></div>
                <div><h3 className="text-sm font-medium">Model role routing</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Choose a deployment for ordinary chat and each bounded synthesis lane. Every run records an immutable routing receipt.</p></div>
              </div>
              {routing?.error && <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{routing.error}</p>}
              {!!routing?.adjustments?.length && (
                <div className="space-y-2">
                  {routing.adjustments.map((adjustment) => (
                    <p key={adjustment.role} className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-muted-foreground">{adjustment.reason}</p>
                  ))}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {ROLE_ROWS.map((role) => {
                  const selectedDeployment = deployments.find((item) => item.name === roles[role.key]);
                  const roleDeployments = selectedDeployment && !enabledDeployments.some((item) => item.id === selectedDeployment.id)
                    ? [selectedDeployment, ...enabledDeployments]
                    : enabledDeployments;

                  return (
                    <div key={role.key} className="min-w-0 rounded-xl border border-border/70 bg-card/60 p-3">
                      <div className="mb-2 min-w-0">
                        <Label className="text-xs">{role.label}</Label>
                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{role.hint}</p>
                      </div>
                      <Select value={roles[role.key]} onValueChange={(value) => setRoles((current) => ({ ...current, [role.key]: value }))}>
                        <SelectTrigger className="w-full min-w-0"><SelectValue placeholder="Choose model" /></SelectTrigger>
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
            <div className="sticky bottom-0 -mx-4 mt-6 border-t bg-popover/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
              <Button onClick={saveRoles} disabled={savingRoles} className="w-full">{savingRoles ? <Loader2 className="animate-spin" /> : <Check />} Save routing</Button>
            </div>
          </TabsContent>

          <TabsContent value="appearance" className="min-h-0 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6">
            <div className="grid grid-cols-3 gap-2">
              {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Settings, "System"]] as const).map(([value, Icon, label]) => (
                <Button key={value} variant={theme === value ? "default" : "outline"} className="h-24 flex-col" onClick={() => setTheme(value)}>
                  <Icon className="size-4" /> {label}
                </Button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="data" className="min-h-0 space-y-3 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6">
            <a href="/api/backup"><Button variant="outline" className="w-full justify-start"><Download /> Download full backup</Button></a>
            <a href={`/api/export?projectId=${encodeURIComponent(config.defaultProjectId)}`}><Button variant="outline" className="w-full justify-start"><FileText /> Export project as Markdown</Button></a>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
              <Upload className="size-4" /> Restore backup
              <input type="file" accept=".zip" className="sr-only" onChange={(event) => void restoreBackup(event, onRefresh)} />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">Backups include durable local data and originals. The Azure key is excluded.</p>
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

  async function probe() {
    setProbing(true);
    try { await onProbe(); } finally { setProbing(false); }
  }

  async function saveModelName() {
    setSavingName(true);
    try { await onModelName(modelName.trim() || null); } finally { setSavingName(false); }
  }

  return (
    <div className={cn("min-w-0 rounded-xl border p-3", !deployment.enabled && "opacity-60")}>
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-full", failed ? "bg-destructive" : healthy ? "bg-emerald-600" : "bg-muted-foreground")} />
            <p className="truncate text-sm font-medium">{deployment.name}</p>
            <Badge variant="outline" className="shrink-0 font-mono text-[9px]">{state}</Badge>
          </div>
          <p className="mt-1 break-all font-mono text-[10px] leading-4 text-muted-foreground">
            {deployment.protocol.toUpperCase()} · model {deployment.modelName || "not set"}
            {capabilities.lastProbeLatencyMs ? ` · ${capabilities.lastProbeLatencyMs}ms` : ""}
            {capabilities.lastProbeAt ? ` · ${formatProbeDate(String(capabilities.lastProbeAt))}` : ""}
            {capabilities.probeRequired ? " · probe required" : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Capability label="Stream" value={capabilities.streaming} />
            <Capability label="Structured" value={capabilities.structuredOutput} />
            <Capability label="Reasoning" value={capabilities.reasoningMetadata ?? capabilities.reasoning} />
            <Badge variant="secondary" className="font-mono text-[9px]">Context unknown</Badge>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center justify-start gap-1.5 sm:w-auto sm:justify-end">
          <Select value={deployment.protocol} onValueChange={(value) => void onProtocol(value as AdapterChoice)}>
            <SelectTrigger size="sm" className="w-[118px] min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="responses">Responses</SelectItem>
              <SelectItem value="chat">Chat</SelectItem>
              <SelectItem value="deepseek">DeepSeek</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => void probe()} disabled={probing} aria-label={`Probe ${deployment.name}`}>
            {probing ? <Loader2 className="animate-spin" /> : <Activity />}
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditingName((value) => !value)} aria-label={`Edit ${deployment.name}`}><Pencil /></Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void onToggle()}>{deployment.enabled ? "Disable" : "Enable"}</Button>
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

function Capability({ label, value }: { label: string; value: unknown }) {
  const state = value === true ? "yes" : value === false ? "no" : "unknown";
  return <Badge variant={state === "yes" ? "secondary" : "outline"} className={cn("font-mono text-[9px]", state === "no" && "text-muted-foreground line-through")}>{label}: {state}</Badge>;
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
