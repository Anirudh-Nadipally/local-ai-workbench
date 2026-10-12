import { notFound } from "next/navigation";
import { OutputPage } from "@/components/output";
import { get } from "@/server/db";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const output = get("output", (await params).id);
  if (!output) notFound();
  return <OutputPage key={output.id} initial={output} />;
}
