"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import BrainCanvas from "@/components/BrainCanvas";
import type {
  BrainMap,
  CorticalRegion,
  RegionAttribution,
  SignalData,
  Synthesis,
  ThinkingPattern,
} from "@/lib/signals";
import { PATTERN_LABELS } from "@/lib/signals";
import type { Take } from "@/app/page";
import { QUESTIONS } from "@/lib/prompts";

type Props = {
  firstName: string;
  deliverAt: Date;
  signals: SignalData | null;
  takes: Take[];
  onDone: () => void;
};

/**
 * Confirmation — the output page modeled on the Miro mockup
 * ("NYC Tech Event POC"). Light theme adapted from the dark reference.
 * Section order, top to bottom:
 *   1. Logo header
 *   2. HERO: "Your Result — What this says about your beliefs & habits"
 *      with up to 5 synthesis findings
 *   3. Audio player + Brain map (side-by-side)
 *   4. "The reasoning" intro
 *   5. "What your words said" — themes chips, tone gauge, self-focus gauge,
 *      pattern cards
 *   6. "Top 3 most active brain regions" with per-region attribution cards
 *   7. Delivery date + Done CTA
 */
export default function Confirmation({
  firstName,
  deliverAt,
  signals,
  takes,
  onDone,
}: Props) {
  const dateLabel = formatDeliveryDate(deliverAt);

  return (
    <section className="stage stage-output fade-in">
      <header className="stage-header">
        <span className="brand-lockup">
          <Logo height={26} />
        </span>
        <span className="meta">Take complete · {firstName}</span>
      </header>

      <div className="stage-body output-body" data-scrollable>
        {signals ? (
          <>
            <ResultHero
              synthesis={signals.synthesis ?? null}
              fallback={fallbackIntro(signals)}
            />
            <MediaRow takes={takes} brainMap={signals.brain_map ?? null} />
            <ReasoningIntro />
            <WhatYourWordsSaid signals={signals} />
            {/* Top brain regions panel hidden for now — interactive cortex
                in MediaRow covers this territory visually. Restore by
                re-rendering <BrainRegions /> with the same props. */}
            <DeliveryFooter firstName={firstName} dateLabel={dateLabel} />
          </>
        ) : (
          <p className="subtext">
            We held your take. The full readout will arrive with your email.
          </p>
        )}

        <div style={{ marginTop: 40, textAlign: "center" }}>
          <button className="linear-btn" onClick={onDone} autoFocus>
            Done <span className="arrow">→</span>
          </button>
        </div>
      </div>

      <footer className="stage-footer">
        <span>Recording sealed</span>
        <span>Delivery {dateLabel}</span>
      </footer>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   1. Hero — 5 synthesis findings
   ───────────────────────────────────────────────────────────────────── */

function ResultHero({
  synthesis,
  fallback,
}: {
  synthesis: Synthesis | null;
  fallback: string;
}) {
  return (
    <section className="result-hero">
      <span className="result-eyebrow">Your Result</span>
      <h1 className="result-title">What this says about your beliefs &amp; habits</h1>
      <p className="result-intro">
        {synthesis?.intro?.trim() || fallback}
      </p>

      {synthesis?.findings.length ? (
        <ol className="result-findings">
          {synthesis.findings.map((f, i) => (
            <li key={i} className="result-finding">
              <span className="result-finding-num">{i + 1}</span>
              <div className="result-finding-content">
                <h3 className="result-finding-headline">{f.headline}</h3>
                <p className="result-finding-body">{f.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="subtext" style={{ marginTop: 20 }}>
          We&rsquo;ll send you the full read-out with your email in ten days.
        </p>
      )}
    </section>
  );
}

function fallbackIntro(s: SignalData): string {
  const fv = s.future_vision.summary;
  return (
    fv ||
    "A small set of inferences drawn from your words — these are patterns, not verdicts."
  );
}

/* ─────────────────────────────────────────────────────────────────────
   2. Audio player + brain
   ───────────────────────────────────────────────────────────────────── */

function MediaRow({
  takes,
  brainMap,
}: {
  takes: Take[];
  brainMap: BrainMap | null;
}) {
  // Track global audio time across the concatenated multi-take recording.
  // AudioPlayer plays takes individually; we translate (takeIdx,
  // takeCurrentTime) into a single timeline value the BrainCanvas can use
  // to look up the active TRIBE frame.
  const [globalTime, setGlobalTime] = useState(0);

  // Precompute cumulative offsets so the callback below is O(1). Indexed
  // by take number: offsets[i] = total duration of takes[0..i-1].
  const offsets = useMemo(() => {
    const out = new Array<number>(takes.length);
    let acc = 0;
    for (let i = 0; i < takes.length; i++) {
      out[i] = acc;
      acc += takes[i].durationSeconds || 0;
    }
    return out;
  }, [takes]);

  const onTakeTime = (takeIdx: number, takeCurrentTime: number) => {
    setGlobalTime((offsets[takeIdx] ?? 0) + takeCurrentTime);
  };

  const brainImageUrl = brainMap?.image_url ?? null;
  const hasActivations =
    !!brainMap?.activations_url &&
    !!brainMap.frame_times.length &&
    brainMap.frame_count > 0 &&
    brainMap.vertex_count > 0;

  if (!takes.length && !brainImageUrl) return null;

  return (
    <section className="media-row">
      <div className="media-audio">
        <span className="signal-label">Your audio</span>
        <AudioPlayer takes={takes} onTakeTime={onTakeTime} />
      </div>
      {brainImageUrl && (
        <div className="media-brain">
          <span className="signal-label">
            Cortical activation {hasActivations ? "· live with your voice" : "· peak frame"}
          </span>
          {hasActivations && brainMap ? (
            <BrainCanvas
              meshUrl="/brain/fsaverage5.bin"
              activationsUrl={brainMap.activations_url!}
              frameTimes={brainMap.frame_times}
              vertexCount={brainMap.vertex_count}
              frameCount={brainMap.frame_count}
              peakFramePacked={brainMap.peak_timestep_packed}
              currentTime={globalTime}
              fallbackImageUrl={brainImageUrl}
            />
          ) : (
            <img className="media-brain-image" src={brainImageUrl} alt="Cortical activation map" />
          )}
          <p className="media-brain-foot">
            TRIBE v2 · research use only
          </p>
        </div>
      )}
    </section>
  );
}

function AudioPlayer({
  takes,
  onTakeTime,
}: {
  takes: Take[];
  /** Fires on every timeupdate AND on take switch so the parent can
   *  recompute global audio time. takeIdx is the currently-playing take;
   *  takeCurrentTime is seconds within that take. */
  onTakeTime?: (takeIdx: number, takeCurrentTime: number) => void;
}) {
  // Generate object URLs for each take. Cleanup on unmount.
  const urls = useMemo(
    () => takes.map((t) => URL.createObjectURL(t.audioBlob)),
    [takes]
  );
  useEffect(() => {
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [urls]);

  const [activeIdx, setActiveIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // MediaRecorder produces fragmented WebM that has no end-of-stream
  // declaration — `audioElement.duration` reports Infinity until the file
  // is played to completion. Trust the duration we captured at recording
  // time on the Take object instead.
  const activeTake = takes[activeIdx];
  const knownDuration = activeTake?.durationSeconds ?? 0;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const effectiveDuration = (): number => {
      // Prefer browser-reported duration if it's actually finite, fall
      // back to the recorder-captured one we know is real.
      if (Number.isFinite(a.duration) && a.duration > 0) return a.duration;
      return knownDuration;
    };
    const onTime = () => {
      const dur = effectiveDuration();
      setProgress(dur > 0 ? Math.min(1, a.currentTime / dur) : 0);
      onTakeTime?.(activeIdx, a.currentTime);
    };
    const onEnd = () => setIsPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    // Emit once on take switch so the brain canvas snaps to the new
    // take's start frame before the user hits play.
    onTakeTime?.(activeIdx, a.currentTime);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, [activeIdx, knownDuration, onTakeTime]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setIsPlaying(true);
    } else {
      a.pause();
      setIsPlaying(false);
    }
  };

  const seek = (pct: number) => {
    const a = audioRef.current;
    if (!a || knownDuration <= 0) return;
    const target = pct * knownDuration;
    if (!Number.isFinite(target) || target < 0) return;
    try {
      a.currentTime = target;
    } catch {
      // Some browsers reject seeks before metadata is loaded; ignore.
      return;
    }
    setProgress(pct);
    onTakeTime?.(activeIdx, target);
  };

  return (
    <div className="audio-player">
      <div className="audio-player-controls">
        <button
          className={`audio-play-btn ${isPlaying ? "playing" : ""}`}
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <div
          className="audio-scrubber"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek((e.clientX - rect.left) / rect.width);
          }}
        >
          <span className="audio-scrubber-fill" style={{ width: `${progress * 100}%` }} />
          <span className="audio-scrubber-pin" style={{ left: `${progress * 100}%` }} />
        </div>
        <audio ref={audioRef} src={urls[activeIdx]} preload="metadata" />
      </div>
      {takes.length > 1 && (
        <div className="audio-take-tabs">
          {takes.map((t, i) => (
            <button
              key={i}
              className={`audio-take-tab ${i === activeIdx ? "active" : ""}`}
              onClick={() => {
                setActiveIdx(i);
                setIsPlaying(false);
                setProgress(0);
              }}
            >
              Q{t.questionIndex} · {QUESTIONS[t.questionIndex - 1]?.label ?? ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   3. Reasoning intro
   ───────────────────────────────────────────────────────────────────── */

function ReasoningIntro() {
  return (
    <section className="reasoning">
      <span className="result-eyebrow">The reasoning</span>
      <h2 className="reasoning-title">Here&rsquo;s how we got there</h2>
      <p className="reasoning-body">
        The findings above are built from two sources of evidence: the brain
        regions that engaged most strongly while you spoke, and the linguistic
        patterns in your words. Both shown below.
      </p>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   4. What your words said — themes, gauges, patterns
   ───────────────────────────────────────────────────────────────────── */

function WhatYourWordsSaid({ signals }: { signals: SignalData }) {
  const themes = signals.linguistic.themes;
  const unhelpful = signals.thinking_patterns.filter((p) => p.pattern_type === "unhelpful");

  return (
    <section className="words-panel">
      <span className="result-eyebrow">What your words said</span>

      {themes.length > 0 && (
        <div className="words-themes">
          <span className="signal-label">Themes</span>
          <ul className="theme-chips">
            {themes.map((t) => (
              <li key={t} className="theme-chip">{t}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="words-gauges">
        <Gauge
          label="Emotional tone"
          leftLabel="self-critical"
          rightLabel="positive"
          /* sentiment.overall_score is 0..100; map directly to 0..1 */
          value={signals.sentiment.overall_score / 100}
          caption={`${signals.sentiment.category.replace(/_/g, " ")} · ${signals.sentiment.dominant_emotion}`}
        />
        <Gauge
          label="Self-focus — how often you talked about yourself"
          leftLabel="low"
          rightLabel="high"
          value={signals.ownership.self_focus_ratio}
          caption={selfFocusCaption(signals.ownership.self_focus_ratio)}
        />
      </div>

      {unhelpful.length > 0 && (
        <div className="words-patterns">
          <span className="signal-label">Patterns detected</span>
          <ul className="pattern-cards">
            {unhelpful.slice(0, 3).map((p, i) => (
              <PatternCard key={i} pattern={p} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Gauge({
  label,
  leftLabel,
  rightLabel,
  value,
  caption,
}: {
  label: string;
  leftLabel: string;
  rightLabel: string;
  value: number;
  caption: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="gauge">
      <span className="gauge-label">{label}</span>
      <div className="gauge-scale">
        <span className="gauge-end">{leftLabel}</span>
        <span className="gauge-end gauge-end-right">{rightLabel}</span>
      </div>
      <div className="gauge-track">
        <span className="gauge-fill" style={{ width: `${pct}%` }} />
        <span className="gauge-pin" style={{ left: `${pct}%` }} />
      </div>
      <p className="gauge-caption">{caption}</p>
    </div>
  );
}

function selfFocusCaption(ratio: number): string {
  const pct = Math.round(ratio * 100);
  if (pct >= 25) return `High — ${pct}% of your words pointed at yourself (avg ≈ 15%)`;
  if (pct >= 18) return `Above average — ${pct}% of your words pointed at yourself`;
  if (pct >= 10) return `Average — ${pct}% of your words pointed at yourself`;
  return `Low — ${pct}% of your words pointed at yourself`;
}

function PatternCard({ pattern }: { pattern: ThinkingPattern }) {
  const example = pattern.examples[0];
  return (
    <li className="pattern-card">
      <span className="pattern-card-title">{PATTERN_LABELS[pattern.pattern]}</span>
      {example && (
        <p className="pattern-card-quote">
          <em>You said:</em> &ldquo;{example}&rdquo;
        </p>
      )}
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   5. Top brain regions — cards with attribution
   ───────────────────────────────────────────────────────────────────── */

function BrainRegions({
  regions,
  attributions,
}: {
  regions: CorticalRegion[];
  attributions: RegionAttribution[];
}) {
  if (!regions.length) return null;

  const attrById = new Map(attributions.map((a) => [a.region_id, a]));
  const top = regions.slice(0, 3);

  return (
    <section className="regions-panel">
      <span className="result-eyebrow">Top 3 most active brain regions</span>
      <ul className="region-cards">
        {top.map((r, i) => {
          const attr = attrById.get(r.id);
          return (
            <li key={r.id} className="region-card">
              <header className="region-card-head">
                <h3 className="region-card-title">{r.scientific_name}</h3>
                <span className="region-card-num">{i + 1}</span>
              </header>
              <p className="region-card-sub">{r.short_function}</p>

              {attr && (
                <>
                  <div className="region-card-section">
                    <span className="region-card-label">What you said that activated it</span>
                    <p className="region-card-body">{attr.activated_by}</p>
                    {attr.verbatim_quote && (
                      <p className="region-card-quote">
                        &ldquo;{attr.verbatim_quote}&rdquo;
                      </p>
                    )}
                  </div>
                  <div className="region-card-section">
                    <span className="region-card-label">What this hints about you</span>
                    <p className="region-card-body">{attr.hints}</p>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   6. Delivery footer (date + brand line)
   ───────────────────────────────────────────────────────────────────── */

function DeliveryFooter({ firstName, dateLabel }: { firstName: string; dateLabel: string }) {
  return (
    <section className="delivery-block">
      <hr className="rule" />
      <p className="delivery-label">
        {firstName}, your future self will receive this on
      </p>
      <p className="delivery-date">
        <em>{dateLabel}</em>
      </p>
      <p className="brand-line">
        <strong>She&rsquo;s already there.</strong> You&rsquo;re on your way.
      </p>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────────── */

function formatDeliveryDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
