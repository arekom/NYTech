import { getRunpodConfig, skipBrainRender } from "./brain-config";
import { markBrainWarmed, shouldWarmBrain } from "./brain-warm-state";

export type WarmupResult =
  | { action: "skipped"; reason: string }
  | { action: "submitted"; jobId: string }
  | { action: "debounced" };

/** Submit async warmup job. Does not wait for GPU completion. */
export async function submitBrainWarmup(): Promise<WarmupResult> {
  if (skipBrainRender()) {
    return { action: "skipped", reason: "SKIP_BRAIN_RENDER" };
  }
  const cfg = getRunpodConfig();
  if (!cfg) {
    return { action: "skipped", reason: "missing RUNPOD_* env" };
  }
  if (!shouldWarmBrain()) {
    return { action: "debounced" };
  }

  const url = `https://api.runpod.ai/v2/${cfg.endpointId}/run`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: { warmup_only: true } }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`runpod warmup /run ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("runpod warmup: no job id");

  markBrainWarmed();
  console.log("[brain-warm] submitted job", data.id);
  return { action: "submitted", jobId: data.id };
}
