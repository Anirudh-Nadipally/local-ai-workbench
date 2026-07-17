import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local AI Workbench",
  description: "A private, local-first Azure AI workspace for conversations, files, reviewed memory, and bounded synthesis.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full overflow-hidden"><Providers>{children}</Providers></body>
    </html>
  );
}
