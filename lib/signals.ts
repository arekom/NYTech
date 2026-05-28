/**
 * Canonical types and lightweight helpers for Space of Mind's four
 * measurement signals. The brand's voice principles ("loving, direct, no BS"
 * and "avoid clinical jargon in consumer contexts") drive the human-facing
 * `summary` strings — they translate raw numbers into a sentence the
 * attendee can actually carry away from the booth.
 *
 * Split by computation type:
 *   - certainty + ownership  → require an LLM pass over the transcript
 *   - tempo                  → pure code from Whisper word timestamps
 *   - register               → pure code from client-captured pitch samples
 */

import type { RegisterData } from "@/lib/pitch";

export type WordTimestamp = {
  word: string;
  start: number; // seconds
  end: number;   // seconds
};

export type CertaintySignal = {
  hedge_count: number;
  certainty_count: number;
  /** hedge / (hedge + certainty), 0..1 */
  hedge_ratio: number;
  /** Up to three short phrases pulled from the transcript */
  examples: { hedge: string[]; certainty: string[] };
  summary: string;
};

export type TempoSignal = {
  /** Gaps between word.end and next word.start that exceed PAUSE_THRESHOLD_MS */
  pause_count: number;
  longest_pause_ms: number;
  avg_pause_ms: number;
  speech_rate_wpm: number;
  /**
   * The short verbatim fragment (up to 4 words) immediately preceding the
   * longest pause. This is what the speaker stopped on — the place where
   * the resistance lives. Empty string if there were no qualifying pauses.
   */
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
  /** first_person / (first_person + passive + third_person), 0..1 */
  agency_ratio: number;
  examples: { first_person: string[]; passive: string[]; third_person: string[] };
  summary: string;
};

export type SignalData = {
  transcript: string;
  duration_seconds: number;
  word_count: number;
  certainty: CertaintySignal;
  tempo: TempoSignal;
  register: RegisterSignal;
  ownership: OwnershipSignal;
};

const PAUSE_THRESHOLD_MS = 500;
const FRAGMENT_WORD_COUNT = 4;

/**
 * Compute tempo signal from Whisper word-level timestamps. Pure code, no LLM.
 * The verbatim quote is the short fragment immediately preceding the longest
 * pause — the spot where the speaker stopped before saying the next thing.
 */
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

  // Pull the fragment that came right before the longest pause.
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
  // No qualifying pauses — talk about pace instead.
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

  // We have at least one pause AND a verbatim fragment — the strong case.
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

  // Fallback — pauses present but no fragment recoverable.
  return `${pauses} pause${pauses === 1 ? "" : "s"}, longest ${seconds}s. Listen for what came right after.`;
}

/**
 * Convert pure pitch numbers from the client into the human-facing register
 * signal. Brand-voice summary derived from the drop/rise ratio.
 */
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
