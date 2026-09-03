# Local AI Workbench

A local-first workspace for talking to Azure-deployed language models with your own files, reviewed memory, and bounded multi-model synthesis.

The web interface, SQLite database, uploads, exports, job state, and credentials stay on your Mac. Only the context you explicitly select is sent to Azure.

## Why this exists

Most chat clients treat history as memory and hide the context sent to a model. Local AI Workbench takes a different approach:

- conversations and source files remain locally owned;
- memory is proposed by a model but accepted by a person;
- every generation records its model, settings, selected files, and accepted memories;
- multi-model work is bounded by an inspectable stage graph instead of an open-ended agent loop;
- deployment names and adapters are configured from the interface, so the app is not tied to hard-coded model labels.

## Features

- Streaming chat with Azure Foundry project endpoints and Azure OpenAI endpoints.
- Capability-aware model registry with sync, manual registration, adapter selection, probing, enable/disable controls, and per-conversation model selection.
- PDF, DOCX, TXT, Markdown, HTML, CSV, JSON, and JSONL extraction with local FTS5 search and provenance-aware chunks.
- Explicit attachment handling: send supported images and PDFs directly, include locally extracted source text, or prepare large/visual files with a selected deployment before the final request.
- Attachment receipts showing the exact memories, file chunks, preparation mode, and generation telemetry used for a response.
- Conversation editing and non-destructive branching, recoverable trash, and selective Markdown export for questions, answers, or individual messages.
- Manual memory curation with accept, reject, edit, supersede, and delete workflows.
- Bounded synthesis using parallel mapper, alternative, adversarial, and evidence lanes, followed by critic, optional refinement, and final synthesis.
- Persistent projects, threads, generations, file jobs, synthesis runs, exports, and backup/restore.
- Light, dark, and system themes; responsive navigation; keyboard focus states; and a global `Cmd+K` palette.

## Requirements

- macOS for the double-click launcher. The npm workflow also works on other platforms supported by Node and `better-sqlite3`.
- Node.js 20.9 or later.
- An Azure Foundry project endpoint or Azure OpenAI endpoint, one API key, and at least one existing deployment name.

The app registers deployments that already exist in Azure. It does not provision Azure resources.

## Quick start

On macOS, double-click `start-local.command`.

Or run:

```bash
npm install
npm run db:migrate
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Enter your endpoint and API key, then discover or manually register your Azure deployments.

Foundry project endpoints look like:

```text
https://example-resource.services.ai.azure.com/api/projects/example-project
```

Azure OpenAI endpoints ending in `/openai/v1` are also accepted.

## Privacy and security model

- The server binds to `127.0.0.1` and rejects non-loopback hosts and cross-origin mutation requests.
- The API key is encrypted locally under `data/`, never placed in browser storage or SQLite, and redacted from application errors. The adjacent local encryption key protects against accidental disclosure; it is not a defense against another process or user that can already read your private `data/` directory.
- `data/`, environment files, exports, test artifacts, and build outputs are gitignored.
- Raw uploads stay local until you explicitly select them for a request. Text documents are sent as selected extracted context; images and PDFs can be sent as original binary input only when you choose Direct with a compatible deployment. The context receipt records what was included.
- Backups exclude credentials.
- No telemetry, authentication service, cloud database, autonomous tools, or unbounded agent loop is included.

Local-first does not mean a model request stays on the device. Review the context receipt before sending sensitive material and follow your Azure deployment's data-handling policy.

Environment variables may replace the setup-screen credential:

```bash
AZURE_AI_ENDPOINT=
AZURE_AI_API_KEY=
```

See [SECURITY.md](SECURITY.md) for the disclosure policy and security boundaries.

## Model routing

Open **Settings → Models** to synchronize or register deployments and probe their capabilities. Open **Settings → Routing** to assign deployments to chat, memory, synthesis branches, critic, refinement, and final synthesis.

Supported adapters are:

- Auto probe
- Azure Responses
- Chat Completions
- DeepSeek chat compatibility

Unsupported capability combinations are shown and blocked rather than silently downgraded. Each synthesis run stores an immutable routing snapshot.

## Local data

Runtime data is created under `data/`:

```text
data/
├── config.json
├── workbench.db
├── secrets.env
├── .secrets-key
├── uploads/
└── exports/
```

Do not commit this directory. Use the in-app backup and restore controls when moving between machines.

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

The end-to-end suite uses an isolated test-only data directory and mocked Azure responses. It does not require or transmit real credentials.

## Scope

Version 1 intentionally excludes authentication, hosted deployment, cloud sync, OCR, voice, image generation, provider-native file storage, web browsing, external tools, and autonomous agent loops. These are extension points, not implicit privileges.

## Contributing

Issues and focused pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

MIT — see [LICENSE](LICENSE).
