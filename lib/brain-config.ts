export function skipBrainRender(): boolean {
  const v = process.env.SKIP_BRAIN_RENDER?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getRunpodConfig(): { endpointId: string; apiKey: string } | null {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID?.trim();
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  if (!endpointId || !apiKey) return null;
  return { endpointId, apiKey };
}

/** Treat RunPod as cold if no warmup in this many ms (under idle timeout 300s). */
export const BRAIN_COLD_AFTER_MS = 4 * 60 * 1000;
