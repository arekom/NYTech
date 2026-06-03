import { put, issueSignedToken, presignUrl } from "@vercel/blob";
import type { BrainMap, CorticalRegion } from "@/lib/signals";

/** Confirmation-screen signed URL validity. 24 hours covers the booth
 *  experience + any operator debugging the same day. The cron mints a
 *  fresh URL when sending the 10-day-later email. */
const CONFIRMATION_URL_VALID_HOURS = 24;

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
export async function renderBrain(takes: { audio: Blob }[]): Promise<BrainMap | null> {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpointId || !apiKey) {
    console.warn("RUNPOD_ENDPOINT_ID or RUNPOD_API_KEY not set — skipping brain render");
    return null;
  }
  if (!takes.length) {
    console.warn("renderBrain called with no takes — skipping");
    return null;
  }

  // Base64-encode each take. RunPod's /runsync accepts up to ~20 MB;
  // 5 × ~1 MB = ~5 MB raw → ~6.7 MB base64. Well within the limit.
  // Handler concatenates them with ffmpeg before running TRIBE so
  // frame_times spans the full multi-take recording.
  const audioTakesB64: string[] = [];
  for (const take of takes) {
    const buf = Buffer.from(await take.audio.arrayBuffer());
    audioTakesB64.push(buf.toString("base64"));
  }
  // All takes come from the same MediaRecorder session → same MIME, so
  // sample the first to pick a format hint for the handler.
  const firstType = takes[0].audio.type;
  const audioFormat = firstType.includes("webm")
    ? "webm"
    : firstType.includes("mp4")
    ? "m4a"
    : firstType.includes("ogg")
    ? "ogg"
    : firstType.includes("wav")
    ? "wav"
    : "webm";

  // /runsync blocks until either the job completes OR RunPod's internal
  // sync-timeout (~30s default) elapses. On a cold worker our render takes
  // 1–3 minutes, so the initial call will frequently return with
  // status="IN_PROGRESS" + a job ID. We then poll /status/{jobId} until
  // the job hits a terminal state.
  const runsyncUrl = `https://api.runpod.ai/v2/${endpointId}/runsync`;
  console.log("[brain] POST", runsyncUrl, `(${takes.length} take${takes.length === 1 ? "" : "s"})`);

  const res = await fetch(runsyncUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        audio_takes_b64: audioTakesB64,
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
    // Phase: brain video. Optional so an older handler.py revision (or a
    // future packing-disabled path) still works — we just won't have a
    // playable cortex in that case.
    activations_b64?: string;
    activations_dtype?: string;
    activations_layout?: string;
    frame_count?: number;
    vertex_count?: number;
    frame_times?: number[];
    peak_timestep_packed?: number;
    audio_duration_seconds?: number;
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
      // DB write + uploads in /api/analyze.
      //
      // Timing baselines (after the multi-take concat work — TRIBE now
      // runs on the FULL recording, not just the longest take):
      //   - Cold worker, cold network cache: ~5–6 min — DOES NOT FIT.
      //     Mitigated by RunPod network volume + min active workers ≥ 1.
      //   - Cold worker, warm cache: ~3 min (Llama model + WhisperX env
      //     load from disk to VRAM).
      //   - Warm worker, ~3-min recording at text_feature.batch_size=32:
      //     ~150-200s. Fits.
      // If embed time keeps dominating, increase batch_size further in
      // brain-service/inference.py (24 GB L4 has headroom up to ~64).
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

  // Persist PNG to Vercel Blob. Our store is configured as Private Read
  // so per-blob public access isn't allowed — we generate a signed URL
  // instead. Confirmation screen uses a short-lived URL; the cron will
  // re-sign from `image_pathname` at email-send time.
  const png = Buffer.from(data.brain_image_base64, "base64");
  const key = `brain-maps/${Date.now()}-${cryptoRandom(12)}.png`;
  const blob = await put(key, png, {
    access: "private",
    contentType: "image/png",
    addRandomSuffix: false,
  });

  const validUntil = Date.now() + CONFIRMATION_URL_VALID_HOURS * 3600_000;
  const imageSignedUrl = await mintSignedGetUrl(blob.pathname, validUntil);

  // Phase 2: upload the per-frame activation tensor if the handler sent it.
  // Falls back to an empty/null shape if the handler returned only the PNG
  // (older handler.py revision) so the Confirmation screen still renders
  // — it just won't have a playable cortex video.
  let activationsUrl: string | null = null;
  let activationsPathname: string | null = null;
  if (data.activations_b64 && data.frame_count && data.vertex_count) {
    const activationsBuf = Buffer.from(data.activations_b64, "base64");
    const activationsKey = `brain-maps/${Date.now()}-${cryptoRandom(12)}.f16`;
    const activationsBlob = await put(activationsKey, activationsBuf, {
      access: "private",
      // Custom mime so a curious operator opening the URL sees what it is.
      contentType: "application/octet-stream",
      addRandomSuffix: false,
    });
    activationsUrl = await mintSignedGetUrl(activationsBlob.pathname, validUntil);
    activationsPathname = activationsBlob.pathname;
  }

  return {
    image_url: imageSignedUrl,
    image_pathname: blob.pathname,
    // Phase 1 ships the peak-frame PNG only. Phase 2 will populate this
    // with a Vercel Blob URL to a synced TRIBE → ffmpeg MP4.
    video_url: null,
    top_regions: data.top_regions,
    dominant_yeo_network: data.dominant_yeo_network,
    peak_timestep: data.peak_timestep,
    activations_url: activationsUrl,
    activations_pathname: activationsPathname,
    frame_count: data.frame_count ?? 0,
    vertex_count: data.vertex_count ?? 0,
    frame_times: data.frame_times ?? [],
    peak_timestep_packed: data.peak_timestep_packed ?? 0,
    audio_duration_seconds: data.audio_duration_seconds ?? 0,
  };
}

/**
 * Mint a Vercel Blob signed GET URL valid until `validUntil` (epoch ms).
 * Wrapper around issueSignedToken + presignUrl since we now do this twice
 * per render (image + activations binary).
 */
async function mintSignedGetUrl(pathname: string, validUntil: number): Promise<string> {
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(
    {
      clientSigningToken: token.clientSigningToken,
      delegationToken: token.delegationToken,
    },
    {
      operation: "get",
      pathname,
      access: "private",
    }
  );
  return presignedUrl;
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
