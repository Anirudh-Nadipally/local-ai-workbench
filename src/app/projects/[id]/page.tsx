import { sourceSummaries } from "@/server/db";
import { draftSummaries } from "@/server/drafts";
import { notFound } from "next/navigation";
import { ProjectPage } from "@/components/project";
import { all, get } from "@/server/db";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = get("project", id);
  if (!project) notFound();
  return (
    <ProjectPage
      key={id}
      initial={{
        project,
        drafts: draftSummaries(undefined, id),
        brief: project.briefId ? get("brief", project.briefId) : null,
        revisions: all("brief").filter((b) => b.projectId === id),
        threads: all("thread").filter(
          (t) => t.projectId === id && !t.deletedAt,
        ),
        sources: sourceSummaries()
          .filter((s) => s.projectId === id)
          .map((s) => ({ ...s, text: "", sections: [] })),
        outputs: all("output").filter((o) => o.projectId === id),
      }}
    />
  );
}
