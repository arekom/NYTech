/**
 * Empirical sentiment scoring via the AFINN-165 lexicon.
 *
 * Why this exists:
 *   The LLM-derived `sentiment.overall_score` is non-deterministic and
 *   doesn't expose which words drove the score. AFINN gives us a
 *   deterministic, reproducible, word-grounded second opinion. We surface
 *   both numbers and use disagreement as a low-confidence signal.
 *
 * Method:
 *   - Tokenize the transcript on whitespace, lowercase, strip surrounding
 *     punctuation but keep apostrophes (so "don't" stays as one word).
 *   - For each token, look up the AFINN-165 integer score (-5..+5).
 *   - Apply a simple negation flip: if "not"/"no"/"never"/"nothing" appears
 *     in the two tokens preceding a hit, invert that hit's sign.
 *   - Aggregate to a 0–100 score that's directly comparable to the
 *     existing LLM `overall_score`.
 *
 * Calibration:
 *   Mean AFINN score per word in normal English is roughly 0. A transcript
 *   with strong positive lean (e.g. mean +0.3 per word) maps to ~65; strong
 *   negative (mean -0.3) maps to ~35. Tuning constant K = 50 was chosen so
 *   typical answers land in the 30–70 band, matching the booth's existing
 *   sentiment scale.
 */

import { afinn165 } from "afinn-165";

const NEGATORS = new Set(["not", "no", "never", "nothing", "none", "nobody"]);
const NEGATION_WINDOW = 2; // tokens before a hit
const CALIBRATION_K = 50;

export type EmpiricalSentiment = {
  /** 0..100, directly comparable to SentimentAnalysis.overall_score */
  score: number;
  /** Total AFINN-scored words found in the transcript */
  hits: number;
  /** Sum of (possibly negation-flipped) AFINN scores */
  raw_sum: number;
  /** Total tokens considered */
  word_count: number;
  /** Up to 5 strongest-positive words with their AFINN score */
  top_positive: { word: string; score: number }[];
  /** Up to 5 strongest-negative words with their AFINN score */
  top_negative: { word: string; score: number }[];
};

export function empiricalSentiment(transcript: string): EmpiricalSentiment {
  const tokens = tokenize(transcript);
  let sum = 0;
  let hits = 0;
  const positive: { word: string; score: number }[] = [];
  const negative: { word: string; score: number }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const raw = afinn165[token];
    if (raw === undefined) continue;

    // Negation window: any negator in the preceding two tokens flips sign
    let score = raw;
    for (let j = Math.max(0, i - NEGATION_WINDOW); j < i; j++) {
      if (NEGATORS.has(tokens[j])) {
        score = -score;
        break;
      }
    }

    sum += score;
    hits += 1;
    if (score > 0) positive.push({ word: token, score });
    else if (score < 0) negative.push({ word: token, score });
  }

  const wordCount = tokens.length || 1;
  // Map mean-per-word into [0, 100] centered at 50
  const empirical01 = 0.5 + (sum / wordCount) * (CALIBRATION_K / 100);
  const score = Math.round(Math.max(0, Math.min(1, empirical01)) * 100);

  positive.sort((a, b) => b.score - a.score);
  negative.sort((a, b) => a.score - b.score);

  return {
    score,
    hits,
    raw_sum: sum,
    word_count: wordCount,
    top_positive: dedupe(positive).slice(0, 5),
    top_negative: dedupe(negative).slice(0, 5),
  };
}

/** Tokenize on whitespace, strip surrounding punctuation, lowercase. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z']+|[^a-z']+$/g, ""))
    .filter(Boolean);
}

function dedupe(list: { word: string; score: number }[]): { word: string; score: number }[] {
  const seen = new Set<string>();
  const out: { word: string; score: number }[] = [];
  for (const entry of list) {
    if (seen.has(entry.word)) continue;
    seen.add(entry.word);
    out.push(entry);
  }
  return out;
}
