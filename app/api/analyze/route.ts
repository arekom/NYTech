import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { PRIMARY_PROMPT } from "@/lib/prompts";
import { transcribe, analyzeText } from "@/lib/analyze";
import { computeTempo, buildRegisterSignal, type SignalData } from "@/lib/signals";
import type { RegisterData } from "@/lib/pitch";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/** Small delay between sibling stage_done events so UI advance feels paced. */
const STAGE_REVEAL_DELAY_MS = 350;

/**
 * Streaming NDJSON endpoint that powers the Processing screen.
 *
 * Emitted events (one JSON object per line):
 *   { type: "stage_done", id: "receive"   }
 *   { type: "stage_done", id: "certainty", data: CertaintySignal }
 *   { type: "stage_done", id: "tempo",     data: TempoSignal }
 *   { type: "stage_done", id: "register",  data: RegisterSignal }
 *   { type: "stage_done", id: "ownership", data: OwnershipSignal }
 *   { type: "stage_done", id: "seal"      }
 *   { type: "complete",  deliverAt: string, signals: SignalData }
 *   { type: "error",     message: string  }
 *
 * Stage emit order matches the visual order in the Processing UI even though
 * underlying computation completes in a slightly different order (Whisper +
 * GPT in sequence; tempo and register are pure code). A small inter-stage
 * delay paces the reveal so the user perceives each signal individually.
 */
export async function POST(req: Request) {
  let audio: Blob;
  let firstName: string;
  let email: string;
  let focus: string;
  let durationSeconds: number;
  let register: RegisterData;

  try {
    const form = await req.formData();
    const audioField = form.get("audio");
    firstName = String(form.get("firstName") || "").trim();
    email = String(form.get("email") || "").trim().toLowerCase();
    focus = String(form.get("focus") || "").trim();
    durationSeconds = Number(form.get("durationSeconds") || 0);
    const registerJson = String(form.get("register") || "");
    register = registerJson ? JSON.parse(registerJson) : emptyRegister();

    if (!(audioField instanceof Blob)) {
      return NextResponse.json({ error: "audio missing" }, { status: 400 });
    }
    audio = audioField;
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
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad request" },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        // ── Stage 1: upload to blob ───────────────────────────────────────
        const ext = pickExt(audio.type);
        const key = `recordings/${Date.now()}-${cryptoRandom(12)}${ext}`;
        const blob = await put(key, audio, {
          access: "private",
          contentType: audio.type || "audio/webm",
          addRandomSuffix: false,
        });
        emit({ type: "stage_done", id: "receive" });

        // ── Whisper transcription (the long pole) ─────────────────────────
        const transcript = await transcribe(audio);

        // ── Pure-code signals — fast, but held until visual order plays out
        const tempoSignal = computeTempo(transcript.words, transcript.duration);
        const registerSignal = buildRegisterSignal(register);

        // ── GPT text analysis (certainty + ownership in one call) ─────────
        const { certainty, ownership } = await analyzeText(transcript.text);

        // ── Reveal in visual order with small pacing delays ──────────────
        emit({ type: "stage_done", id: "certainty", data: certainty });
        await sleep(STAGE_REVEAL_DELAY_MS);
        emit({ type: "stage_done", id: "tempo", data: tempoSignal });
        await sleep(STAGE_REVEAL_DELAY_MS);
        emit({ type: "stage_done", id: "register", data: registerSignal });
        await sleep(STAGE_REVEAL_DELAY_MS);
        emit({ type: "stage_done", id: "ownership", data: ownership });

        // ── Stage 6: seal — persist to DB ─────────────────────────────────
        const signalData: SignalData = {
          transcript: transcript.text,
          duration_seconds: transcript.duration,
          word_count: transcript.words.length,
          certainty,
          tempo: tempoSignal,
          register: registerSignal,
          ownership,
        };

        const recordedAt = new Date();
        const delayMinutes = process.env.DELIVERY_DELAY_MINUTES
          ? Number(process.env.DELIVERY_DELAY_MINUTES)
          : Number(process.env.DELIVERY_DELAY_DAYS || 10) * 24 * 60;
        const deliverAt = new Date(recordedAt.getTime() + delayMinutes * 60_000);
        const eventName = process.env.EVENT_NAME || null;

        await sql`
          insert into sessions (
            first_name, email, focus, prompt, audio_url, audio_pathname,
            duration_seconds, event_name, transcript, signal_data,
            recorded_at, deliver_at
          ) values (
            ${firstName}, ${email}, ${focus}, ${PRIMARY_PROMPT},
            ${blob.url}, ${blob.pathname},
            ${Math.round(durationSeconds)},
            ${eventName}, ${transcript.text}, ${sql.json(signalData as unknown as Parameters<typeof sql.json>[0])},
            ${recordedAt}, ${deliverAt}
          )
        `;

        emit({ type: "stage_done", id: "seal" });
        emit({
          type: "complete",
          deliverAt: deliverAt.toISOString(),
          signals: signalData,
        });
        controller.close();
      } catch (err) {
        console.error("analyze pipeline failed", err);
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "analysis failed",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function emptyRegister(): RegisterData {
  return {
    samples: [],
    avg_hz: 0,
    min_hz: 0,
    max_hz: 0,
    std_hz: 0,
    drop_count: 0,
    rise_count: 0,
  };
}
