import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { PRIMARY_PROMPT } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20 MB ceiling

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    const firstName = String(form.get("firstName") || "").trim();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const focus = String(form.get("focus") || "").trim();
    const durationSeconds = Number(form.get("durationSeconds") || 0);

    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: "audio missing" }, { status: 400 });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "audio too large" }, { status: 413 });
    }
    if (!firstName || !email || !focus) {
      return NextResponse.json({ error: "missing fields" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "invalid email" }, { status: 400 });
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds < 5) {
      return NextResponse.json({ error: "invalid duration" }, { status: 400 });
    }

    const ext = pickExt(audio.type);
    const key = `recordings/${Date.now()}-${cryptoRandom(12)}${ext}`;

    const blob = await put(key, audio, {
      access: "private",
      contentType: audio.type || "audio/webm",
      addRandomSuffix: false,
    });

    const recordedAt = new Date();
    // DELIVERY_DELAY_MINUTES takes priority for local testing; falls back to days.
    const delayMinutes = process.env.DELIVERY_DELAY_MINUTES
      ? Number(process.env.DELIVERY_DELAY_MINUTES)
      : Number(process.env.DELIVERY_DELAY_DAYS || 10) * 24 * 60;
    const deliverAt = new Date(recordedAt.getTime() + delayMinutes * 60_000);

    const eventName = process.env.EVENT_NAME || null;

    await sql`
      insert into sessions (
        first_name, email, focus, prompt, audio_url, audio_pathname,
        duration_seconds, event_name, recorded_at, deliver_at
      ) values (
        ${firstName}, ${email}, ${focus}, ${PRIMARY_PROMPT},
        ${blob.url}, ${blob.pathname},
        ${Math.round(durationSeconds)},
        ${eventName}, ${recordedAt}, ${deliverAt}
      )
    `;

    return NextResponse.json({
      ok: true,
      deliverAt: deliverAt.toISOString(),
    });
  } catch (err) {
    console.error("upload failed", err);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}

function pickExt(mime: string): string {
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  return ".webm";
}

function cryptoRandom(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
