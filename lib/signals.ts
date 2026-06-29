/**
 * Canonical types and lightweight helpers for Space of Mind's measurement
 * framework. Two interlocking layers:
 *
 *   1. VOCAL SIGNALS — how someone spoke (certainty, tempo, register,
 *      ownership). Derived from Whisper word timestamps + client-side pitch.
 *
 *   2. THOUGHT MODEL — what they said. Derived from the transcript via GPT:
 *      - future_vision        — their stated win, anchored on a verbatim quote
 *      - limiting_beliefs     — up to 3 belief clusters from a fixed 20-item taxonomy
 *      - thinking_patterns    — up to 5 patterns (mix of unhelpful + helpful)
 *      - sentiment            — multi-dimensional emotional read-out
 *
 * Brand voice principles ("loving, direct, no BS" + "patterns, not problems"
 * + "no clinical jargon in consumer contexts") drive every human-facing
 * `summary` / `interpretation` field. Clinical taxonomy slugs are kept
 * internally; user-facing labels live in the `_LABELS` maps below.
 */

import type { RegisterData } from "@/lib/pitch";

/* ─────────────────────────────────────────────────────────────────────────
   Vocal signals
   ───────────────────────────────────────────────────────────────────────── */

export type WordTimestamp = {
  word: string;
  start: number; // seconds
  end: number;   // seconds
};

export type CertaintySignal = {
  hedge_count: number;
  certainty_count: number;
  hedge_ratio: number;
  examples: { hedge: string[]; certainty: string[] };
  verbatim_quote?: string;
  summary: string;
};

export type TempoSignal = {
  pause_count: number;
  longest_pause_ms: number;
  avg_pause_ms: number;
  speech_rate_wpm: number;
  verbatim_quote: string;
  summary: string;
};

export type RegisterSignal = {
  avg_hz: number;
  min_hz: number;
  max_hz: number;
  std_hz: number;
  drop_count: number;
  rise_count: number;
  summary: string;
};

export type OwnershipSignal = {
  first_person_count: number;
  passive_count: number;
  third_person_count: number;
  agency_ratio: number;
  /** first_person_count / word_count, 0..1 — the mockup's SELF-FOCUS gauge.
   *  Average baseline ≈ 0.15; values >0.2 read as high self-focus. Computed
   *  in the analyze route after Whisper returns word count. */
  self_focus_ratio: number;
  examples: { first_person: string[]; passive: string[]; third_person: string[] };
  verbatim_quote?: string;
  summary: string;
};

export type FutureVision = {
  summary: string;
  verbatim_quote: string;
};

/* ─────────────────────────────────────────────────────────────────────────
   Limiting beliefs (20-item taxonomy)
   ───────────────────────────────────────────────────────────────────────── */

export type LimitingBeliefType =
  | "impostor-syndrome"
  | "perfectionism"
  | "social-anxiety"
  | "fear-of-failure"
  | "low-self-worth"
  | "excessive-responsibility"
  | "abandonment-anxiety"
  | "control-issues"
  | "approval-seeking"
  | "pessimistic-outlook"
  | "decision-paralysis"
  | "self-sacrifice"
  | "entitlement"
  | "victimhood-mentality"
  | "catastrophic-health-anxiety"
  | "fixed-mindset"
  | "emotional-avoidance"
  | "future-anxiety"
  | "rumination"
  | "hyper-independence";

export const LIMITING_BELIEF_TYPES: LimitingBeliefType[] = [
  "impostor-syndrome",
  "perfectionism",
  "social-anxiety",
  "fear-of-failure",
  "low-self-worth",
  "excessive-responsibility",
  "abandonment-anxiety",
  "control-issues",
  "approval-seeking",
  "pessimistic-outlook",
  "decision-paralysis",
  "self-sacrifice",
  "entitlement",
  "victimhood-mentality",
  "catastrophic-health-anxiety",
  "fixed-mindset",
  "emotional-avoidance",
  "future-anxiety",
  "rumination",
  "hyper-independence",
];

/** User-facing label for each belief cluster. Plain English, brand-voice. */
export const LIMITING_BELIEF_LABELS: Record<LimitingBeliefType, string> = {
  "impostor-syndrome": "Impostor",
  perfectionism: "Perfectionism",
  "social-anxiety": "Fear of judgment",
  "fear-of-failure": "Fear of failure",
  "low-self-worth": "Not enough",
  "excessive-responsibility": "Carrying everyone",
  "abandonment-anxiety": "They'll leave",
  "control-issues": "Must control it all",
  "approval-seeking": "Need them to approve",
  "pessimistic-outlook": "It'll go wrong",
  "decision-paralysis": "Can't decide",
  "self-sacrifice": "My needs last",
  entitlement: "Deserve more",
  "victimhood-mentality": "It's happening to me",
  "catastrophic-health-anxiety": "Body's against me",
  "fixed-mindset": "Can't change",
  "emotional-avoidance": "Don't feel that",
  "future-anxiety": "The future is danger",
  rumination: "Can't stop thinking",
  "hyper-independence": "Need no one",
};

export const LIMITING_BELIEF_CORE: Record<LimitingBeliefType, string> = {
  "impostor-syndrome": "I've fooled others into thinking I'm competent, but I'm not",
  perfectionism: "Anything less than perfect is failure",
  "social-anxiety": "Others will judge me negatively or reject me",
  "fear-of-failure": "Failure would be catastrophic and prove my inadequacy",
  "low-self-worth": "I am fundamentally inadequate or unworthy",
  "excessive-responsibility": "Others' needs are my responsibility",
  "abandonment-anxiety": "People I care about will inevitably leave me",
  "control-issues": "I must control situations to prevent disaster",
  "approval-seeking": "My worth depends on others' approval",
  "pessimistic-outlook": "Things generally turn out badly",
  "decision-paralysis": "Making the wrong choice would be disastrous",
  "self-sacrifice": "My needs are less important than others'",
  entitlement: "I deserve special treatment",
  "victimhood-mentality": "My problems are caused by others or forces beyond my control",
  "catastrophic-health-anxiety": "My body is vulnerable; every sensation might mean danger",
  "fixed-mindset": "My abilities are fixed and cannot be significantly improved",
  "emotional-avoidance": "Certain emotions are dangerous or intolerable",
  "future-anxiety": "The future holds danger or failure",
  rumination: "I need to analyze problems extensively to solve them",
  "hyper-independence": "Relying on others is weak or dangerous",
};

export type LimitingBelief = {
  type: LimitingBeliefType;
  /** 1–10, GPT-rated presence/strength */
  strength: number;
  /** 1–10, GPT confidence in detection */
  confidence: number;
  /** Verbatim phrase from transcript that triggered detection */
  verbatim_quote: string;
  /** ONE sentence, brand-voice. Quotes verbatim_quote inline. */
  interpretation: string;
  /** Pattern slugs that frequently co-activate with this belief */
  associated_patterns: ThinkingPatternType[];
};

/* ─────────────────────────────────────────────────────────────────────────
   Thinking patterns (unhelpful + helpful)
   ───────────────────────────────────────────────────────────────────────── */

export type UnhelpfulPatternType =
  | "all-or-nothing"
  | "overgeneralization"
  | "mental-filter"
  | "disqualifying-positive"
  | "mind-reading"
  | "fortune-telling"
  | "magnification-minimization"
  | "emotional-reasoning"
  | "should-statements"
  | "labeling"
  | "personalization-blame"
  | "catastrophizing"
  | "comparing-and-despairing";

export type HelpfulPatternType =
  | "reframing"
  | "evidence-based"
  | "balanced-thinking"
  | "self-compassion"
  | "growth-mindset"
  | "specific-temporary-attribution"
  | "acceptance"
  | "gratitude"
  | "perspective-taking"
  | "value-aligned";

export type ThinkingPatternType = UnhelpfulPatternType | HelpfulPatternType;

export const UNHELPFUL_PATTERN_TYPES: UnhelpfulPatternType[] = [
  "all-or-nothing",
  "overgeneralization",
  "mental-filter",
  "disqualifying-positive",
  "mind-reading",
  "fortune-telling",
  "magnification-minimization",
  "emotional-reasoning",
  "should-statements",
  "labeling",
  "personalization-blame",
  "catastrophizing",
  "comparing-and-despairing",
];

export const HELPFUL_PATTERN_TYPES: HelpfulPatternType[] = [
  "reframing",
  "evidence-based",
  "balanced-thinking",
  "self-compassion",
  "growth-mindset",
  "specific-temporary-attribution",
  "acceptance",
  "gratitude",
  "perspective-taking",
  "value-aligned",
];

export const THINKING_PATTERN_TYPES: ThinkingPatternType[] = [
  ...UNHELPFUL_PATTERN_TYPES,
  ...HELPFUL_PATTERN_TYPES,
];

export const PATTERN_LABELS: Record<ThinkingPatternType, string> = {
  // Unhelpful — plain-English, not clinical
  "all-or-nothing": "All-or-nothing thinking",
  overgeneralization: "Overgeneralizing one event",
  "mental-filter": "Filtering out the good",
  "disqualifying-positive": "Disqualifying the wins",
  "mind-reading": "Assuming what others think",
  "fortune-telling": "Predicting the future",
  "magnification-minimization": "Magnifying the bad, shrinking the good",
  "emotional-reasoning": "Feelings as facts",
  "should-statements": "Should-thinking",
  labeling: "Sticking a label on yourself",
  "personalization-blame": "Taking it personally",
  catastrophizing: "Worst-case thinking",
  "comparing-and-despairing": "Comparing and despairing",
  // Helpful
  reframing: "Reframing the situation",
  "evidence-based": "Evidence over assumption",
  "balanced-thinking": "Holding both sides",
  "self-compassion": "Self-compassion",
  "growth-mindset": "Growth mindset",
  "specific-temporary-attribution": "Specific and temporary",
  acceptance: "Acceptance",
  gratitude: "Gratitude",
  "perspective-taking": "Perspective-taking",
  "value-aligned": "Value-aligned choice",
};

export type ThinkingPattern = {
  pattern: ThinkingPatternType;
  pattern_type: "unhelpful" | "helpful";
  /** 1–10 */
  strength: number;
  /** Verbatim phrases from transcript that triggered detection (≤3) */
  examples: string[];
  /** ONE sentence, brand-voice. Quotes one of the examples inline. */
  interpretation: string;
};

/* ─────────────────────────────────────────────────────────────────────────
   Sentiment analysis
   ───────────────────────────────────────────────────────────────────────── */

export type SentimentCategory =
  | "very_negative"
  | "negative"
  | "somewhat_negative"
  | "neutral"
  | "somewhat_positive"
  | "positive"
  | "very_positive";

export type SentimentAnalysis = {
  /** 0–100, higher = more positive. LLM-derived; non-deterministic. */
  overall_score: number;
  category: SentimentCategory;
  dominant_emotion: string;
  /** Domain-specific scores, 0–100 (null if not discussed) */
  domains: {
    self: number | null;
    relationships: number | null;
    work: number | null;
    future: number | null;
  };
  positive_emotions: string[];
  negative_emotions: string[];
  trajectory: "improving" | "stable" | "declining";
  /** 1–10, GPT confidence */
  confidence: number;
  /** ONE brand-voice sentence translating the score into an insight */
  summary: string;

  /**
   * Deterministic AFINN-165 lookup score on the transcript, 0–100. Cross-
   * checks the LLM `overall_score`. Large divergence (>20) flags low
   * confidence — the LLM read may have drifted. See `lib/sentiment-empirical.ts`.
   */
  empirical_score: number;
  /** Number of AFINN-scored words found in the transcript (sample-size proxy) */
  empirical_hits: number;
};

/* ─────────────────────────────────────────────────────────────────────────
   Brain map (TRIBE v2 cortical activation)
   Research / internal demo only — TRIBE v2 is CC BY-NC.
   ───────────────────────────────────────────────────────────────────────── */

export type CorticalRegion = {
  /** Canonical slug from label_library.yaml (e.g. "DMN_CORE") */
  id: string;
  scientific_name: string;
  anatomical_descriptor: string;
  yeo_network: string;
  short_function: string;
  function_summary: string;
  /** Mean |activation| over the region's vertices */
  score: number;
};

/**
 * Per-region attribution produced by the synthesis pass — what the speaker
 * SAID that activated this region, paired with a plain-English interpretation
 * of what it hints about them. Mirrors the mockup's "Top 3 brain regions"
 * card layout.
 */
export type RegionAttribution = {
  region_id: string;             // matches CorticalRegion.id
  /** "WHAT YOU SAID THAT ACTIVATED IT" — 1-sentence + verbatim user quote */
  activated_by: string;
  verbatim_quote: string;
  /** "WHAT THIS HINTS ABOUT YOU" — 1-sentence brand-voice interpretation */
  hints: string;
};

export type BrainMap = {
  /**
   * Pre-signed Vercel Blob URL to the brand-styled peak-frame PNG.
   * Generated with a short expiry (~24h) for the Confirmation screen.
   * The delivery cron re-signs from `image_pathname` at email-send time
   * since signed URLs eventually expire.
   */
  image_url: string;
  /**
   * Vercel Blob pathname (NOT a URL) — stable source of truth for the
   * stored PNG. Use this to mint fresh signed URLs at display time.
   */
  image_pathname: string;
  /** Phase 2: Vercel Blob URL to synced MP4. Null until brain video ships. */
  video_url: string | null;
  /** Top regions by activation, descending */
  top_regions: CorticalRegion[];
  /** Yeo network most common among the top regions */
  dominant_yeo_network: string | null;
  /** Index of the peak timestep in the TRIBE (T, V) output — provenance */
  peak_timestep: number;

  /**
   * Pre-signed Vercel Blob URL to the per-frame activation tensor — float16
   * binary, row-major (frame_count × vertex_count), little-endian. The
   * Confirmation BrainCanvas reads this and drives a three.js cortex in
   * sync with the audio scrubber. Null if the brain video pipeline
   * couldn't pack a tensor (e.g. handler returned only the peak PNG).
   */
  activations_url: string | null;
  /** Pathname for cron re-signing (same pattern as image_pathname). */
  activations_pathname: string | null;
  /** Number of frames in the activations tensor (== frame_times.length). */
  frame_count: number;
  /** Vertices per frame — equals LH + RH fsaverage5 (≈ 20484). */
  vertex_count: number;
  /**
   * Audio-time (seconds, relative to the concatenated multi-take recording)
   * of each frame in the activations tensor. Frontend uses binary search
   * against audio.currentTime to pick the active frame. Empty if no video.
   */
  frame_times: number[];
  /**
   * Index of the peak frame in the SUBSAMPLED activations tensor. May
   * differ from `peak_timestep` if the original (T, V) tensor was
   * downsampled. Used to highlight the peak frame in the canvas.
   */
  peak_timestep_packed: number;
  /** Total concatenated audio duration in seconds, per ffprobe. */
  audio_duration_seconds: number;
};

/* ─────────────────────────────────────────────────────────────────────────
   Synthesis — the 5-finding hero panel
   New layer on top of the extracted data. Produced by a second GPT call
   that takes the full extraction + brain regions + transcript and writes
   plain-English findings that interleave linguistic and brain evidence.
   ───────────────────────────────────────────────────────────────────────── */

export type SynthesisFinding = {
  /** Bold one-line headline (e.g. "You measure yourself against an internal audience.") */
  headline: string;
  /**
   * Supporting paragraph that combines:
   *   - a verbatim linguistic finding (a quote or a count)
   *   - a brain region observation (what fired)
   *   - a plain-English interpretation
   * 1–3 sentences. Address the speaker as "you". No clinical jargon.
   */
  body: string;
};

export type Synthesis = {
  /** Up to 5 findings, ordered strongest-evidence first */
  findings: SynthesisFinding[];
  /** Brief intro shown above the findings on the Confirmation hero panel */
  intro: string;
  /** Per-region linguistic-to-brain attribution for the "Top regions" cards */
  region_attributions: RegionAttribution[];
};

/* ─────────────────────────────────────────────────────────────────────────
   Emerging patterns (forward-looking)
   ───────────────────────────────────────────────────────────────────────── */

export type EmergingPattern = {
  pattern: string;
  /** 1–10 */
  significance: number;
  /** ONE brand-voice sentence — what to do about it */
  recommendation: string;
};

/* ─────────────────────────────────────────────────────────────────────────
   Linguistic tags (themes, repeated phrases, peak emotional phrase)
   Adopted from the sshandhra1/self-talk-mirror reference repo.
   ───────────────────────────────────────────────────────────────────────── */

export type RepeatedPhrase = {
  phrase: string;
  count: number;
};

export type LinguisticTags = {
  /** 3–5 short topic tags, each ≤3 words */
  themes: string[];
  /** Phrases the speaker repeated verbatim 2+ times, sorted by count desc */
  repeated_phrases: RepeatedPhrase[];
  /** Single most emotionally loaded verbatim phrase (≤15 words) */
  peak_emotional_phrase: string;
};

/* ─────────────────────────────────────────────────────────────────────────
   Top-level SignalData
   ───────────────────────────────────────────────────────────────────────── */

export type SignalData = {
  transcript: string;
  duration_seconds: number;
  word_count: number;

  // Vocal layer (how they spoke)
  certainty: CertaintySignal;
  tempo: TempoSignal;
  register: RegisterSignal;
  ownership: OwnershipSignal;

  // Thought layer (what they said)
  future_vision: FutureVision;
  linguistic: LinguisticTags;
  limiting_beliefs: LimitingBelief[];
  thinking_patterns: ThinkingPattern[];
  sentiment: SentimentAnalysis;
  emerging_patterns: EmergingPattern[];

  // Brain layer (cortical activation map from TRIBE v2). Optional — render
  // may fail or be disabled (e.g. BRAIN_SERVICE_URL unset) and the rest of
  // the analysis is still valid without it.
  brain_map?: BrainMap | null;

  // Synthesis layer — the 5-finding hero panel that unifies everything.
  // Computed by a second GPT call after extraction + brain render finish,
  // so it has full context. Optional — if the synthesis call fails, the
  // booth still renders all the underlying data.
  synthesis?: Synthesis | null;

  // Per-take audio files in Vercel Blob. One entry per question. The cron
  // re-signs `pathname` at email-send time (it stores the raw pathname,
  // not a URL, since signed URLs expire). Sorted by question_index.
  //
  // Legacy rows recorded before the per-take refactor have this field
  // missing/empty; in that case the email + cleanup fall back to the
  // single `sessions.audio_pathname` column (a byte-concatenated WebM
  // whose Q2-Q5 are unplayable — known issue, migration script fixes).
  takes?: TakeAudio[];
};

export type TakeAudio = {
  /** 1-based question number, matches QUESTIONS[i].index */
  question_index: number;
  /** Vercel Blob pathname (NOT a signed URL). Cron mints URLs from this. */
  pathname: string;
  /** Recorder-captured duration. MediaRecorder's audio.duration is Infinity
   *  on fragmented WebM, so this is the truth for total/scrubber math. */
  duration_seconds: number;
};

/* ─────────────────────────────────────────────────────────────────────────
   Derived helpers (deterministic, no LLM)
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Convert a 1–10 strength score to the spec's activation_frequency_percentage
 * (0–100). Stored alongside strength for analytics; never surfaced in copy.
 */
export function activationPercent(strength: number): number {
  return Math.max(0, Math.min(100, Math.round((strength / 10) * 100)));
}

/** Spec-defined activation label tier from strength. Internal use. */
export function activationLabel(strength: number): string {
  const pct = activationPercent(strength);
  if (pct >= 81) return "Highly Active — dominant pattern";
  if (pct >= 61) return "Frequently Active — recurring pattern";
  if (pct >= 41) return "Moderately Active — situational pattern";
  if (pct >= 21) return "Low Activation — pattern interrupting";
  return "Minimal Activation — pattern largely resolved";
}

/** Spec-defined clinical-threshold status from strength. Internal use. */
export function clinicalThresholdStatus(strength: number): string {
  const pct = activationPercent(strength);
  if (pct > 60) return "Activation above threshold — pattern operating at automatic response level";
  if (pct >= 41) return "Activation approaching threshold — pattern interrupt in progress";
  if (pct > 20) return "Activation below threshold — pattern interrupt at automatic response level";
  return "Activation below threshold — pattern interrupt consolidated";
}

const PAUSE_THRESHOLD_MS = 500;
const FRAGMENT_WORD_COUNT = 4;

export function computeTempo(
  words: WordTimestamp[],
  durationSeconds: number
): TempoSignal {
  const gaps: number[] = [];
  let longestPauseIdx = -1;
  let longestGap = 0;

  for (let i = 1; i < words.length; i++) {
    const gap = (words[i].start - words[i - 1].end) * 1000;
    if (gap >= PAUSE_THRESHOLD_MS) {
      gaps.push(gap);
      if (gap > longestGap) {
        longestGap = gap;
        longestPauseIdx = i;
      }
    }
  }

  const longest = gaps.length ? Math.max(...gaps) : 0;
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const wpm = durationSeconds > 0 ? (words.length / durationSeconds) * 60 : 0;

  let verbatim = "";
  if (longestPauseIdx > 0) {
    const startIdx = Math.max(0, longestPauseIdx - FRAGMENT_WORD_COUNT);
    verbatim = words
      .slice(startIdx, longestPauseIdx)
      .map((w) => w.word)
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/[,.;:!?]+$/, "")
      .trim();
  }

  return {
    pause_count: gaps.length,
    longest_pause_ms: Math.round(longest),
    avg_pause_ms: Math.round(avg),
    speech_rate_wpm: Math.round(wpm),
    verbatim_quote: verbatim,
    summary: tempoSummary(gaps.length, Math.round(longest), Math.round(wpm), verbatim),
  };
}

function tempoSummary(
  pauses: number,
  longestMs: number,
  wpm: number,
  fragment: string
): string {
  if (pauses === 0) {
    if (wpm > 170) {
      return "You moved through it fast and never stopped. The rush is the pattern.";
    }
    if (wpm < 110) {
      return "Slow, steady, no pauses. Either grounded — or didn't let yourself land anywhere.";
    }
    return "You moved through it without stopping. Either you're sure, or you didn't let yourself feel it.";
  }

  const seconds = (longestMs / 1000).toFixed(1);
  const quoted = fragment ? `“${fragment}”` : "";

  if (fragment) {
    if (pauses === 1 && longestMs > 1500) {
      return `You held ${seconds}s after ${quoted}. That's the moment that mattered.`;
    }
    if (longestMs > 2000) {
      return `Your longest pause came right after ${quoted} — ${seconds}s. The pattern is in the silence.`;
    }
    if (wpm > 170) {
      return `Fast pace (${wpm} wpm), then ${seconds}s after ${quoted}. The pause is louder than the rush.`;
    }
    return `Longest pause: ${seconds}s after ${quoted}. Notice what you said next.`;
  }

  return `${pauses} pause${pauses === 1 ? "" : "s"}, longest ${seconds}s. Listen for what came right after.`;
}

export function buildRegisterSignal(data: RegisterData): RegisterSignal {
  return {
    avg_hz: Math.round(data.avg_hz),
    min_hz: Math.round(data.min_hz),
    max_hz: Math.round(data.max_hz),
    std_hz: Math.round(data.std_hz * 10) / 10,
    drop_count: data.drop_count,
    rise_count: data.rise_count,
    summary: registerSummary(data.drop_count, data.rise_count),
  };
}

function registerSummary(drops: number, rises: number): string {
  if (drops === 0 && rises === 0) {
    return "Your voice held even. Hard to tell if that's grounded or guarded.";
  }
  if (drops > rises) {
    return `Your voice dropped ${drops} time${drops === 1 ? "" : "s"}. Those are the moments you stopped performing.`;
  }
  if (rises > drops) {
    return `Your voice rose ${rises} time${rises === 1 ? "" : "s"}. Notice what you were trying to convince yourself of.`;
  }
  return `${drops} drops, ${rises} rises. The variance is the signal.`;
}

/* ─────────────────────────────────────────────────────────────────────────
   Backwards-compat: legacy slugs from earlier 12-item distortion model
   ─────────────────────────────────────────────────────────────────────────
   The previous schema used these aliases. Keep them exported as deprecated
   aliases so any existing rows in `signal_data` JSONB written before this
   refactor still resolve to a usable label if read back.
   ───────────────────────────────────────────────────────────────────────── */

/** @deprecated use UnhelpfulPatternType / HelpfulPatternType */
export type DistortionType =
  | "all-or-nothing"
  | "catastrophizing"
  | "mind-reading"
  | "fortune-telling"
  | "emotional-reasoning"
  | "labeling"
  | "mental-filter"
  | "disqualifying-positive"
  | "personalization"
  | "should-statements"
  | "magnification"
  | "minimization";

/** @deprecated use PATTERN_LABELS */
export const DISTORTION_LABELS: Record<DistortionType, string> = {
  "all-or-nothing": "All-or-nothing thinking",
  catastrophizing: "Worst-case thinking",
  "mind-reading": "Assuming what others think",
  "fortune-telling": "Predicting the future",
  "emotional-reasoning": "Feelings as facts",
  labeling: "Sticking a label on yourself",
  "mental-filter": "Filtering out the good",
  "disqualifying-positive": "Disqualifying the wins",
  personalization: "Taking it personally",
  "should-statements": "Should-thinking",
  magnification: "Magnifying the bad",
  minimization: "Shrinking the good",
};
