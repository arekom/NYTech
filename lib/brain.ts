import { put } from "@vercel/blob";
import type { BrainMap, CorticalRegion } from "@/lib/signals";

/**
 * Call the RunPod Serverless brain-service endpoint to render a brand-styled
 * cortical activation map from a recording. The handler runs Meta's TRIBE v2
 * model under the hood; CC BY-NC license applies — research / internal demos
 * only.
 *
 * Architecture:
 *   - Vercel POSTs to RunPod's /runsync endpoint with the audio as base64 JSON
 *   - RunPod queues the job, spins up (or reuses) a GPU worker, runs handler()
 *   - Response includes a base64 PNG + region metadata; we persist the PNG
 *     to Vercel Blob and return the BrainMap to /api/analyze
 *
 * Returns null (with a console warning) when the required env vars are
 * missing, so the analyze pipeline degrades gracefully — booth output still
 * renders without the brain section if the brain service is unavailable.
 */
export async function renderBrain(audio: Blob): Promise<BrainMap | null> {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpointId || !apiKey) {
    console.warn("RUNPOD_ENDPOINT_ID or RUNPOD_API_KEY not set — skipping brain render");
    return null;
  }

  // Base64-encode the audio for the JSON payload. RunPod's /runsync accepts
  // up to ~20 MB; our single-take audio is ~1 MB → ~1.3 MB base64. Fits.
  const audioBuffer = Buffer.from(await audio.arrayBuffer());
  const audioB64 = audioBuffer.toString("base64");
  const audioFormat = audio.type.includes("webm")
    ? "webm"
    : audio.type.includes("mp4")
    ? "m4a"
    : audio.type.includes("ogg")
    ? "ogg"
    : audio.type.includes("wav")
    ? "wav"
    : "webm";

  // /runsync blocks until the job completes (or hits RunPod's request
  // timeout, ~5 min). Fits our Vercel maxDuration=180s with brain render
  // taking ~30-60s on a 24GB GPU.
  const target = `https://api.runpod.ai/v2/${endpointId}/runsync`;
  console.log("[brain] POST", target);

  const res = await fetch(target, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        audio_b64: audioB64,
        audio_format: audioFormat,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`runpod ${res.status}: ${body.slice(0, 200)}`);
  }

  const runpodResponse = (await res.json()) as {
    id: string;
    status: string;
    output?: {
      brain_image_base64: string;
      top_regions: CorticalRegion[];
      dominant_yeo_network: string | null;
      transcript_text: string;
      peak_timestep: number;
      error?: string;
    };
    error?: string;
    delayTime?: number;
    executionTime?: number;
  };

  // RunPod sometimes responds with status="IN_QUEUE" or "IN_PROGRESS" if
  // /runsync hits its internal timeout before the job finishes. Treat
  // anything other than COMPLETED as a failure for our sync use case.
  if (runpodResponse.status !== "COMPLETED") {
    throw new Error(
      `runpod status=${runpodResponse.status}; ` +
      `error=${runpodResponse.error ?? "(none)"}`
    );
  }

  const data = runpodResponse.output;
  if (!data) {
    throw new Error("runpod returned empty output");
  }
  if (data.error) {
    throw new Error(`runpod handler error: ${data.error}`);
  }
  if (!data.brain_image_base64) {
    throw new Error("runpod returned no brain_image_base64");
  }

  // Persist PNG to Vercel Blob as a private image so the Confirmation
  // screen + email can reference it by URL.
  const png = Buffer.from(data.brain_image_base64, "base64");
  const key = `brain-maps/${Date.now()}-${cryptoRandom(8)}.png`;
  const blob = await put(key, png, {
    access: "private",
    contentType: "image/png",
    addRandomSuffix: false,
  });

  return {
    image_url: blob.url,
    // Phase 1 ships the peak-frame PNG only. Phase 2 will populate this
    // with a Vercel Blob URL to a synced TRIBE → ffmpeg MP4.
    video_url: null,
    top_regions: data.top_regions,
    dominant_yeo_network: data.dominant_yeo_network,
    peak_timestep: data.peak_timestep,
  };
}

function cryptoRandom(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
