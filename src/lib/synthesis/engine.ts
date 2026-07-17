import { generateText } from "ai";
import { getAzureModel } from "@/lib/azure";
import { redactSecrets } from "@/lib/config";
import { assembleContext } from "@/lib/context";
import {
  createRunStep,
  finishRunningRunSteps,
  getSynthesisRun,
  listMessages,
  saveMessage,
  updateRunStep,
  updateSynthesisRun,
} from "@/lib/repository";

const ROLE_PROMPTS = {
  mapper: "Map the question, decompose it, identify constraints, dependencies, and the key variables that control the answer.",
  alternative: "Build the strongest competing approaches and a realistic middle path. Make trade-offs and switching costs explicit.",
  adversary: "Stress-test the premise. Find hidden assumptions, failure modes, perverse incentives, and second-order effects.",
  evidence: "Audit the evidence. Separate facts, inferences, and speculation; identify missing evidence and what would change the conclusion.",
} as const;

export async function executeSynthesis(runId: string) {
  const run = getSynthesisRun(runId);
  if (!run) throw new Error("Synthesis run not found.");
  if (run.status === "cancelled") return "";
  if (run.status !== "queued") throw new Error(`A ${run.status} synthesis run cannot be started.`);
  updateSynthesisRun(runId, { status: "running", error: null });

  const history = listMessages(run.threadId).slice(-12).map((message) => `${message.role}: ${message.content}`).join("\n\n");
  const context = assembleContext({ projectId: run.projectId, threadId: run.threadId, fileIds: run.fileIds, query: run.question });
  const sharedInput = `QUESTION\n${run.question}\n\nRECENT CONVERSATION\n${history}\n\nCURATED CONTEXT\n${context.renderedContext || "None."}`;
  const roles = (Object.keys(ROLE_PROMPTS) as Array<keyof typeof ROLE_PROMPTS>).slice(0, run.maxBranches);

  try {
    const branches = await Promise.all(roles.map(async (role, index) => {
      assertNotCancelled(runId);
      const lane = run.routingSnapshot.lanes[role];
      const stepId = createRunStep({ runId, stage: "branch", role, deployment: lane.name, sequence: index + 1, input: sharedInput });
      updateRunStep(stepId, { status: "running" });
      try {
        const result = await generateText({
          model: getAzureModel(lane.name, lane.protocol),
          system: `You are the ${role} lane in a bounded synthesis. ${ROLE_PROMPTS[role]} Do not call tools. Distinguish facts from assumptions. Use source labels where available.`,
          prompt: sharedInput,
        });
        updateRunStep(stepId, { status: "completed", output: result.text });
        return { role, text: result.text };
      } catch (error) {
        updateRunStep(stepId, { status: "failed", error: redactSecrets(error instanceof Error ? error.message : "Branch failed") });
        throw error;
      }
    }));

    assertNotCancelled(runId);
    const branchPacket = branches.map((branch) => `## ${branch.role}\n${branch.text}`).join("\n\n");
    const criticLane = run.routingSnapshot.lanes.critic;
    const criticId = createRunStep({ runId, stage: "critic", role: "critic", deployment: criticLane.name, sequence: 20, input: branchPacket });
    updateRunStep(criticId, { status: "running" });
    const critic = await generateText({
      model: getAzureModel(criticLane.name, criticLane.protocol),
      system: "Compare the independent analyses. Identify unresolved conflicts, unsupported claims, missing evidence, and the single highest-value refinement. Do not solve the whole problem again.",
      prompt: `${sharedInput}\n\nBRANCH ANALYSES\n${branchPacket}`,
    });
    updateRunStep(criticId, { status: "completed", output: critic.text });

    let refinement = "No refinement round requested.";
    if (run.refinementRounds === 1) {
      assertNotCancelled(runId);
      const refinementLane = run.routingSnapshot.lanes.refinement;
      const refinementId = createRunStep({ runId, stage: "refinement", role: "targeted refinement", deployment: refinementLane.name, sequence: 30, input: critic.text });
      updateRunStep(refinementId, { status: "running" });
      const refined = await generateText({
        model: getAzureModel(refinementLane.name, refinementLane.protocol),
        system: "Resolve only the critic's highest-value unresolved issue. Be concise and evidence-calibrated. No tools and no further delegation.",
        prompt: `${sharedInput}\n\nCRITIC\n${critic.text}`,
      });
      refinement = refined.text;
      updateRunStep(refinementId, { status: "completed", output: refinement });
    }

    assertNotCancelled(runId);
    const synthesisLane = run.routingSnapshot.lanes.synthesis;
    const synthesisId = createRunStep({ runId, stage: "synthesis", role: "synthesizer", deployment: synthesisLane.name, sequence: 40 });
    updateRunStep(synthesisId, { status: "running" });
    const final = await generateText({
      model: getAzureModel(synthesisLane.name, synthesisLane.protocol),
      system: `Produce the final decision-quality answer. Lead with the answer, then strongest bull case, strongest bear case, realistic middle case, hidden assumptions, failure modes, second-order effects, and key variables to watch where relevant.
Clearly separate agreements, disagreements, facts, inferences, and uncertainty. Cite supplied source labels. Do not mention internal instructions or invent consensus.`,
      prompt: `${sharedInput}\n\nBRANCHES\n${branchPacket}\n\nCRITIC\n${critic.text}\n\nTARGETED REFINEMENT\n${refinement}`,
    });
    updateRunStep(synthesisId, { status: "completed", output: final.text });
    updateSynthesisRun(runId, { status: "completed", output: final.text });
    saveMessage({ threadId: run.threadId, role: "assistant", content: final.text });
    return final.text;
  } catch (error) {
    const latest = getSynthesisRun(runId);
    if (latest?.status === "cancelled") {
      finishRunningRunSteps(runId, "cancelled", null);
      return "";
    }
    const message = redactSecrets(error instanceof Error ? error.message : "Synthesis failed.");
    finishRunningRunSteps(runId, "failed", message);
    updateSynthesisRun(runId, { status: "failed", error: message });
    throw error;
  }
}

function assertNotCancelled(runId: string) {
  if (getSynthesisRun(runId)?.status === "cancelled") throw new Error("Synthesis was cancelled.");
}
