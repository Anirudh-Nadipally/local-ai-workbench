# Security policy

## Reporting a vulnerability

Please do not open a public issue for suspected credential exposure, path traversal, cross-origin mutation, backup leakage, or another security vulnerability. Use the repository's private GitHub security advisory flow.

Include the affected version, reproduction steps, impact, and a minimal proof of concept that contains no real credentials or personal data.

## Supported version

Security fixes target the latest release on the default branch.

## Security boundaries

Local AI Workbench is designed for one trusted user on one machine. It binds to loopback and does not include multi-user authentication or authorization. Do not expose it directly to a LAN or the public internet.

Model requests leave the machine and are governed by the configured Azure service. The application can reduce and disclose the transmitted context, but it cannot make a remote API call local.

The `data/` directory contains sensitive local state. Protect it with normal operating-system account and disk security, and handle backups as sensitive files even though API credentials are excluded.

Temporary chats use local storage so they can survive navigation and refresh. They are excluded from saved history, search, and backups, and are removed by End & delete or expiry cleanup. This is application-level deletion, not forensic disk erasure. Provider retention is separate; OpenAI-compatible temporary requests send `store: false`.

## Dependency status — 12 October 2026

The release's production audit reports no critical or high findings. Three moderate findings trace to one advisory: [sprintf-js unbounded precision denial of service](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), through `mammoth → argparse → sprintf-js`.

Workbench uses Mammoth's document extraction library, not its command-line program. Inspection and a synthetic DOCX extraction confirmed that the extraction path did not load `argparse` or `sprintf-js`. The dependency is still present in the installed package. No compatible upstream fix was available at verification time; the audit's proposed Mammoth downgrade would replace the supported library with an older incompatible version.

Patched `concurrently`/`shell-quote` and `source-map-js` versions are recorded in the lockfile. Recheck advisories when updating dependencies; this snapshot is not a guarantee against other vulnerabilities.
