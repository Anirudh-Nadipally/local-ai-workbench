import path from "node:path";

export const rootDir = process.cwd();
export const dataDir = process.env.WORKBENCH_DATA_DIR
  ? path.resolve(process.env.WORKBENCH_DATA_DIR)
  : path.join(rootDir, "data");
export const databasePath = process.env.WORKBENCH_DATABASE_PATH
  ? path.resolve(process.env.WORKBENCH_DATABASE_PATH)
  : path.join(dataDir, "workbench.db");
export const uploadsDir = path.join(dataDir, "uploads");
export const exportsDir = path.join(dataDir, "exports");
export const publicConfigPath = path.join(dataDir, "config.json");
export const secretsPath = path.join(dataDir, "secrets.env");
export const secretsKeyPath = path.join(dataDir, ".secrets-key");

// Stable uppercase aliases keep server-only modules visually distinct from browser-safe values.
export const DATA_DIR = dataDir;
export const DB_PATH = databasePath;
export const UPLOADS_DIR = uploadsDir;
export const EXPORTS_DIR = exportsDir;
export const CONFIG_PATH = publicConfigPath;
export const SECRETS_PATH = secretsPath;
export const SECRETS_KEY_PATH = secretsKeyPath;

export function resolveStoredUploadPath(storedName: string) {
  if (!storedName || storedName === "." || storedName === ".." || path.basename(storedName) !== storedName || !/^[A-Za-z0-9._-]+$/.test(storedName)) {
    throw new Error("The stored file name is invalid.");
  }
  const resolved = path.resolve(UPLOADS_DIR, storedName);
  if (!resolved.startsWith(`${path.resolve(UPLOADS_DIR)}${path.sep}`)) throw new Error("The stored file path is invalid.");
  return resolved;
}
