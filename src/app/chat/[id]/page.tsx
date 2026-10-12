import { notFound } from "next/navigation";
import { Conversation } from "@/components/conversation";
import { view } from "@/server/workspace";
import { get } from "@/server/db";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!get("thread", id)) notFound();
  return <Conversation key={id} initial={view(id)} />;
}
