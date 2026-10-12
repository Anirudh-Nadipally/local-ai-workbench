import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "mammoth", "pdfjs-dist"],
  poweredByHeader: false,
  experimental: { proxyClientMaxBodySize: "110mb" },
};
export default config;
