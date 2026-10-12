import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import { boot } from "@/server/workspace";
import "./globals.css";
export const metadata: Metadata = {
  title: "Workbench — room to continue",
  description: "Your local workspace for useful, portable context.",
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Shell initial={boot()}>{children}</Shell>
      </body>
    </html>
  );
}
