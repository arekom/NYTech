import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { transcribe, analyzeText } from "@/lib/analyze";
import { renderBrain } from "@/lib/brain";
import { synthesize } from "@/lib/synthesis";
import { empiricalSentiment } from "@/lib/sentiment-empirical";
import { auditSignalData } from "@/lib/forbidden-words";
import {
  computeTempo,
  buildRegisterSignal,
  type BrainMap,
  type SignalData,
  type Synthesis,
  type TakeAudio,
} from "@/lib/signals";
import type { RegisterData } from "@/lib/pitch";
import { QUESTIONS } from "@/lib/prompts";

export const runtime = "nodejs";
/** Vercel Pro caps serverless functions at 300s. Sized to fit even a worst-
 *  case cold-cache RunPod render (~3 min) plus Whisper (~15s) + GPT
 *  extraction (~8s) + synthesis (~10s) + uploads/DB (~5s). */
export const maxDuration = 300;

const MAX_AUDIO_BYTES_PER_TAKE = 20 * 1024 * 1024;
const STAGE_REVEAL_DELAY_MS = 350;

/** When true, skip RunPod TRIBE entirely — booth finishes in ~1–2 min instead
 *  of waiting on GPU. Confirmation shows audio + word-based synthesis only. */
function skipBrainRender(): boolean {
  const v = process.env.SKIP_BRAIN_RENDER?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

type ParsedTake = {
  questionIndex: number;
  audio: Blob;
  durationSeconds: number;
  register: RegisterData;
};

/**
 * Streaming NDJSON endpoint for the booth Processing screen.
 *
 * Input: multipart form with N takes (numbered 1..takeCount):
 *   firstName, email, focus, takeCount
 *   audio_N, durationSeconds_N, register_N, questionIndex_N  (for each take)
 *
 * Emitted events (one JSON object per line):
 *   { type: "stage_done", id: "receive" }
 *   { type: "stage_done", id: "certainty",  data: CertaintySignal }
 *   { type: "stage_done", id: "tempo",      data: TempoSignal }
 *   { type: "stage_done", id: "register",   data: RegisterSignal }
 *   { type: "stage_done", id: "ownership",  data: OwnershipSignal }
 *   { type: "stage_done", id: "brain",      data: BrainMap | null }
 *   { type: "stage_done", id: "synthesis",  data: Synthesis | null }
 *   { type: "stage_done", id: "seal" }
 *   { type: "complete",   deliverAt: string, signals: SignalData }
 *   { type: "error",      message: string }
 */
export async function POST(req: Request) {
  let firstName: string;
  let email: string;
  let focus: string;
  let takes: ParsedTake[];

  try {
    const form = await req.formData();
    firstName = String(form.get("firstName") || "").trim();
    email = String(form.get("email") || "").trim().toLowerCase();
    focus = String(form.get("focus") || "").trim();
    const takeCount = Number(form.get("takeCount") || 0);

    if (!firstName || !email || !focus) {
      return NextResponse.json({ error: "missing fields" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "invalid email" }, { status: 400 });
    }
    if (!Number.isFinite(takeCount) || takeCount < 1 || takeCount > 10) {
      return NextResponse.json({ error: "invalid takeCount" }, { status: 400 });
    }

    takes = [];
    for (let n = 1; n <= takeCount; n++) {
      const audio = form.get(`audio_${n}`);
      const duration = Number(form.get(`durationSeconds_${n}`) || 0);
      const registerJson = String(form.get(`register_${n}`) || "");
      const questionIndex = Number(form.get(`questionIndex_${n}`) || n);

      if (!(audio instanceof Blob)) {
        return NextResponse.json({ error: `audio_${n} missing` }, { status: 400 });
      }
      if (audio.size > MAX_AUDIO_BYTES_PER_TAKE) {
        return NextResponse.json({ error: `audio_${n} too large` }, { status: 413 });
      }
      if (!Number.isFinite(duration) || duration < 5) {
        return NextResponse.json({ error: `take ${n} too short` }, { status: 400 });
      }
      const register: RegisterData = registerJson ? JSON.parse(registerJson) : emptyRegister();
      takes.push({ questionIndex, audio, durationSeconds: duration, register });
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
        // Concatenate IN MEMORY for Whisper, which needs continuous audio
        // for word-level timestamps that span all questions. We do NOT
        // upload this concat to Blob — byte-level WebM concat produces a
        // file where browsers only play the first segment, so each take
        // goes to Blob as its own playable file below.
        const concatenated = await concatBlobs(takes.map((t) => t.audio));
        const totalDuration = takes.reduce((s, t) => s + t.durationSeconds, 0);

        // ── Stage 1: receive — upload each take individually to Blob ─────
        // Folder-per-session keeps it easy to list/cleanup all of a
        // session's takes with a single prefix. Pathname shape:
        //   recordings/<timestamp>-<rand>/q<N>.webm
        const sessionFolder = `${Date.now()}-${cryptoRandom(12)}`;
        const takeUploads = await Promise.all(
          takes.map(async (take) => {
            const ext = pickExt(take.audio.type);
            const key = `recordings/${sessionFolder}/q${take.questionIndex}${ext}`;
            const uploaded = await put(key, take.audio, {
              access: "private",
              contentType: take.audio.type || "audio/webm",
              addRandomSuffix: false,
            });
            return { uploaded, take };
          })
        );
        const takeAudios: TakeAudio[] = takeUploads.map(({ uploaded, take }) => ({
          question_index: take.questionIndex,
          pathname: uploaded.pathname,
          duration_seconds: take.durationSeconds,
        }));
        // Legacy `audio_*` columns point at the first take so any old reader
        // (an un-updated cron, a manual SQL query, etc.) still gets a valid
        // single playable URL — just Q1's audio instead of all five.
        const primaryUpload = takeUploads[0].uploaded;
        emit({ type: "stage_done", id: "receive" });

        // ── TRIBE brain render in parallel with Whisper (optional) ─────────
        // Not required for delivery: synthesis + Confirmation degrade to
        // transcript-only when brain_map is null. Set SKIP_BRAIN_RENDER=true
        // on Vercel if RunPod routinely exceeds the 300s function cap.
        let brainPromise: Promise<BrainMap | null>;
        if (skipBrainRender()) {
          console.log("[analyze] SKIP_BRAIN_RENDER — skipping RunPod brain render");
          brainPromise = Promise.resolve(null);
        } else {
          console.log("[analyze] brain render started (parallel with Whisper)");
          brainPromise = renderBrain(takes.map((t) => ({ audio: t.audio }))).catch((err) => {
            console.warn("brain render failed:", err instanceof Error ? err.message : err);
            return null;
          });
        }

        // ── Whisper transcription of the full concatenated audio ─────────
        const transcript = await transcribe(concatenated);

        // ── Build question-tagged transcript using take boundaries ───────
        const taggedTranscript = tagTranscriptByQuestion(
          transcript.text,
          transcript.words,
          takes
        );

        // ── Pure-code signals from word timestamps + client pitch ────────
        const tempoSignal = computeTempo(transcript.words, transcript.duration);
        // Register: combine all takes' samples into one summary so the gauge
        // reflects the whole session. Simple approach: arithmetic mean of
        // per-take summaries weighted by sample count. Phase 2 can revisit.
        const registerSignal = buildRegisterSignal(mergeRegister(takes.map((t) => t.register)));

        // ── GPT extraction (brain still running from above) ──────────────
        const extractionPromise = analyzeText(taggedTranscript);

        const extraction = await extractionPromise;

        // Patch ownership.self_focus_ratio with word count now available
        const wordCount = transcript.words.length;
        if (wordCount > 0) {
          extraction.ownership.self_focus_ratio =
            extraction.ownership.first_person_count / wordCount;
        }

        // Empirical sentiment via AFINN-165 — deterministic cross-check
        // against the LLM's overall_score. Surfaced alongside, not replacing.
        const empirical = empiricalSentiment(transcript.text);
        extraction.sentiment.empirical_score = empirical.score;
        extraction.sentiment.empirical_hits = empirical.hits;

        // Reveal extraction-derived stages in visual order
        emit({ type: "stage_done", id: "certainty", data: extraction.certainty });
        await sleep(STAGE_REVEAL_DELAY_MS);
        emit({ type: "stage_done", id: "tempo", data: tempoSignal });
        await sleep(STAGE_REVEAL_DELAY_MS);
        emit({ type: "stage_done", id: "register", data: registerSignal });
        await sleep(STAGE_REVEAL_DELAY_MS);
        emit({ type: "stage_done", id: "ownership", data: extraction.ownership });

        // ── Wait on brain (overlapped Whisper + extraction) ────────────
        const brain_map: BrainMap | null = await brainPromise;
        emit({ type: "stage_done", id: "brain", data: brain_map });

        // ── Synthesis (needs both extraction + brain) ────────────────────
        let synthesis: Synthesis | null = null;
        try {
          synthesis = await synthesize({
            transcript: taggedTranscript,
            extraction,
            brain: brain_map,
            questions: QUESTIONS.map((q) => ({ index: q.index, text: q.text })),
          });
        } catch (err) {
          console.warn("synthesis failed:", err instanceof Error ? err.message : err);
          synthesis = null;
        }
        emit({ type: "stage_done", id: "synthesis", data: synthesis });

        // ── Seal — persist to DB ─────────────────────────────────────────
        const signalData: SignalData = {
          transcript: taggedTranscript,
          duration_seconds: transcript.duration || totalDuration,
          word_count: wordCount,
          certainty: extraction.certainty,
          tempo: tempoSignal,
          register: registerSignal,
          ownership: extraction.ownership,
          future_vision: extraction.future_vision,
          linguistic: extraction.linguistic,
          limiting_beliefs: extraction.limiting_beliefs,
          thinking_patterns: extraction.thinking_patterns,
          sentiment: extraction.sentiment,
          emerging_patterns: extraction.emerging_patterns,
          brain_map,
          synthesis,
          takes: takeAudios,
        };

        const recordedAt = new Date();
        const delayMinutes = process.env.DELIVERY_DELAY_MINUTES
          ? Number(process.env.DELIVERY_DELAY_MINUTES)
          : Number(process.env.DELIVERY_DELAY_DAYS || 10) * 24 * 60;
        const deliverAt = new Date(recordedAt.getTime() + delayMinutes * 60_000);
        const eventName = process.env.EVENT_NAME || null;

        // Store the question list (JSON) as the "prompt" field for the cron
        // path. Keeps schema unchanged.
        const promptStored = JSON.stringify(QUESTIONS);

        await sql`
          insert into sessions (
            first_name, email, focus, prompt, audio_url, audio_pathname,
            duration_seconds, event_name, transcript, signal_data,
            recorded_at, deliver_at
          ) values (
            ${firstName}, ${email}, ${focus}, ${promptStored},
            ${primaryUpload.url}, ${primaryUpload.pathname},
            ${Math.round(transcript.duration || totalDuration)},
            ${eventName}, ${taggedTranscript},
            ${sql.json(signalData as unknown as Parameters<typeof sql.json>[0])},
            ${recordedAt}, ${deliverAt}
          )
        `;

        // Production audit — any clinical jargon that slipped past prompt
        // constraints gets logged to stderr so we can spot it in Vercel
        // function logs. Doesn't block delivery: the booth keeps moving.
        const forbiddenHits = auditSignalData(signalData);
        if (forbiddenHits.length > 0) {
          console.warn(
            `[forbidden-words] ${forbiddenHits.length} hit${forbiddenHits.length === 1 ? "" : "s"} in user-facing copy:`,
            JSON.stringify(forbiddenHits.slice(0, 5))
          );
        }

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

/* ────── helpers ────── */

async function concatBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];
  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
  // NB: this is byte-level concatenation. WebM containers don't strictly
  // concat cleanly via byte append (each fragment has its own EBML header
  // after the first), but Whisper + ffmpeg-based audio decoders we use
  // downstream handle this in practice for short consumer recordings.
  // Phase 2: re-mux with ffmpeg on Railway for correctness on long sessions.
  return new Blob(buffers, { type: blobs[0].type || "audio/webm" });
}

/**
 * Build a question-tagged transcript by slotting Whisper words into takes
 * by cumulative-duration boundaries. Output looks like:
 *   [Q1] I think I'll be celebrating closing my seed round...
 *   [Q2] I'd know it was her because she walks in like...
 */
function tagTranscriptByQuestion(
  fullText: string,
  words: { word: string; start: number; end: number }[],
  takes: ParsedTake[]
): string {
  if (!words.length || takes.length <= 1) {
    // Single take or no timestamps — just return as-is with one tag
    return takes.length
      ? `[Q${takes[0].questionIndex}] ${fullText}`
      : fullText;
  }

  // Cumulative end time per take
  const boundaries: number[] = [];
  let cum = 0;
  for (const t of takes) {
    cum += t.durationSeconds;
    boundaries.push(cum);
  }

  const segments: string[][] = takes.map(() => []);
  for (const w of words) {
    // Find which take this word belongs to
    let idx = boundaries.findIndex((b) => w.start < b);
    if (idx < 0) idx = takes.length - 1;
    segments[idx].push(w.word);
  }

  return takes
    .map((t, i) => `[Q${t.questionIndex}] ${segments[i].join(" ").trim()}`)
    .filter((s, i) => segments[i].length > 0)
    .join("\n\n");
}

/** Merge per-take RegisterData into a single session summary. */
function mergeRegister(regs: RegisterData[]): RegisterData {
  const all = regs.flatMap((r) => r.samples);
  if (!all.length) return emptyRegister();
  let sum = 0,
    min = Infinity,
    max = -Infinity;
  for (const s of all) {
    sum += s.hz;
    if (s.hz < min) min = s.hz;
    if (s.hz > max) max = s.hz;
  }
  const avg = sum / all.length;
  let varSum = 0;
  for (const s of all) varSum += (s.hz - avg) ** 2;
  const std = Math.sqrt(varSum / all.length);
  // drop_count / rise_count: sum across takes (preserves event counts)
  const drop_count = regs.reduce((s, r) => s + r.drop_count, 0);
  const rise_count = regs.reduce((s, r) => s + r.rise_count, 0);
  return {
    samples: all,
    avg_hz: avg,
    min_hz: min,
    max_hz: max,
    std_hz: std,
    drop_count,
    rise_count,
  };
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
