# Upgrading from the earlier workbench

This rebuild uses a new database format. Keep the old installation and its `data/` folder intact while you import and check your work. An old backup archive cannot be restored directly into the new format; use migration instead.

## Install alongside the old version

Stop the old app and worker. Make a private copy of the old installation's `data/` folder, then clone the current version into a different folder:

```bash
git clone https://github.com/Anirudh-Nadipally/local-ai-workbench.git workbench-new
cd workbench-new
npm ci
npm run build
WORKBENCH_LEGACY_DIR="/absolute/path/to/old-workbench" PORT=3025 npm start
```

Replace the example path with the old repository folder, which contains `data/workbench.db`. The new app creates its own `data/` folder. Never set `WORKBENCH_DATA_DIR` to the old workspace's data directory.

## Import and review

Open **Settings → Bring useful work forward**. Select the conversations to import. Migration reads the old database without changing it and records imported IDs so the same conversation is not copied twice.

It brings over conversation history, associated files, projects, and completed synthesis results as saved outputs. Branch relationships are preserved when their parent conversations are also imported. Accepted legacy memory becomes a proposed project brief for review. Running jobs are not imported.

Connection transfer is a separate action. Transferred deployment registrations need fresh text, image, and PDF checks before use; you can also enter your connection manually. Review any migration warnings, open the imported conversations, and check their files before retiring the old installation.

You can omit `WORKBENCH_LEGACY_DIR` on later starts once migration is complete.

## Updating this rebuilt version later

Create a backup in Settings, stop the app and worker, and run the following from its repository folder:

```bash
git pull --ff-only
npm ci
npm run build
PORT=3025 npm start
```

Reinstall dependencies and rebuild after pulling updates. The macOS launcher only installs dependencies or builds when those folders are missing; it does not refresh an existing build automatically.

## Moving a backup

Use **Settings → Backup and restore** to download an archive. Restore it into an empty workspace running this rebuilt version. Restore validates archive paths, records, references, and file hashes. It preserves any connection already configured at the destination and never replays imported jobs.

Backups omit API credentials and temporary chats. Saved conversations and original files are included, so keep backup archives private.
