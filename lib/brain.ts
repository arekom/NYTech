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

  // /runsync blocks until either the job completes OR RunPod's internal
  // sync-timeout (~30s default) elapses. On a cold worker our render takes
  // 1–3 minutes, so the initial call will frequently return with
  // status="IN_PROGRESS" + a job ID. We then poll /status/{jobId} until
  // the job hits a terminal state.
  const runsyncUrl = `https://api.runpod.ai/v2/${endpointId}/runsync`;
  console.log("[brain] POST", runsyncUrl);

  const res = await fetch(runsyncUrl, {
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

  type RunpodOutput = {
    brain_image_base64: string;
    top_regions: CorticalRegion[];
    dominant_yeo_network: string | null;
    transcript_text: string;
    peak_timestep: number;
    error?: string;
  };
  type RunpodResponse = {
    id: string;
    status: string;
    output?: RunpodOutput;
    error?: string;
    delayTime?: number;
    executionTime?: number;
  };

  let runpodResponse = (await res.json()) as RunpodResponse;

  // If RunPod's sync window expired, poll /status until done. Budget here
  // is sized to fit Vercel's maxDuration=180s with headroom for the rest
  // of the analyze pipeline.
  if (runpodResponse.status !== "COMPLETED" && runpodResponse.status !== "FAILED") {
    console.log(`[brain] /runsync returned ${runpodResponse.status}; polling /status/${runpodResponse.id}`);
    runpodResponse = await pollRunpodJob({
      endpointId,
      apiKey,
      jobId: runpodResponse.id,
      // Vercel Pro caps the surrounding function at 300s. Budget 250s
      // here, leaving ~50s for Whisper + GPT extract + GPT synthesis +
      // DB write + uploads in /api/analyze. Cold-cache RunPod renders
      // are ~3 min; warm-worker steady-state is ~45–60s, well inside.
      maxWaitMs: 250_000,
      pollIntervalMs: 3_000,
    });
  }

  if (runpodResponse.status === "FAILED") {
    throw new Error(
      `runpod job FAILED; error=${runpodResponse.error ?? "(none)"}`
    );
  }
  if (runpodResponse.status !== "COMPLETED") {
    throw new Error(
      `runpod job did not complete (final status=${runpodResponse.status})`
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

  // Persist PNG to Vercel Blob as a PUBLIC image — both the Confirmation
  // screen (browser <img>) and the delivery email need to load this
  // directly without auth headers. Privacy is upheld by the random suffix
  // in the key; URLs aren't enumerable. The brand-styled visualization
  // itself contains no PII (it's a colored cortex with region labels).
  const png = Buffer.from(data.brain_image_base64, "base64");
  const key = `brain-maps/${Date.now()}-${cryptoRandom(12)}.png`;
  const blob = await put(key, png, {
    access: "public",
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

/**
 * Poll RunPod's /status/{jobId} endpoint until the job reaches a terminal
 * state (COMPLETED / FAILED / CANCELLED) or our budget runs out.
 *
 * RunPod /runsync only blocks for ~30s before returning IN_PROGRESS with
 * a job id; for cold-cache renders (1–3 min) we need to follow up via
 * /status. Polling cadence (3s) balances RunPod's API rate limits against
 * timely completion detection.
 */
async function pollRunpodJob(opts: {
  endpointId: string;
  apiKey: string;
  jobId: string;
  maxWaitMs: number;
  pollIntervalMs: number;
}): Promise<{
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
}> {
  const { endpointId, apiKey, jobId, maxWaitMs, pollIntervalMs } = opts;
  const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;
  const startedAt = Date.now();

  while (true) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const res = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`runpod /status ${res.status}`);
    }
    const body = await res.json();
    if (
      body.status === "COMPLETED" ||
      body.status === "FAILED" ||
      body.status === "CANCELLED"
    ) {
      return body;
    }

    if (Date.now() - startedAt > maxWaitMs) {
      // Best-effort cancel so the worker doesn't keep running on our dime.
      fetch(`https://api.runpod.ai/v2/${endpointId}/cancel/${jobId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      }).catch(() => {});
      throw new Error(
        `runpod job ${jobId} did not finish within ${Math.round(maxWaitMs / 1000)}s ` +
        `(last status=${body.status}); cancelled`
      );
    }
  }
}
