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
