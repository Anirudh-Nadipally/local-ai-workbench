# Contributing

Thank you for improving Local AI Workbench.

## Before opening a pull request

1. Open an issue for substantial product or architecture changes.
2. Keep the local-first boundary intact: credentials, uploads, conversations, and runtime state must never become tracked files or browser-persisted secrets.
3. Preserve provider capability checks. Do not silently discard unsupported reasoning, streaming, or structured-output settings.
4. Keep memory writes human-reviewed and synthesis runs bounded.
5. Add or update tests for behavior changes.

## Local development

```bash
npm install
npm run db:migrate
npm run dev
```

Before submitting:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Use mocked credentials and generic endpoint names in fixtures, documentation, screenshots, and bug reports. Never paste production keys, local database contents, personal file paths, or conversation exports into an issue.

## Pull requests

Keep changes focused and explain:

- the user problem;
- the behavior before and after;
- security or privacy implications;
- the checks you ran.

By contributing, you agree that your work is licensed under the MIT License.
