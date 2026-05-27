"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionState } from "@/app/page";
import Logo from "@/components/Logo";

const THEATRICAL_DURATION_MS = 45_000;
const MAX_UPLOAD_RETRIES = 5;

type Props = {
  session: SessionState;
  onComplete: (deliverAt: Date) => void;
  onError: () => void;
};

export default function Processing({ session, onComplete }: Props) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Preparing delivery to your future self");
  const [retrying, setRetrying] = useState(false);
  const completedRef = useRef(false);
  const uploadStartedRef = useRef(false);
  const uploadResultRef = useRef<{ deliverAt: Date } | null>(null);

  // Progress bar fills over 45s regardless of upload.
  // Loop continues past 100% until upload result arrives, so completion is
  // never lost if the upload finishes after the bar fills.
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - start;
      const pct = Math.min(1, elapsed / THEATRICAL_DURATION_MS);
      setProgress(pct);
      if (uploadResultRef.current && pct >= 1 && !completedRef.current) {
        completedRef.current = true;
        onComplete(uploadResultRef.current.deliverAt);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onComplete]);

  // Real upload — runs in parallel; result held until theatrical timer completes.
  // Guarded by uploadStartedRef so React StrictMode's double-invoked effects
  // (dev only) don't cause two uploads / two blob writes / two DB rows.
  useEffect(() => {
    if (uploadStartedRef.current) return;
    uploadStartedRef.current = true;

    async function upload() {
      if (!session.audioBlob) return;
      for (let attempt = 1; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
        try {
          setRetrying(attempt > 1);
          const fd = new FormData();
          fd.append("audio", session.audioBlob, "recording.webm");
          fd.append("firstName", session.firstName);
          fd.append("email", session.email);
          fd.append("focus", session.focus);
          fd.append("durationSeconds", String(session.durationSeconds));

          const res = await fetch("/api/upload", { method: "POST", body: fd });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { deliverAt: string };
          uploadResultRef.current = { deliverAt: new Date(data.deliverAt) };
          setStatus("Preparing delivery to your future self");
          return;
        } catch (err) {
          if (attempt < MAX_UPLOAD_RETRIES) {
            setStatus("Reconnecting");
            await wait(1500 * attempt);
          } else {
            queueOffline(session);
            setStatus("Saved locally — will sync");
            const fallbackDeliverAt = new Date(
              Date.now() + (Number(process.env.NEXT_PUBLIC_DELIVERY_DAYS) || 10) * 86400_000
            );
            uploadResultRef.current = { deliverAt: fallbackDeliverAt };
            return;
          }
        }
      }
    }

    upload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return (
    <section className="stage fade-in">
      <header className="stage-header">
        <span className="brand-lockup">
          <Logo height={26} />
        </span>
        <span className="meta">Processing · Take 01 · {Math.round(progress * 100)}%</span>
      </header>

      <div className="stage-body">
        <div className="processing-stack">
          <span className="eyebrow">Take received</span>

          <p className="processing-text">{status}</p>

          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>

          <p className="processing-sub">
            {retrying ? "Reconnecting · do not close" : "Do not close this window"}
          </p>
        </div>
      </div>

      <footer className="stage-footer">
        <span>Encoding · Hashing · Sealing envelope</span>
        <span>Mental fitness infrastructure</span>
      </footer>
    </section>
  );
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// IndexedDB-lite offline queue (single record at a time is fine for a booth)
function queueOffline(session: SessionState) {
  try {
    const reader = new FileReader();
    reader.onload = () => {
      const payload = {
        firstName: session.firstName,
        email: session.email,
        focus: session.focus,
        durationSeconds: session.durationSeconds,
        audioBase64: reader.result,
        queuedAt: new Date().toISOString(),
      };
      localStorage.setItem("future-self:queued", JSON.stringify(payload));
    };
    if (session.audioBlob) reader.readAsDataURL(session.audioBlob);
  } catch {
    // best effort
  }
}
