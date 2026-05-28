/**
 * Lightweight fundamental-frequency (F0) estimator + register summary.
 *
 * Used client-side during the recording to sample vocal pitch ~10 times per
 * second. Algorithm: normalized auto-correlation on the time-domain buffer
 * we already pull from the Web Audio AnalyserNode. Fast enough to run in the
 * existing requestAnimationFrame loop without measurable cost.
 *
 * F0 detection is intentionally limited to human-voice range (75–500 Hz)
 * to suppress harmonic doubling and ignore non-speech transients.
 */

const MIN_HZ = 75;
const MAX_HZ = 500;
/** Below this normalized correlation we discard the sample as unvoiced. */
const VOICING_THRESHOLD = 0.6;

export type PitchSample = {
  /** Milliseconds from recording start */
  t: number;
  hz: number;
};

export type RegisterData = {
  /** All pitch samples captured during recording, voiced frames only. */
  samples: PitchSample[];
  avg_hz: number;
  min_hz: number;
  max_hz: number;
  /** Std deviation of pitch around the mean — proxy for register variability */
  std_hz: number;
  /** Count of moments where pitch dropped >= 1 std below mean (truth moments) */
  drop_count: number;
  /** Count of moments where pitch rose >= 1 std above mean (performance moments) */
  rise_count: number;
};

/**
 * Estimate F0 in Hz from a Uint8 time-domain buffer (values 0..255 centered
 * at 128). Returns null if the frame is unvoiced or below confidence
 * threshold.
 */
export function detectPitch(
  timeData: Uint8Array,
  sampleRate: number
): number | null {
  // Convert to signed float, also gate on overall RMS energy to skip silence.
  const N = timeData.length;
  let rms = 0;
  const floatBuf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = (timeData[i] - 128) / 128;
    floatBuf[i] = v;
    rms += v * v;
  }
  rms = Math.sqrt(rms / N);
  if (rms < 0.01) return null;

  // Auto-correlate the buffer over the lag range corresponding to MIN_HZ..MAX_HZ.
  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.floor(sampleRate / MIN_HZ);
  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < N - lag; i++) {
      sum += floatBuf[i] * floatBuf[i + lag];
    }
    const corr = sum / (N - lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Normalize correlation (rms^2 is the auto-corr at lag 0)
  const norm = bestCorr / (rms * rms);
  if (norm < VOICING_THRESHOLD || bestLag <= 0) return null;
  return sampleRate / bestLag;
}

/**
 * Reduce raw pitch samples into the register summary stored with the
 * session. drop_count and rise_count count distinct "events" — consecutive
 * frames in the same direction are merged.
 */
export function summarizeRegister(samples: PitchSample[]): RegisterData {
  if (samples.length === 0) {
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

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    sum += s.hz;
    if (s.hz < min) min = s.hz;
    if (s.hz > max) max = s.hz;
  }
  const avg = sum / samples.length;

  let varSum = 0;
  for (const s of samples) varSum += (s.hz - avg) ** 2;
  const std = Math.sqrt(varSum / samples.length);

  // Walk the samples and count direction transitions across ±1 std bands.
  let dropCount = 0;
  let riseCount = 0;
  let state: "neutral" | "below" | "above" = "neutral";
  for (const s of samples) {
    const d = s.hz - avg;
    if (d <= -std && state !== "below") {
      dropCount += 1;
      state = "below";
    } else if (d >= std && state !== "above") {
      riseCount += 1;
      state = "above";
    } else if (Math.abs(d) < std / 2) {
      state = "neutral";
    }
  }

  return {
    samples,
    avg_hz: avg,
    min_hz: min,
    max_hz: max,
    std_hz: std,
    drop_count: dropCount,
    rise_count: riseCount,
  };
}
