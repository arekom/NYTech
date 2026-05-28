"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Waveform from "@/components/Waveform";
import Logo from "@/components/Logo";
import { detectPitch, summarizeRegister, type PitchSample, type RegisterData } from "@/lib/pitch";

const MIN_DURATION_SECONDS = 30;
const SILENCE_PULSE_AFTER_SECONDS = 10;
const PITCH_SAMPLE_INTERVAL_MS = 100; // ~10 Hz sampling

type Props = {
  firstName: string;
  onComplete: (blob: Blob, durationSeconds: number, register: RegisterData) => void;
};

export default function Recording({ firstName, onComplete }: Props) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showMinGate, setShowMinGate] = useState(false);
  const [silenceHint, setSilenceHint] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const lastVoiceAtRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const pitchSamplesRef = useRef<PitchSample[]>([]);
  const lastPitchSampleAtRef = useRef<number>(0);

  // Acquire mic and start recorder
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);

        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
        chunksRef.current = [];
        pitchSamplesRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          const elapsedMs = performance.now() - startedAtRef.current;
          const duration = Math.round(elapsedMs / 1000);
          const register = summarizeRegister(pitchSamplesRef.current);
          onComplete(blob, duration, register);
        };
        recorder.start(250);
        recorderRef.current = recorder;
        startedAtRef.current = performance.now();
        lastVoiceAtRef.current = performance.now();

        // Combined analyser: silence detection (freq) + pitch detection (time).
        const ctxClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new ctxClass();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048; // larger window for autocorrelation
        const source = ctx.createMediaStreamSource(s);
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        const freqBuf = new Uint8Array(analyser.frequencyBinCount);
        const timeBuf = new Uint8Array(analyser.fftSize);

        const tick = () => {
          // Silence gating
          analyser.getByteFrequencyData(freqBuf);
          let sum = 0;
          for (let i = 0; i < freqBuf.length; i++) sum += freqBuf[i];
          const avg = sum / freqBuf.length;
          if (avg > 12) lastVoiceAtRef.current = performance.now();
          const silentForSec = (performance.now() - lastVoiceAtRef.current) / 1000;
          setSilenceHint(silentForSec > SILENCE_PULSE_AFTER_SECONDS);

          // Pitch sampling — throttle to ~10 Hz so autocorrelation cost stays
          // negligible vs the rAF loop.
          const now = performance.now();
          if (now - lastPitchSampleAtRef.current >= PITCH_SAMPLE_INTERVAL_MS) {
            lastPitchSampleAtRef.current = now;
            analyser.getByteTimeDomainData(timeBuf);
            const hz = detectPitch(timeBuf, ctx.sampleRate);
            if (hz !== null) {
              pitchSamplesRef.current.push({
                t: Math.round(now - startedAtRef.current),
                hz,
              });
            }
          }

          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Microphone unavailable";
        setError(msg);
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch {}
      }
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Timer
  useEffect(() => {
    if (!stream) return;
    const id = setInterval(() => {
      setSeconds(Math.floor((performance.now() - startedAtRef.current) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [stream]);

  const handleStop = useCallback(() => {
    if (seconds < MIN_DURATION_SECONDS) {
      setShowMinGate(true);
      setTimeout(() => setShowMinGate(false), 4500);
      return;
    }
    const r = recorderRef.current;
    if (!r) return;
    if (r.state !== "inactive") r.stop();
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
  }, [seconds]);

  if (error) {
    return (
      <section className="stage fade-in">
        <header className="stage-header">
          <span className="brand-lockup">
            <Logo height={26} />
          </span>
          <span className="meta">Microphone · Error</span>
        </header>
        <div className="stage-body">
          <span className="eyebrow">We couldn&rsquo;t access the mic</span>
          <hr className="rule" />
          <h1 className="headline">{error}</h1>
          <p className="subtext">Ask a staff member for help.</p>
        </div>
        <footer className="stage-footer">
          <span>Permission denied or device busy</span>
          <span>—</span>
        </footer>
      </section>
    );
  }

  return (
    <section className="stage fade-in recording-stage">
      <header className="stage-header recording-meta">
        <span>
          <span className="dot" />
          Recording for {firstName}
        </span>
        <span className="timer">{formatTimer(seconds)}</span>
      </header>

      <div className="waveform-container">
        <Waveform stream={stream} active={true} />
        <span className={`recording-hint ${silenceHint ? "visible" : ""}`}>Still here</span>
        <span className={`min-duration-gate ${showMinGate ? "visible" : ""}`}>
          Take a little more time. She&rsquo;s listening.
        </span>
      </div>

      <footer className="recording-footer">
        <button className="stop-btn" onClick={handleStop}>
          <span className="square" /> Stop recording
        </button>
        <span className="label">One take · No pause</span>
      </footer>
    </section>
  );
}

function formatTimer(total: number) {
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function pickMimeType(): string | null {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}
