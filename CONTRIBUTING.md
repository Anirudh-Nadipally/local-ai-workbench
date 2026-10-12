# Contributing

For a substantial feature or architecture change, open an issue describing the problem and intended behavior before starting work.

## Run locally

Use Node.js 22.13 or later:

```bash
npm ci
npm run dev
```

This starts the web app and worker together. SQLite is initialized on first use; no separate migration command is needed for a new workspace.

## Check a change

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:recovery
```

The recovery suite uses an isolated database and a synthetic model on port 3042. It also runs the desktop and mobile workflows. Ordinary tests and CI make no paid API requests. Add coverage when a change affects persistence, request context, provider options, or another behavior that could silently lose work.

Keep these boundaries intact:

- Credentials, uploads, conversations, and runtime state stay out of Git and screenshots. Use synthetic fixtures and generic endpoints.
- Project brief changes require review. Files are sent only when selected as context.
- Closing a view does not cancel work. Stop must be explicit, partial output must remain recoverable, and interrupted paid requests must not replay automatically.
- Temporary chats stay out of saved history, search, backups, and project memory until Keep chat is chosen.
- Provider capabilities are checked per deployment. Unsupported options should produce a useful error rather than silently disappear.

## Pull requests

Describe the user problem, the resulting behavior, and the checks you ran. Include any data-format or privacy implications. Use the [security policy](SECURITY.md) to report vulnerabilities privately.

Contributions are licensed under the [MIT License](LICENSE).
