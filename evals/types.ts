/**
 * Types for the evaluation harness. Each fixture is a directory under
 * `evals/fixtures/<slug>/` containing at minimum:
 *   - audio.{webm,m4a,ogg,wav}   the recording to feed through the pipeline
 *   - ground_truth.yaml          annotations describing what we expect
 *   - script.md (optional)       the script the recording reader used
 *
 * The harness parses ground_truth.yaml, runs the pipeline, and compares.
 * Per-fixture results roll up to a session-wide pass/fail + numeric scores
 * (precision, recall, tolerance hits).
 */

import type { LimitingBeliefType, ThinkingPatternType } from "@/lib/signals";
import type { ForbiddenWordHit } from "@/lib/forbidden-words";

export type { ForbiddenWordHit };

/** What we expect the pipeline to produce. Everything is optional — only
 *  declared expectations get evaluated. Omit a field if you don't want it
 *  scored (useful for fixtures targeting one specific signal). */
export type GroundTruth = {
  /** Free-text description of what this fixture is testing — shown in output */
  description: string;

  /** Approximate transcript (we don't require exact Whisper output — the
   *  evaluator scores semantic overlap, not byte equality). */
  transcript_hint?: string;

  /** Counts (with a tolerance window) */
  expected?: {
    /** Themes we expect to see in `linguistic.themes`. Lexical fuzzy match. */
    themes?: string[];
    /** Phrases the speaker repeated ≥ 2x. We re-count against transcript. */
    repeated_phrases?: string[];
    /** Peak emotional phrase, fuzzy-matched. */
    peak_emotional_phrase?: string;

    /** Limiting beliefs that should be detected (by slug). */
    limiting_beliefs?: LimitingBeliefType[];
    /** Beliefs that should NOT be detected (false-positive guard). */
    not_limiting_beliefs?: LimitingBeliefType[];

    /** Thinking patterns that should be detected. */
    thinking_patterns?: ThinkingPatternType[];
    /** Patterns that should NOT be detected. */
    not_thinking_patterns?: ThinkingPatternType[];

    /** Hedge count ± tolerance. */
    hedge_count?: { value: number; tolerance: number };
    /** Certainty count ± tolerance. */
    certainty_count?: { value: number; tolerance: number };
    /** Self-focus ratio ± tolerance (0..1). */
    self_focus_ratio?: { value: number; tolerance: number };

    /** Sentiment overall score ± tolerance (0..100). */
    sentiment_score?: { value: number; tolerance: number };
    /** Sentiment category, exact match. */
    sentiment_category?:
      | "very_negative"
      | "negative"
      | "somewhat_negative"
      | "neutral"
      | "somewhat_positive"
      | "positive"
      | "very_positive";
    /** Dominant emotion, fuzzy match against any of these. */
    dominant_emotion_oneof?: string[];
  };
};

/** Comparison outcome for a single check. */
export type CheckResult =
  | { kind: "pass"; label: string; detail?: string }
  | { kind: "fail"; label: string; detail: string }
  | { kind: "skip"; label: string; reason: string };

/** Result for one fixture. */
export type FixtureResult = {
  slug: string;
  description: string;
  audioPath: string;
  /** Wall-clock seconds spent running the pipeline on this fixture. */
  durationSeconds: number;
  /** Transcript Whisper produced — saved verbatim for review. */
  transcript: string;
  /** Each check produced by the evaluators (themes, distortions, etc.). */
  checks: CheckResult[];
  /** Any clinical-jargon hits in user-facing copy. */
  forbiddenWordHits: ForbiddenWordHit[];
  /** Soft errors (synthesis failed, brain unavailable, etc.). */
  warnings: string[];
  /** Final pipeline output for review (signal_data). */
  signalSummary: {
    themes: string[];
    limiting_beliefs: string[];
    thinking_patterns: string[];
    hedge_count: number;
    certainty_count: number;
    self_focus_ratio: number;
    sentiment: { score: number; category: string; dominant_emotion: string };
    synthesis_findings: { headline: string }[];
  };
};

/** Summary row across all fixtures, written to evals/results.json. */
export type EvalRunSummary = {
  runId: string;
  startedAt: string;
  fixtureCount: number;
  totalChecks: number;
  passed: number;
  failed: number;
  skipped: number;
  forbiddenWordHits: number;
  fixtures: FixtureResult[];
};
