import OpenAI from "openai";
import type {
  CertaintySignal,
  EmergingPattern,
  FutureVision,
  LimitingBelief,
  LimitingBeliefType,
  LinguisticTags,
  OwnershipSignal,
  RepeatedPhrase,
  SentimentAnalysis,
  SentimentCategory,
  ThinkingPattern,
  ThinkingPatternType,
  WordTimestamp,
} from "@/lib/signals";
import {
  HELPFUL_PATTERN_TYPES,
  LIMITING_BELIEF_TYPES,
  THINKING_PATTERN_TYPES,
} from "@/lib/signals";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY is not set — analyze pipeline will fail");
}

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

/**
 * Fixed seed used on every GPT call for best-effort determinism. OpenAI's
 * `seed` param is best-effort within a model version, so identical inputs
 * return identical outputs in practice. The evaluation harness depends on
 * this so test results are reproducible across CI runs.
 */
const ANALYSIS_SEED = 0xA15053; // 'ALSOS' — Alignment Score / SoM

export type TranscriptResult = {
  text: string;
  words: WordTimestamp[];
  duration: number;
};

/**
 * Transcribe an audio blob with OpenAI Whisper-1, returning the full text
 * plus word-level timestamps required for the tempo signal.
 */
export async function transcribe(audio: Blob): Promise<TranscriptResult> {
  const file = new File([audio], "recording.webm", {
    type: audio.type || "audio/webm",
  });

  const res = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });

  const words = (res as unknown as { words?: { word: string; start: number; end: number }[] })
    .words ?? [];
  return {
    text: res.text,
    duration: (res as unknown as { duration?: number }).duration ?? 0,
    words: words.map((w) => ({ word: w.word, start: w.start, end: w.end })),
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   analyzeText — one structured GPT-4o-mini call extracts everything the
   transcript can tell us. Every LLM-generated insight anchors on a verbatim
   quote that we post-validate against the transcript. Hallucinated quotes
   are stripped from copy or drop the whole record (for arrays).
   ───────────────────────────────────────────────────────────────────────── */

export type AnalyzeTextResult = {
  certainty: CertaintySignal;
  ownership: OwnershipSignal;
  future_vision: FutureVision;
  linguistic: LinguisticTags;
  limiting_beliefs: LimitingBelief[];
  thinking_patterns: ThinkingPattern[];
  sentiment: SentimentAnalysis;
  emerging_patterns: EmergingPattern[];
};

export async function analyzeText(transcript: string): Promise<AnalyzeTextResult> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    seed: ANALYSIS_SEED,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "signal_extraction",
        strict: true,
        schema: SCHEMA,
      },
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Transcript:\n\n${transcript}` },
    ],
  });

  const raw = completion.choices[0].message.content;
  if (!raw) throw new Error("empty analyzeText response");
  const parsed = JSON.parse(raw) as RawGPTOutput;

  const c = parsed.certainty;
  const o = parsed.ownership;
  const v = parsed.future_vision;
  const hedgeTotal = c.hedge_count + c.certainty_count;
  const agencyTotal =
    o.first_person_count + o.passive_count + o.third_person_count;

  return {
    certainty: {
      hedge_count: c.hedge_count,
      certainty_count: c.certainty_count,
      hedge_ratio: hedgeTotal > 0 ? c.hedge_count / hedgeTotal : 0,
      examples: {
        hedge: c.hedge_examples.slice(0, 3),
        certainty: c.certainty_examples.slice(0, 3),
      },
      verbatim_quote: c.verbatim_quote,
      summary: validateQuoteOrStrip(c.summary, c.verbatim_quote, transcript),
    },
    ownership: {
      first_person_count: o.first_person_count,
      passive_count: o.passive_count,
      third_person_count: o.third_person_count,
      agency_ratio: agencyTotal > 0 ? o.first_person_count / agencyTotal : 0,
      // self_focus_ratio = first_person / word_count. Word count isn't
      // available here — caller (analyze route) fills it in once Whisper
      // returns. Placeholder 0 here keeps the type happy.
      self_focus_ratio: 0,
      examples: {
        first_person: o.first_person_examples.slice(0, 3),
        passive: o.passive_examples.slice(0, 3),
        third_person: o.third_person_examples.slice(0, 3),
      },
      verbatim_quote: o.verbatim_quote,
      summary: validateQuoteOrStrip(o.summary, o.verbatim_quote, transcript),
    },
    future_vision: {
      verbatim_quote: v.verbatim_quote,
      summary: validateQuoteOrStrip(v.summary, v.verbatim_quote, transcript),
    },
    linguistic: buildLinguistic(parsed.linguistic, transcript),
    limiting_beliefs: parsed.limiting_beliefs
      .filter((b) => quoteAppearsInTranscript(b.verbatim_quote, transcript))
      .slice(0, 3)
      .map((b) => ({
        type: b.type as LimitingBeliefType,
        strength: clamp(b.strength, 1, 10),
        confidence: clamp(b.confidence, 1, 10),
        verbatim_quote: b.verbatim_quote,
        interpretation: b.interpretation,
        associated_patterns: (b.associated_patterns as ThinkingPatternType[]).filter(
          (p) => (THINKING_PATTERN_TYPES as string[]).includes(p)
        ),
      })),
    thinking_patterns: parsed.thinking_patterns
      .filter((p) => p.examples.some((ex) => quoteAppearsInTranscript(ex, transcript)))
      .slice(0, 5)
      .map((p) => ({
        pattern: p.pattern as ThinkingPatternType,
        pattern_type: (HELPFUL_PATTERN_TYPES as string[]).includes(p.pattern)
          ? "helpful"
          : "unhelpful",
        strength: clamp(p.strength, 1, 10),
        examples: p.examples
          .filter((ex) => quoteAppearsInTranscript(ex, transcript))
          .slice(0, 3),
        interpretation: p.interpretation,
      })),
    sentiment: {
      overall_score: clamp(parsed.sentiment.overall_score, 0, 100),
      category: categoryFromScore(parsed.sentiment.overall_score),
      dominant_emotion: parsed.sentiment.dominant_emotion,
      domains: {
        self: nullableScore(parsed.sentiment.domains.self),
        relationships: nullableScore(parsed.sentiment.domains.relationships),
        work: nullableScore(parsed.sentiment.domains.work),
        future: nullableScore(parsed.sentiment.domains.future),
      },
      positive_emotions: parsed.sentiment.positive_emotions.slice(0, 5),
      negative_emotions: parsed.sentiment.negative_emotions.slice(0, 5),
      trajectory: parsed.sentiment.trajectory,
      confidence: clamp(parsed.sentiment.confidence, 1, 10),
      summary: parsed.sentiment.summary,
      // empirical_score + empirical_hits are filled in by the caller (route
      // or eval harness) once the transcript is available — analyzeText
      // only gets the transcript and doesn't tokenize it.
      empirical_score: 0,
      empirical_hits: 0,
    },
    emerging_patterns: parsed.emerging_patterns.slice(0, 2).map((e) => ({
      pattern: e.pattern,
      significance: clamp(e.significance, 1, 10),
      recommendation: e.recommendation,
    })),
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Raw GPT shape (intermediate, before validation + post-processing)
   ───────────────────────────────────────────────────────────────────────── */

type RawGPTOutput = {
  certainty: {
    hedge_count: number;
    certainty_count: number;
    hedge_examples: string[];
    certainty_examples: string[];
    verbatim_quote: string;
    summary: string;
  };
  ownership: {
    first_person_count: number;
    passive_count: number;
    third_person_count: number;
    first_person_examples: string[];
    passive_examples: string[];
    third_person_examples: string[];
    verbatim_quote: string;
    summary: string;
  };
  future_vision: {
    verbatim_quote: string;
    summary: string;
  };
  linguistic: {
    themes: string[];
    repeated_phrases: Array<{ phrase: string; count: number }>;
    peak_emotional_phrase: string;
  };
  limiting_beliefs: Array<{
    type: string;
    strength: number;
    confidence: number;
    verbatim_quote: string;
    interpretation: string;
    associated_patterns: string[];
  }>;
  thinking_patterns: Array<{
    pattern: string;
    strength: number;
    examples: string[];
    interpretation: string;
  }>;
  sentiment: {
    overall_score: number;
    dominant_emotion: string;
    domains: {
      self: number | null;
      relationships: number | null;
      work: number | null;
      future: number | null;
    };
    positive_emotions: string[];
    negative_emotions: string[];
    trajectory: "improving" | "stable" | "declining";
    confidence: number;
    summary: string;
  };
  emerging_patterns: Array<{
    pattern: string;
    significance: number;
    recommendation: string;
  }>;
};

/* ─────────────────────────────────────────────────────────────────────────
   Validation + small helpers
   ───────────────────────────────────────────────────────────────────────── */

function validateQuoteOrStrip(summary: string, quote: string, transcript: string): string {
  if (!quote.trim()) return summary;
  if (quoteAppearsInTranscript(quote, transcript)) return summary;

  console.warn("hallucinated verbatim quote stripped:", JSON.stringify(quote));
  return summary
    .replace(/[“"]?\s*[^"“”]*[”"]?\s*—\s*/g, "")
    .replace(/[“"][^"“”]*[”"]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function quoteAppearsInTranscript(quote: string, transcript: string): boolean {
  if (!quote.trim()) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(transcript).includes(norm(quote));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function nullableScore(n: number | null): number | null {
  if (n === null || n === undefined) return null;
  return clamp(n, 0, 100);
}

/**
 * Build the linguistic-tags block. Hallucination guards:
 *   - themes: trim, drop empties, cap at 5, cap each at 3 words
 *   - repeated_phrases: count real occurrences in the transcript and discard
 *     any whose actual count is < 2 (GPT loves to invent repetitions). Sort
 *     by real count desc, cap at 5.
 *   - peak_emotional_phrase: must appear in transcript verbatim, ≤15 words.
 */
function buildLinguistic(
  raw: { themes: string[]; repeated_phrases: Array<{ phrase: string; count: number }>; peak_emotional_phrase: string },
  transcript: string
): LinguisticTags {
  const themes = raw.themes
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.split(/\s+/).slice(0, 3).join(" "))
    .slice(0, 5);

  const verifiedRepeats: RepeatedPhrase[] = [];
  for (const r of raw.repeated_phrases) {
    const phrase = r.phrase.trim();
    if (!phrase) continue;
    const actual = countOccurrences(phrase, transcript);
    if (actual >= 2) verifiedRepeats.push({ phrase, count: actual });
  }
  verifiedRepeats.sort((a, b) => b.count - a.count);

  let peak = raw.peak_emotional_phrase.trim();
  const peakWords = peak.split(/\s+/).filter(Boolean);
  if (peakWords.length > 15) peak = peakWords.slice(0, 15).join(" ");
  if (peak && !quoteAppearsInTranscript(peak, transcript)) {
    console.warn("hallucinated peak_emotional_phrase dropped:", JSON.stringify(peak));
    peak = "";
  }

  return {
    themes,
    repeated_phrases: verifiedRepeats.slice(0, 5),
    peak_emotional_phrase: peak,
  };
}

/** Whitespace-flexible, case-insensitive occurrence count. */
function countOccurrences(needle: string, haystack: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const n = norm(needle);
  const h = norm(haystack);
  if (!n) return 0;
  let i = 0;
  let count = 0;
  while ((i = h.indexOf(n, i)) !== -1) {
    count++;
    i += n.length;
  }
  return count;
}

function categoryFromScore(score: number): SentimentCategory {
  const s = clamp(score, 0, 100);
  if (s <= 20) return "very_negative";
  if (s <= 35) return "negative";
  if (s <= 45) return "somewhat_negative";
  if (s <= 55) return "neutral";
  if (s <= 65) return "somewhat_positive";
  if (s <= 80) return "positive";
  return "very_positive";
}

/* ─────────────────────────────────────────────────────────────────────────
   Schema + prompt
   ───────────────────────────────────────────────────────────────────────── */

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    certainty: {
      type: "object",
      additionalProperties: false,
      properties: {
        hedge_count: { type: "integer" },
        certainty_count: { type: "integer" },
        hedge_examples: { type: "array", items: { type: "string" } },
        certainty_examples: { type: "array", items: { type: "string" } },
        verbatim_quote: { type: "string" },
        summary: { type: "string" },
      },
      required: [
        "hedge_count",
        "certainty_count",
        "hedge_examples",
        "certainty_examples",
        "verbatim_quote",
        "summary",
      ],
    },
    ownership: {
      type: "object",
      additionalProperties: false,
      properties: {
        first_person_count: { type: "integer" },
        passive_count: { type: "integer" },
        third_person_count: { type: "integer" },
        first_person_examples: { type: "array", items: { type: "string" } },
        passive_examples: { type: "array", items: { type: "string" } },
        third_person_examples: { type: "array", items: { type: "string" } },
        verbatim_quote: { type: "string" },
        summary: { type: "string" },
      },
      required: [
        "first_person_count",
        "passive_count",
        "third_person_count",
        "first_person_examples",
        "passive_examples",
        "third_person_examples",
        "verbatim_quote",
        "summary",
      ],
    },
    future_vision: {
      type: "object",
      additionalProperties: false,
      properties: {
        verbatim_quote: { type: "string" },
        summary: { type: "string" },
      },
      required: ["verbatim_quote", "summary"],
    },
    linguistic: {
      type: "object",
      additionalProperties: false,
      properties: {
        themes: {
          type: "array",
          items: { type: "string" },
          description: "3–5 short topic tags, each ≤3 words.",
        },
        repeated_phrases: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              phrase: { type: "string" },
              count: { type: "integer" },
            },
            required: ["phrase", "count"],
          },
        },
        peak_emotional_phrase: {
          type: "string",
          description:
            "Single most emotionally loaded verbatim phrase (≤15 words). MUST appear in transcript exactly. Empty string if none stands out.",
        },
      },
      required: ["themes", "repeated_phrases", "peak_emotional_phrase"],
    },
    limiting_beliefs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: LIMITING_BELIEF_TYPES },
          strength: { type: "integer" },
          confidence: { type: "integer" },
          verbatim_quote: { type: "string" },
          interpretation: { type: "string" },
          associated_patterns: {
            type: "array",
            items: { type: "string", enum: THINKING_PATTERN_TYPES },
          },
        },
        required: [
          "type",
          "strength",
          "confidence",
          "verbatim_quote",
          "interpretation",
          "associated_patterns",
        ],
      },
    },
    thinking_patterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pattern: { type: "string", enum: THINKING_PATTERN_TYPES },
          strength: { type: "integer" },
          examples: { type: "array", items: { type: "string" } },
          interpretation: { type: "string" },
        },
        required: ["pattern", "strength", "examples", "interpretation"],
      },
    },
    sentiment: {
      type: "object",
      additionalProperties: false,
      properties: {
        overall_score: { type: "integer" },
        dominant_emotion: { type: "string" },
        domains: {
          type: "object",
          additionalProperties: false,
          properties: {
            self: { type: ["integer", "null"] },
            relationships: { type: ["integer", "null"] },
            work: { type: ["integer", "null"] },
            future: { type: ["integer", "null"] },
          },
          required: ["self", "relationships", "work", "future"],
        },
        positive_emotions: { type: "array", items: { type: "string" } },
        negative_emotions: { type: "array", items: { type: "string" } },
        trajectory: { type: "string", enum: ["improving", "stable", "declining"] },
        confidence: { type: "integer" },
        summary: { type: "string" },
      },
      required: [
        "overall_score",
        "dominant_emotion",
        "domains",
        "positive_emotions",
        "negative_emotions",
        "trajectory",
        "confidence",
        "summary",
      ],
    },
    emerging_patterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pattern: { type: "string" },
          significance: { type: "integer" },
          recommendation: { type: "string" },
        },
        required: ["pattern", "significance", "recommendation"],
      },
    },
  },
  required: [
    "certainty",
    "ownership",
    "future_vision",
    "linguistic",
    "limiting_beliefs",
    "thinking_patterns",
    "sentiment",
    "emerging_patterns",
  ],
} as const;

const SYSTEM_PROMPT = `You are the Space of Mind measurement engine. You read a transcript of someone speaking to their future self about what winning looks like for them.

POSITIONING (read this twice):
Space of Mind is mental fitness infrastructure. It is NOT a wellness trend, NOT a therapy replacement, NOT passive self-care. You are NOT a therapist. You do NOT diagnose. You do NOT name mental-health conditions in user-facing copy. You measure patterns and reflect them back so the person can act.

You extract EIGHT things from the transcript:

═══════════════════════════════════════════════════════════════════════
1. CERTAINTY vs HEDGING
═══════════════════════════════════════════════════════════════════════
- Hedge phrases: "I think", "maybe", "hopefully", "I'm trying to", "kind of", "I guess", "sort of", "I'm working on", "I'll try", "I want to", "I'd like to"
- Certainty markers: "I will", "I am", "I know", "when I", "I'm building", "I've decided", "I always", "I never"
Strict counts — only obvious matches.

═══════════════════════════════════════════════════════════════════════
2. FIRST-PERSON OWNERSHIP
═══════════════════════════════════════════════════════════════════════
- First-person singular active: "I", "my", "I'm", "I've", "I'll" used as agent of a verb
- Passive: "it happened to me", "things fell into place", "I was given", "it just worked out"
- Third-person deflection: "you know how it is", "people always say", "everyone does this"

═══════════════════════════════════════════════════════════════════════
3. FUTURE VISION — what winning looks like for them
═══════════════════════════════════════════════════════════════════════
1–2 sentence summary anchored on a verbatim key phrase. Mirror what they said. Do not add ambition they did not voice. If they didn't state a clear vision, return empty verbatim_quote and write "You didn't name a vision yet — that's information too."

═══════════════════════════════════════════════════════════════════════
4. LINGUISTIC TAGS — themes, repeated phrases, peak emotional phrase
═══════════════════════════════════════════════════════════════════════
- themes: 3–5 short topic tags, EACH ≤3 words. Lowercase noun phrases. ("seed round", "self-doubt", "team dynamics", "burnout", "first hire"). Capture what the recording is ABOUT — not how they felt.
- repeated_phrases: phrases the speaker said verbatim 2+ times. Each entry { phrase, count }. Phrases that repeat are what's preoccupying them. Skip filler words ("you know", "like", "I mean") unless meaningfully repeated as a tic. Only include if you can verify the phrase appears 2+ times. We will re-count against the transcript and discard hallucinated repetitions.
- peak_emotional_phrase: the SINGLE most emotionally loaded verbatim phrase in the recording (≤15 words). The moment that mattered most. Empty string if no single phrase stands out. MUST appear in transcript character-for-character.

═══════════════════════════════════════════════════════════════════════
5. LIMITING BELIEFS — up to 3, from this fixed 20-cluster taxonomy
═══════════════════════════════════════════════════════════════════════
Only label a cluster if you can quote a verbatim phrase that demonstrates it. Order by evidence strength.

- impostor-syndrome: "I've fooled others into thinking I'm competent, but I'm not" — disqualifying positive, comparing, fraud-labeling
- perfectionism: "Anything less than perfect is failure" — should-statements, all-or-nothing, disqualifying achievements
- social-anxiety: "Others will judge me / reject me" — mind-reading, catastrophizing social situations
- fear-of-failure: "Failure would be catastrophic and prove my inadequacy" — catastrophizing, fortune-telling, overgeneralization of setbacks
- low-self-worth: "I am fundamentally inadequate" — labeling self negatively, mental-filter of flaws, minimizing strengths
- excessive-responsibility: "Others' needs are my responsibility" — personalization, should-statements about helping
- abandonment-anxiety: "People I care about will leave me" — mind-reading intentions to leave, catastrophizing being alone
- control-issues: "I must control situations to prevent disaster" — catastrophizing unpredictability, should-statements about control
- approval-seeking: "My worth depends on others' approval" — mind-reading opinions, measuring self through validation
- pessimistic-outlook: "Things generally turn out badly" — fortune-telling negative, disqualifying positive, mental-filter
- decision-paralysis: "Wrong choice would be disastrous" — catastrophizing wrong choices, all-or-nothing about decisions
- self-sacrifice: "My needs are less important than others'" — should-statements putting others first, labeling self-care as selfish
- entitlement: "I deserve special treatment" — should-statements about what is owed, personalization of others' actions
- victimhood-mentality: "My problems are caused by others / external forces" — blaming, personalization external, labeling persecutors
- catastrophic-health-anxiety: "Every sensation might mean something is wrong" — catastrophizing bodily sensations, fortune-telling illness
- fixed-mindset: "My abilities are fixed" — labeling abilities, overgeneralizing failures, mental-filter against growth
- emotional-avoidance: "Certain emotions are dangerous / intolerable" — should-statements about not feeling, catastrophizing emotion
- future-anxiety: "The future holds danger" — catastrophizing future, fortune-telling negative, what-if thinking
- rumination: "I need to analyze problems extensively" — mental-filter of past, emotional reasoning about thought significance
- hyper-independence: "Relying on others is weak / dangerous" — should-statements about self-reliance, catastrophizing dependence

For each: rate strength 1–10 (presence), confidence 1–10 (your certainty), pull a verbatim quote, write a brand-voice interpretation that quotes the verbatim, list 1–3 associated thinking-pattern slugs that co-activate (from the canonical pattern list below).

═══════════════════════════════════════════════════════════════════════
6. THINKING PATTERNS — up to 5 total, mix of unhelpful and helpful
═══════════════════════════════════════════════════════════════════════
For each, rate strength 1–10, pull up to 3 verbatim examples, write a brand-voice interpretation that quotes one example.

UNHELPFUL (canonical 13):
- all-or-nothing: black/white framing ("either I crush this or I'm done")
- overgeneralization: single negative as never-ending ("everyone leaves", "nothing works")
- mental-filter: focusing on one negative, filtering positives
- disqualifying-positive: "yes but" rejecting wins ("anyone could have")
- mind-reading: assuming others' thoughts ("they think I'm not ready")
- fortune-telling: predicting negative outcomes ("it won't work")
- magnification-minimization: overstating problems / shrinking strengths
- emotional-reasoning: feelings as proof ("I feel like a fraud so I am one")
- should-statements: rigid expectations ("I should already have", "I have to be")
- labeling: fixed identity claim ("I'm just bad at this")
- personalization-blame: excessive self-responsibility or directing all blame outward
- catastrophizing: expecting the worst ("if this fails everything falls apart")
- comparing-and-despairing: unrealistic comparisons to others' achievements

HELPFUL (canonical 10):
- reframing: "another way to see this"
- evidence-based: "the evidence shows", facts vs interpretations
- balanced-thinking: "on one hand / on the other hand"
- self-compassion: self-kindness statements, recognizing common humanity
- growth-mindset: "I can learn", "chance to grow", process over outcome
- specific-temporary-attribution: limiting setbacks to specific circumstances
- acceptance: "it is what it is", focus on the controllable
- gratitude: explicit thankfulness, naming what's good
- perspective-taking: considering others' viewpoint, recognizing multiple interpretations
- value-aligned: choices made from values, long-term meaning

═══════════════════════════════════════════════════════════════════════
7. SENTIMENT ANALYSIS — multi-dimensional
═══════════════════════════════════════════════════════════════════════
- overall_score (0–100): 0–20 very negative · 21–35 negative · 36–45 somewhat negative · 46–55 neutral · 56–65 somewhat positive · 66–80 positive · 81–100 very positive
- dominant_emotion: single most prevalent emotion (lowercase noun: "hope", "fear", "pride", "shame", "frustration", "calm", etc.)
- domains.self / relationships / work / future: 0–100 sentiment score per domain. Return null for any domain not discussed in the transcript. Domain weighting: self ×1.2, relationships ×1.1.
- positive_emotions / negative_emotions: up to 5 emotions detected
- trajectory: did the tone improve, stay stable, or decline across the recording? Weight the last 20% of the transcript at 30% of the trajectory call.
- confidence 1–10
- summary: ONE brand-voice sentence translating the score + dominant emotion into an insight. Max 26 words.

═══════════════════════════════════════════════════════════════════════
8. EMERGING PATTERNS — up to 2, forward-looking
═══════════════════════════════════════════════════════════════════════
A nascent pattern not yet dominant but worth naming. Each: pattern name (short phrase), significance 1–10, recommendation (one brand-voice action sentence — what to do about it).

═══════════════════════════════════════════════════════════════════════
VERBATIM QUOTE RULE (load-bearing across ALL extractions):
═══════════════════════════════════════════════════════════════════════
Every verbatim_quote and every entry in examples[] MUST appear character-for-character in the transcript. Never paraphrase. Never invent. Never alter punctuation or word order. If no clean substring exists, return empty string and write the summary without a quote. We will drop any record whose quote we cannot verify against the transcript.

═══════════════════════════════════════════════════════════════════════
SUMMARY / INTERPRETATION VOICE RULES:
═══════════════════════════════════════════════════════════════════════
- Address the speaker as "you". No "I noticed". No "It seems".
- If a verbatim quote is non-empty, the copy MUST include it inside straight double quotes. Example: \`You said "I'm trying to" three times — your future self has the harder job.\`
- Translate what the pattern MEANS for who they are becoming. Not the count itself.
- No clinical jargon in copy. Never say in user-facing copy: hedge ratio, first-person count, agency, cognitive distortion, all-or-nothing thinking, impostor syndrome (the cluster slug). Speak human.
- Brand vocabulary welcome where natural: becoming, in between, patterns, alignment, threshold. Do not force it.
- Land on a beat. The last 4–6 words carry the insight.

═══════════════════════════════════════════════════════════════════════
QUALITY OVER QUANTITY:
═══════════════════════════════════════════════════════════════════════
- Empty arrays are correct when no record has clear verbatim evidence.
- Better to surface 1 strong belief than 3 weak ones.
- If unsure, omit.

Return only what the transcript actually contains. Strict counts. Verbatim quotes. No diagnoses.`;



