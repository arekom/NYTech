import { NextResponse } from "next/server";
import {
  deliveryHtml,
  deliveryText,
  deliverySubject,
  FROM,
  type TakeAudioUrl,
} from "@/lib/email";
import { QUESTIONS } from "@/lib/prompts";
import type { SignalData } from "@/lib/signals";

export const runtime = "nodejs";

/**
 * Dev/preview-only renderer for the 10-day follow-up email. Lets you eyeball
 * the real `deliveryHtml` / `deliveryText` output without recording a booth
 * session or waiting for the delivery cron.
 *
 *   /api/preview-email                 → rendered HTML email (sample data)
 *   /api/preview-email?format=text     → plaintext version (as <pre>)
 *   /api/preview-email?format=subject  → just the subject + From line
 *   /api/preview-email?signals=0       → degraded path: no analysis/voice/quotes
 *
 * In production this is gated behind ?key=<CRON_SECRET> so the sample copy
 * isn't publicly reachable. Locally (NODE_ENV !== "production") it's open.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  if (process.env.NODE_ENV === "production") {
    const key = url.searchParams.get("key") || "";
    if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const withSignals = url.searchParams.get("signals") !== "0";
  const format = url.searchParams.get("format") || "html";

  const recordedAt = new Date("2026-06-01T18:30:00Z");
  // A short public sample so the <audio> players + Listen buttons are clickable.
  const sampleAudio = "https://download.samplelib.com/mp3/sample-6s.mp3";
  const takeUrls: TakeAudioUrl[] = QUESTIONS.map((q, i) => ({
    question_index: q.index,
    url: sampleAudio,
    duration_seconds: 18 + i * 4,
  }));

  const payload = {
    to: "you@example.com",
    firstName: "Maya",
    prompt: JSON.stringify(QUESTIONS),
    audioUrl: sampleAudio,
    takeUrls,
    recordedAt,
    eventName: process.env.EVENT_NAME || "NY Tech Week",
    signals: withSignals ? SAMPLE_SIGNALS : null,
  };

  if (format === "subject") {
    return new NextResponse(`From: ${FROM}\nSubject: ${deliverySubject()}`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (format === "text") {
    const text = deliveryText(payload);
    return new NextResponse(
      `From: ${FROM}\nSubject: ${deliverySubject()}\n\n${text}`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  return new NextResponse(deliveryHtml(payload), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/* ── Sample analysis data, shaped to match what /api/analyze persists. ──
 * The transcript carries the [Q1]…[Q5] tags so the email's quote extraction
 * (extractQuote) surfaces the participant's own words in the letter. */

const SAMPLE_TRANSCRIPT = [
  "[Q1] A year from today I think I'll be celebrating closing our seed round and finally shipping the product we keep talking about. Maybe. We'll see how it goes.",
  "[Q2] She walks in calm. She doesn't apologize before she speaks. She believes she's allowed to take up the whole room — and honestly that's the thing I don't quite believe about myself yet.",
  "[Q3] In the fundraising conversations. The ask I keep softening at the last second. That's the one place I most need her to show up.",
  "[Q4] Staying where I am has cost me two years of playing small, and a version of this company that never got built because I was waiting to feel ready.",
  "[Q5] I'd have to stop believing that I have to earn the right to be in the room before I'm allowed to actually speak in it.",
].join("\n\n");

const SAMPLE_SIGNALS: SignalData = {
  transcript: SAMPLE_TRANSCRIPT,
  duration_seconds: 102,
  word_count: 168,

  certainty: {
    hedge_count: 6,
    certainty_count: 3,
    hedge_ratio: 0.67,
    examples: {
      hedge: ["I think", "maybe", "we'll see"],
      certainty: ["I will", "definitely", "I know"],
    },
    verbatim_quote: "I think I'll be celebrating closing our seed round",
    summary:
      "You reached for certainty about the vision, then softened it — the hedges cluster right where the stakes get personal.",
  },
  tempo: {
    pause_count: 9,
    longest_pause_ms: 2400,
    avg_pause_ms: 780,
    speech_rate_wpm: 132,
    verbatim_quote: "The ask I keep softening at the last second.",
    summary:
      "Steady pace overall, with the longest pauses landing just before you named the fundraising ask.",
  },
  register: {
    avg_hz: 187,
    min_hz: 142,
    max_hz: 268,
    std_hz: 24,
    drop_count: 4,
    rise_count: 2,
    summary:
      "Your pitch dropped into a lower, steadier register every time you described who she already is — that's the sound of truth, not performance.",
  },
  ownership: {
    first_person_count: 31,
    passive_count: 3,
    third_person_count: 8,
    agency_ratio: 0.79,
    self_focus_ratio: 0.18,
    examples: {
      first_person: ["I'll be", "I need", "I keep"],
      passive: ["never got built"],
      third_person: ["she walks", "she believes"],
    },
    verbatim_quote: "I'd have to stop believing that I have to earn the right",
    summary:
      "Strong first-person ownership — you claimed the story rather than describing it happening to you.",
  },

  future_vision: {
    summary:
      "A funded company shipping real product, led by a version of you who stops shrinking the ask.",
    verbatim_quote: "celebrating closing our seed round and finally shipping the product",
  },
  linguistic: {
    themes: ["Taking up space", "The ask", "Playing small", "Readiness"],
    repeated_phrases: [
      { phrase: "take up the room", count: 2 },
      { phrase: "the ask", count: 3 },
    ],
    peak_emotional_phrase: "a version of this company that never got built",
  },
  limiting_beliefs: [
    {
      type: "impostor-syndrome",
      strength: 7,
      confidence: 8,
      verbatim_quote: "I have to earn the right to be in the room before I'm allowed to speak",
      interpretation:
        "You described needing to “earn the right to be in the room” — a sign you're auditing your own legitimacy before you let yourself act.",
      associated_patterns: ["mind-reading"],
    },
  ],
  thinking_patterns: [
    {
      pattern: "mind-reading",
      pattern_type: "unhelpful",
      strength: 6,
      examples: ["I keep softening the ask"],
      interpretation:
        "Softening the ask “at the last second” suggests you're predicting a no before anyone's said it.",
    },
    {
      pattern: "growth-mindset",
      pattern_type: "helpful",
      strength: 8,
      examples: ["I'd have to stop believing"],
      interpretation:
        "Naming the belief you'd have to shed shows you already treat it as changeable, not fixed.",
    },
  ],
  sentiment: {
    overall_score: 68,
    category: "somewhat_positive",
    dominant_emotion: "determined",
    domains: { self: 60, relationships: null, work: 72, future: 80 },
    positive_emotions: ["hope", "determination"],
    negative_emotions: ["frustration"],
    trajectory: "improving",
    confidence: 8,
    summary:
      "Hopeful and forward-leaning, with the weight sitting on the cost of having waited.",
    empirical_score: 64,
    empirical_hits: 12,
  },
  emerging_patterns: [
    {
      pattern: "Permission-seeking before action",
      significance: 7,
      recommendation:
        "Notice the moment you reach for permission — and make the ask before you feel ready.",
    },
  ],
  brain_map: null,
  synthesis: {
    intro:
      "Across five answers, one thread held: you already know who she is — the work is letting yourself act like her now.",
    findings: [
      {
        headline: "You describe her in certainties and yourself in hedges.",
        body: "When you spoke about her you said “she doesn't apologize before she speaks” — flat, certain. When you spoke about yourself, the “I thinks” and “maybes” crept back in. The belief is already formed; it just hasn't been claimed in the first person yet.",
      },
      {
        headline: "The ask is where the gap is most expensive.",
        body: "Your longest pause landed right before “the ask I keep softening.” That's not indecision — it's the exact seam where playing small is still costing you.",
      },
    ],
    region_attributions: [],
  },
  takes: QUESTIONS.map((q, i) => ({
    question_index: q.index,
    pathname: `recordings/preview/q${q.index}.webm`,
    duration_seconds: 18 + i * 4,
  })),
};
