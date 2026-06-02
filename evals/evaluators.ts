/**
 * Per-signal comparison logic. Each evaluator takes pipeline output +
 * ground-truth expectations and returns one or more CheckResults that
 * roll up to the fixture's pass/fail row.
 *
 * Conventions:
 *   - Lexical comparisons are case-insensitive, whitespace-normalized.
 *   - Themes / phrases use fuzzy substring match (we accept "self-doubt"
 *     when ground truth says "self doubt").
 *   - Numeric comparisons use the tolerance window declared in the YAML.
 *   - When ground truth doesn't declare an expectation for a field, we
 *     emit a `skip` so the field isn't silently passed.
 */

import type {
  LimitingBeliefType,
  SignalData,
  ThinkingPatternType,
} from "@/lib/signals";
import type { CheckResult, GroundTruth } from "./types";

/**
 * Max acceptable distance between the LLM `overall_score` and the
 * deterministic AFINN `empirical_score` (both 0..100). Larger gaps flag
 * low confidence in the LLM read. We require ≥3 AFINN hits before
 * running this check — fewer hits means the empirical score is noisy.
 */
const SENTIMENT_AGREEMENT_TOLERANCE = 25;
const MIN_AFINN_HITS_FOR_AGREEMENT = 3;

export function evaluate(signals: SignalData, gt: GroundTruth): CheckResult[] {
  const checks: CheckResult[] = [];
  const exp = gt.expected ?? {};

  // ── always-on: LLM sentiment vs empirical sentiment agreement ─────
  // Doesn't require a ground-truth entry. Just sanity-checks that the
  // non-deterministic LLM read agrees with the deterministic AFINN read.
  if (signals.sentiment.empirical_hits >= MIN_AFINN_HITS_FOR_AGREEMENT) {
    const llm = signals.sentiment.overall_score;
    const emp = signals.sentiment.empirical_score;
    const gap = Math.abs(llm - emp);
    if (gap <= SENTIMENT_AGREEMENT_TOLERANCE) {
      checks.push({
        kind: "pass",
        label: "sentiment LLM↔AFINN agreement",
        detail: `LLM ${llm} ↔ AFINN ${emp} (gap ${gap}, hits ${signals.sentiment.empirical_hits})`,
      });
    } else {
      checks.push({
        kind: "fail",
        label: "sentiment LLM↔AFINN agreement",
        detail: `LLM ${llm} vs AFINN ${emp} differ by ${gap} (>${SENTIMENT_AGREEMENT_TOLERANCE}). One of them drifted.`,
      });
    }
  } else {
    checks.push({
      kind: "skip",
      label: "sentiment LLM↔AFINN agreement",
      reason: `only ${signals.sentiment.empirical_hits} AFINN hit${signals.sentiment.empirical_hits === 1 ? "" : "s"} (need ${MIN_AFINN_HITS_FOR_AGREEMENT})`,
    });
  }


  // ── themes ───────────────────────────────────────────────────────
  if (exp.themes) {
    const detected = signals.linguistic.themes.map(norm);
    const missing = exp.themes
      .map(norm)
      .filter((t) => !detected.some((d) => fuzzyContains(d, t) || fuzzyContains(t, d)));
    if (missing.length === 0) {
      checks.push({
        kind: "pass",
        label: "themes",
        detail: `detected: ${signals.linguistic.themes.join(", ") || "(none)"}`,
      });
    } else {
      checks.push({
        kind: "fail",
        label: "themes",
        detail: `missing expected themes: ${missing.join(", ")}; detected: ${signals.linguistic.themes.join(", ") || "(none)"}`,
      });
    }
  }

  // ── repeated phrases ─────────────────────────────────────────────
  if (exp.repeated_phrases) {
    const detected = signals.linguistic.repeated_phrases.map((r) => norm(r.phrase));
    const missing = exp.repeated_phrases
      .map(norm)
      .filter((p) => !detected.some((d) => fuzzyContains(d, p) || fuzzyContains(p, d)));
    if (missing.length === 0) {
      checks.push({ kind: "pass", label: "repeated_phrases" });
    } else {
      checks.push({
        kind: "fail",
        label: "repeated_phrases",
        detail: `missing: ${missing.join(", ")}`,
      });
    }
  }

  // ── peak emotional phrase ────────────────────────────────────────
  if (exp.peak_emotional_phrase) {
    const detected = norm(signals.linguistic.peak_emotional_phrase);
    const expected = norm(exp.peak_emotional_phrase);
    if (detected && (fuzzyContains(detected, expected) || fuzzyContains(expected, detected))) {
      checks.push({ kind: "pass", label: "peak_emotional_phrase" });
    } else {
      checks.push({
        kind: "fail",
        label: "peak_emotional_phrase",
        detail: `expected "${exp.peak_emotional_phrase}"; got "${signals.linguistic.peak_emotional_phrase}"`,
      });
    }
  }

  // ── limiting beliefs: should-be-detected ─────────────────────────
  if (exp.limiting_beliefs) {
    const detected = new Set(signals.limiting_beliefs.map((b) => b.type));
    const missing = exp.limiting_beliefs.filter((b) => !detected.has(b));
    if (missing.length === 0) {
      checks.push({
        kind: "pass",
        label: "limiting_beliefs (precision)",
        detail: `detected: ${[...detected].join(", ") || "(none)"}`,
      });
    } else {
      checks.push({
        kind: "fail",
        label: "limiting_beliefs (precision)",
        detail: `missing: ${missing.join(", ")}; detected: ${[...detected].join(", ") || "(none)"}`,
      });
    }
  }

  // ── limiting beliefs: should NOT be detected (false-positive guard)
  if (exp.not_limiting_beliefs) {
    const detected = new Set(signals.limiting_beliefs.map((b) => b.type));
    const falsePositives = exp.not_limiting_beliefs.filter((b: LimitingBeliefType) =>
      detected.has(b)
    );
    if (falsePositives.length === 0) {
      checks.push({ kind: "pass", label: "limiting_beliefs (no false positives)" });
    } else {
      checks.push({
        kind: "fail",
        label: "limiting_beliefs (no false positives)",
        detail: `unexpectedly detected: ${falsePositives.join(", ")}`,
      });
    }
  }

  // ── thinking patterns: should-be-detected ────────────────────────
  if (exp.thinking_patterns) {
    const detected = new Set(signals.thinking_patterns.map((p) => p.pattern));
    const missing = exp.thinking_patterns.filter((p) => !detected.has(p));
    if (missing.length === 0) {
      checks.push({
        kind: "pass",
        label: "thinking_patterns (precision)",
        detail: `detected: ${[...detected].join(", ") || "(none)"}`,
      });
    } else {
      checks.push({
        kind: "fail",
        label: "thinking_patterns (precision)",
        detail: `missing: ${missing.join(", ")}; detected: ${[...detected].join(", ") || "(none)"}`,
      });
    }
  }

  // ── thinking patterns: should NOT be detected ────────────────────
  if (exp.not_thinking_patterns) {
    const detected = new Set(signals.thinking_patterns.map((p) => p.pattern));
    const falsePositives = exp.not_thinking_patterns.filter(
      (p: ThinkingPatternType) => detected.has(p)
    );
    if (falsePositives.length === 0) {
      checks.push({ kind: "pass", label: "thinking_patterns (no false positives)" });
    } else {
      checks.push({
        kind: "fail",
        label: "thinking_patterns (no false positives)",
        detail: `unexpectedly detected: ${falsePositives.join(", ")}`,
      });
    }
  }

  // ── counts ───────────────────────────────────────────────────────
  if (exp.hedge_count) {
    checks.push(
      checkTolerance(
        "hedge_count",
        signals.certainty.hedge_count,
        exp.hedge_count.value,
        exp.hedge_count.tolerance
      )
    );
  }
  if (exp.certainty_count) {
    checks.push(
      checkTolerance(
        "certainty_count",
        signals.certainty.certainty_count,
        exp.certainty_count.value,
        exp.certainty_count.tolerance
      )
    );
  }
  if (exp.self_focus_ratio) {
    checks.push(
      checkTolerance(
        "self_focus_ratio",
        signals.ownership.self_focus_ratio,
        exp.self_focus_ratio.value,
        exp.self_focus_ratio.tolerance
      )
    );
  }
  if (exp.sentiment_score) {
    checks.push(
      checkTolerance(
        "sentiment_score",
        signals.sentiment.overall_score,
        exp.sentiment_score.value,
        exp.sentiment_score.tolerance
      )
    );
  }

  // ── sentiment category ──────────────────────────────────────────
  if (exp.sentiment_category) {
    if (signals.sentiment.category === exp.sentiment_category) {
      checks.push({
        kind: "pass",
        label: "sentiment_category",
        detail: signals.sentiment.category,
      });
    } else {
      checks.push({
        kind: "fail",
        label: "sentiment_category",
        detail: `expected ${exp.sentiment_category}; got ${signals.sentiment.category}`,
      });
    }
  }

  // ── dominant emotion oneof ──────────────────────────────────────
  if (exp.dominant_emotion_oneof) {
    const got = norm(signals.sentiment.dominant_emotion);
    const wanted = exp.dominant_emotion_oneof.map(norm);
    if (wanted.some((w) => got === w || fuzzyContains(got, w) || fuzzyContains(w, got))) {
      checks.push({
        kind: "pass",
        label: "dominant_emotion",
        detail: `got "${signals.sentiment.dominant_emotion}"`,
      });
    } else {
      checks.push({
        kind: "fail",
        label: "dominant_emotion",
        detail: `expected one of [${exp.dominant_emotion_oneof.join(", ")}]; got "${signals.sentiment.dominant_emotion}"`,
      });
    }
  }

  return checks;
}

function checkTolerance(
  label: string,
  actual: number,
  expected: number,
  tolerance: number
): CheckResult {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    return {
      kind: "pass",
      label,
      detail: `${roundN(actual)} (expected ${expected} ±${tolerance})`,
    };
  }
  return {
    kind: "fail",
    label,
    detail: `${roundN(actual)} outside ${expected} ±${tolerance}`,
  };
}

function roundN(n: number): number {
  if (Math.abs(n) >= 100) return Math.round(n);
  return Math.round(n * 100) / 100;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\w\s'"-]/g, " ").replace(/\s+/g, " ").trim();
}

function fuzzyContains(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  // Soft contains: tolerates hyphenation differences ("self-doubt" vs "self doubt")
  const h = haystack.replace(/[-_]/g, " ");
  const n = needle.replace(/[-_]/g, " ");
  return h.includes(n);
}
