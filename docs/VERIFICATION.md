# Verification

## Release checks — 12 October 2026

Verified from a clean checkout of the public repository with the rebuilt application, locked dependencies, and isolated test data. No private workspace data or credentials were used, and no paid model requests were made.

| Check | Result |
| --- | --- |
| Dependency installation | `npm ci` passed; compatible security patches then applied and locked |
| TypeScript | Passed, including fresh Next.js route type generation |
| ESLint | Passed, no warnings |
| Unit and integration tests | 50 passed; 3 browser harness cases skipped in this command and run separately below |
| Production build | Passed with Next.js 16.3.8 |
| Production start | Web app and worker started together; worker heartbeat, workspace API, and home page responded |
| Draft recovery | Desktop and mobile scenarios passed |
| Browser workflows | 14 passed; 2 live-only cases intentionally skipped |
| DOCX extraction smoke check | Passed; command-line dependencies were not loaded |
| Production dependency audit | No critical or high findings; 3 moderate findings from one dependency advisory |

Local environment: macOS and Node.js 22.23.1. CI repeats installation, type checking, lint, unit tests, build, and the browser recovery suite on Ubuntu with Node.js 22. Its current result is available on [GitHub Actions](https://github.com/Anirudh-Nadipally/local-ai-workbench/actions).

## What the tests cover

Draft recovery uses the real browser, API, SQLite database, and job runner. A controlled model stream replaces the paid provider. It checks dismissal during generation, navigation, reload, reopening without another model call, partial output, cancellation, immediate edit-and-close recovery, download, and returned reasoning. Brief proposals require review before becoming approved project context.

The desktop and mobile workflows cover imports, speaker boundaries, document extraction, selected context, project brief revisions, saved outputs, exports, Trash, theme changes, and navigation. Temporary chat checks cover refresh, exclusion from saved history and search, Keep chat, and End & delete. Server tests cover expiry, backup exclusion, attachment cleanup, and preventing a late worker from recreating deleted data.

Other server checks cover frozen request context, stale worker ownership, stale editor writes, backup validation without job replay, encrypted credential updates, scope boundaries, and repeatable migration that leaves the legacy database unchanged. Migration now requires an explicit legacy folder instead of looking in a machine-specific location.

These checks verify behavior and provider-option wiring. They do not establish the answer quality, latency, or supported reasoning options of a particular deployment. The [security policy](../SECURITY.md) records the remaining dependency advisory and its scope.

## Run the checks

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:recovery
```

The recovery command owns an isolated server on port 3042 and a temporary database. Leave that port free. It runs two drafting scenarios and then the Playwright workflow suite. On Linux, use `npx playwright install --with-deps chromium` if browser system libraries are missing.

## Optional live deployment check

Live checks make billable model requests and are disabled by default. Use a separate workspace with synthetic data:

```bash
PORT=3024 WORKBENCH_DATA_DIR=/tmp/workbench-live-check npm run dev
```

Open `http://127.0.0.1:3024`, configure a connection in Settings, and register a deployment that supports text, images, and PDFs. In another terminal in the same repository:

```bash
WORKBENCH_LIVE=1 WORKBENCH_TEST_MODEL="your-deployment-name" npm run test:e2e -- --project=desktop --grep 'live model'
```

The test sends an approved brief, a Markdown document, an original PDF, and an image, then checks the answer, reload, and export preview. Do not run it against your everyday workspace: it creates test records and screenshots. It was not run for this release verification.

## Screenshots

All screenshots contain synthetic test data:

- Workspace: [desktop](home-desktop.png), [mobile](home-mobile.png)
- Handoff review: [desktop](handoff-desktop.png), [mobile](handoff-mobile.png)
- Temporary chat: [desktop](temporary-chat-desktop.png), [mobile](temporary-chat-mobile.png)
