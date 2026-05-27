"use client";

import { useEffect, useRef } from "react";

type Props = {
  stream: MediaStream | null;
  active: boolean;
};

/**
 * Oscilloscope-style waveform readout.
 *
 * Two layered signals:
 *   - Time-domain trace: a thin precise line, like an EKG/oscilloscope sweep
 *   - Frequency bars: a quiet underlayer that breathes with vocal energy
 *
 * Renders to a high-DPI canvas. No gradients, no soft blurs — single tone.
 */
export default function Waveform({ stream, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // High-DPI canvas sizing
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    if (!stream || !active) {
      // Draw idle baseline
      drawIdle(canvas);
      return () => window.removeEventListener("resize", resize);
    }

    // Set up audio graph
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    sourceRef.current = source;

    const bufferLength = analyser.fftSize;
    const timeData = new Uint8Array(bufferLength);
    const freqData = new Uint8Array(analyser.frequencyBinCount);

    const render = () => {
      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);
      drawFrame(canvas, timeData, freqData);
      animRef.current = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("resize", resize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      try {
        source.disconnect();
      } catch {}
      audioCtx.close().catch(() => {});
    };
  }, [stream, active]);

  return <canvas ref={canvasRef} className="waveform-canvas" />;
}

// Brand palette: ink = Core Dark (Quiet Lavender 100), accent = Quiet Lavender
const INK = "27, 27, 47";          // --core-dark
const ACCENT = "180, 180, 219";    // --quiet-lavender

function drawIdle(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  // Center baseline only
  ctx.strokeStyle = `rgba(${INK}, 0.18)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}

function drawFrame(canvas: HTMLCanvasElement, timeData: Uint8Array, freqData: Uint8Array) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  // -------------- frequency underlayer (subtle bars) --------------
  const bins = 64;
  const step = Math.floor(freqData.length / bins);
  const barWidth = w / bins;
  ctx.fillStyle = `rgba(${ACCENT}, 0.35)`;
  for (let i = 0; i < bins; i++) {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += freqData[i * step + j];
    const avg = sum / step / 255;
    const barHeight = avg * h * 0.7;
    const x = i * barWidth;
    const y = (h - barHeight) / 2;
    ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
  }

  // -------------- baseline --------------
  ctx.strokeStyle = `rgba(${INK}, 0.10)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // -------------- tick marks (every 1/8 of width) --------------
  ctx.strokeStyle = `rgba(${INK}, 0.18)`;
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const x = (w / 8) * i;
    ctx.beginPath();
    ctx.moveTo(x, h / 2 - 6);
    ctx.lineTo(x, h / 2 + 6);
    ctx.stroke();
  }

  // -------------- time-domain trace (precise line) --------------
  ctx.strokeStyle = `rgba(${INK}, 0.9)`;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  const slice = w / timeData.length;
  let x = 0;
  for (let i = 0; i < timeData.length; i++) {
    const v = timeData[i] / 128.0; // 0..2, centered at 1
    const y = (v * h) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += slice;
  }
  ctx.stroke();
}
