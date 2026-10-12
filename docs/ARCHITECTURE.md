# Architecture

Next.js App Router provides addressable home, conversation, project, output, and settings pages. Server components load the initial workspace; client components own focused interactive workflows. The frontend was built independently of the previous workbench.

`src/domain` defines persisted contracts and deterministic import parsing. `src/server` contains database access, context assembly, exports, protected provider connections, migration, and backup validation. HTTP handlers validate inputs and delegate to these services. `src/worker.ts` claims durable extraction/generation jobs with leases; `src/server/jobs.ts` executes them.

SQLite stores versioned typed records and a full-text index. Generations reference immutable context snapshots and write partial messages during streaming. Restart recovery fails interrupted model jobs without automatically replaying paid requests; extraction can be retried safely. Cancellation propagates through an abort signal.

Approved brief revisions, draft proposals, and saved-output revisions retain provenance. Export snapshots preserve the reviewed text and original-file manifest. Source summaries omit extracted bodies from routine UI polling.

Legacy migration reads the repository selected by `WORKBENCH_LEGACY_DIR`. It copies conversations and associated sources, preserves branches, imports completed synthesis results as outputs, and brings accepted old memory in as a proposal. It does not import executable jobs. Backups restore only into an empty workspace and never replace credentials. The [upgrade guide](UPGRADING.md) describes the separate installation required for the new database format.

The source extractor and Azure endpoint validation were adapted from the existing MIT-licensed Local AI Workbench. No previous frontend components were copied. Model identities and capabilities are configured rather than inferred from hard-coded role names.


## Durable drafting and model activity

Handoff and brief generation are `draft` jobs, separate from conversation turns. Creation validates scope and captures the selected messages, source text, approved context, model configuration, effort, and prompt before returning. The worker streams answer and returned reasoning into a draft record. The browser polls a summary that omits the frozen prompt. Closing the dialog does not own or cancel execution.

Handoff jobs have their own export record. Completion, cancellation, or failure saves available text into that record; prior exports remain available. Brief jobs create an unapproved proposal and retain the approved-brief revision they were based on. Acceptance checks for intervening changes. Expired leases preserve partial work without replaying a paid request. Worker writes are fenced by lease ownership.

Export edits use serialized, coalesced writes and revision checks to prevent an older window overwriting newer work. Pending export edits also have a per-tab session-storage recovery copy, removed after a successful save. Backup restoration includes draft records, neutralizes incomplete runs, and makes their saved output available without restoring executable jobs.

Reasoning capabilities are configured per deployment, with protocol validation. OpenAI reasoning maps to `providerOptions.openai`; Anthropic adaptive effort or token budgets map to `providerOptions.anthropic`. The worker captures reasoning events only when returned, plus elapsed request time and reported token usage. Defaults send no effort/summary override. A synthetic provider verifies request wiring; a separate user-triggered test checks a chosen setting against the configured deployment.


## Temporary conversations

Temporary threads are explicitly flagged, never attached to a project, and start with project context off. They use the same durable local worker so navigation and refresh do not interrupt a request. They are listed separately as temporary sessions, omitted from saved history and backup manifests, and excluded from the search index at write time. A Keep operation makes the thread permanent and indexes its existing messages and sources; saving outputs, branching, and export drafting require this explicit conversion.

Activity extends a 24-hour expiry; read-only polling does not. Expiry cleanup runs on API access, workspace loading, worker startup, and periodically while the worker is running. If Workbench is closed at expiry, cleanup runs when it next starts. End removes messages, snapshots, generations, associated jobs, and unshared original files. Worker writes check record existence/lease ownership to prevent late streams or extraction from recreating deleted records. OpenAI-compatible temporary requests explicitly send `store: false`; other provider retention is governed by the provider. This is application-level cleanup, not a promise of forensic disk erasure.
