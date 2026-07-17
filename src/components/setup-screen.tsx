"use client";

import { useState } from "react";
import { ArrowRight, Check, Database, KeyRound, Laptop, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function SetupScreen({ onComplete }: { onComplete: () => Promise<void> | void }) {
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [deployments, setDeployments] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, apiKey, manualDeployments: deployments.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Azure setup failed.");
      if (result.discoveryWarning) toast.message("Connection saved", { description: "Automatic deployment discovery was unavailable, so your manual deployment names were used." });
      else toast.success("Azure connection is ready");
      await onComplete();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Setup failed."); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-dvh overflow-auto bg-[radial-gradient(circle_at_70%_10%,color-mix(in_oklab,var(--accent)_35%,transparent),transparent_34%),var(--background)] px-5 py-10 sm:py-16">
      <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-center">
        <section className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-emerald-600" /> Local runtime · Azure calls only
          </div>
          <div className="space-y-5">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Local Azure AI Workbench</p>
            <h1 className="max-w-2xl font-conversation text-4xl leading-[1.1] tracking-[-0.03em] sm:text-5xl">A quiet place to think with your models.</h1>
            <p className="max-w-xl text-base leading-7 text-muted-foreground">Conversations, source files, carefully accepted memory, and bounded multi-model synthesis—kept on this Mac.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {[
              [Laptop, "Local by default", "Files and history stay here."],
              [ShieldCheck, "Explicit context", "See what each call receives."],
              [Database, "Durable", "Restart without losing your work."],
            ].map(([Icon, title, copy]) => (
              <div key={String(title)} className="rounded-xl border bg-card/55 p-4">
                <Icon className="mb-4 size-4 text-muted-foreground" />
                <p className="text-sm font-medium">{String(title)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{String(copy)}</p>
              </div>
            ))}
          </div>
        </section>

        <form onSubmit={submit} className="paper-shadow rounded-xl border bg-card p-6 sm:p-8">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div><h2 className="text-lg font-medium">Connect Azure</h2><p className="mt-1 text-sm text-muted-foreground">One endpoint, one key, any deployment names.</p></div>
            <div className="rounded-lg bg-accent p-2"><KeyRound className="size-4" /></div>
          </div>
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="endpoint">Endpoint</Label>
              <Input id="endpoint" type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} required placeholder="https://…services.ai.azure.com/api/projects/…" autoComplete="url" />
              <p className="text-xs leading-5 text-muted-foreground">Foundry project and Azure OpenAI endpoints are detected automatically.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="key">API key</Label>
              <Input id="key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required placeholder="Stored only in data/secrets.env" autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deployments">Deployment names <span className="font-normal text-muted-foreground">(fallback)</span></Label>
              <Textarea id="deployments" value={deployments} onChange={(event) => setDeployments(event.target.value)} placeholder={"gpt-5-chat\ndeepseek-r1\ngpt-4.1-mini"} className="min-h-24 font-mono text-xs" />
              <p className="text-xs leading-5 text-muted-foreground">Optional when Azure allows discovery. These are Azure deployment names, not model labels.</p>
            </div>
          </div>
          <div className="mt-8 rounded-lg border bg-muted/45 p-3 text-xs leading-5 text-muted-foreground">
            <p className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> The key never enters browser storage, SQLite, logs, exports, or responses.</p>
          </div>
          <Button type="submit" size="lg" className="mt-6 w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} {busy ? "Checking Azure…" : "Enter workbench"}
          </Button>
        </form>
      </div>
    </main>
  );
}
