import { put } from "@vercel/blob";
import type { BrainMap, CorticalRegion } from "@/lib/signals";

/**
 * Call the Railway brain-service with the audio recording. The service
 * runs TRIBE v2 + Destrieux region decoder + brand-styled nilearn render,
 * returns base64 PNG + region metadata. We then stash the PNG in Vercel
 * Blob (private) and return a BrainMap pointing at it.
 *
 * Returns null if BRAIN_SERVICE_URL is not configured (in which case the
 * rest of the analysis pipeline continues without a brain image — the
 * brain layer is non-load-bearing on purpose).
 *
 * License caveat: TRIBE v2 is CC BY-NC. Calling code must respect that.
 */
export async function renderBrain(audio: Blob): Promise<BrainMap | null> {
  const url = process.env.BRAIN_SERVICE_URL;
  if (!url) {
    console.warn("BRAIN_SERVICE_URL not set — skipping brain render");
    return null;
  }

  const fd = new FormData();
  fd.append("audio", audio, "recording.webm");
  fd.append("return_b64", "true");

  const headers: Record<string, string> = {};
  if (process.env.BRAIN_SERVICE_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.BRAIN_SERVICE_TOKEN}`;
  }

  const target = `${url.replace(/\/+$/, "")}/render`;
  console.log("[brain] POST", target);

  const res = await fetch(target, {
    method: "POST",
    headers,
    body: fd,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`brain-service ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    brain_image_base64: string;
    top_regions: CorticalRegion[];
    dominant_yeo_network: string | null;
    peak_timestep: number;
  };

  if (!data.brain_image_base64) {
    throw new Error("brain-service returned empty image");
  }

  // Persist to Vercel Blob as a private image. Name keyed by timestamp +
  // random suffix to avoid collisions.
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
    // with a Vercel Blob URL to the synced TRIBE → ffmpeg MP4.
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
