# Changelog

## 12 October 2026 — Workbench rebuild

The workspace now centers on conversations, selected documents, reviewed project briefs, and work you can take into another tool. This replaces the earlier interface and database layout. Existing users should follow the [upgrade guide](docs/UPGRADING.md).

### Conversations and context

- Import pasted conversations and text/Markdown exports, with speaker review and original text preserved.
- Choose full document text, excerpts, or original image/PDF input for each conversation.
- Carry approved project briefs into project chats; review proposed revisions before accepting them.
- Branch earlier turns and save editable outputs with revision history.

### Drafting and exports

- Handoffs and project brief drafts continue in the local worker when their window closes or you navigate away.
- Partial results survive interruption. Stop is explicit, and interrupted paid requests are not replayed automatically.
- Handoffs explain the next task without requiring Workbench's internal IDs.
- Choose a separate drafting model and effort, edit the export, and reopen earlier saved exports.
- Export Markdown, source bundles, and print-friendly HTML.

### Temporary chats and reasoning

- Temporary chats stay outside saved history, search, backups, and project memory.
- Refresh and navigation preserve them. Keep chat saves them; End & delete removes them. Inactive sessions expire after 24 hours, with cleanup during operation or the next start.
- Deployment-specific controls support OpenAI reasoning effort and Anthropic adaptive or budget-based thinking.
- Response activity shows elapsed time and reasoning returned by the API.

### Local operation

- Run the app and worker together, including through the macOS launcher.
- Migrate selected conversations from the earlier database without modifying it. Imported accepted memory becomes a proposal for review.
- Restore validated backups into an empty workspace without replacing credentials or replaying jobs.
- Require Node.js 22.13 or later. Connections currently support Azure OpenAI and Azure AI Foundry.
- Apply compatible patches for the reported critical and high dependency advisories. The remaining moderate dependency advisory is documented in the [security policy](SECURITY.md).

See the [verification record](docs/VERIFICATION.md) for checks run on this update.
