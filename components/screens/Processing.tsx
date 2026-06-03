"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionState } from "@/app/page";
import Logo from "@/components/Logo";
import type { SignalData } from "@/lib/signals";

const MAX_UPLOAD_RETRIES = 3;

type Props = {
  session: SessionState;
  onComplete: (deliverAt: Date, signals: SignalData) => void;
  onError: () => void;
};

///

type Stage = {
  id:
    | "receive"
    | "certainty"
    | "tempo"
    | "register"
    | "ownership"
    | "brain"
    | "synthesis"
    | "seal";
  name: string;
  subtext: string;
};

const STAGES: Stage[] = [
  { id: "receive",   name: "Receiving your takes",            subtext: "Five answers, captured" },
  { id: "certainty", name: "Mapping certainty vs hedging",    subtext: "How much you already believe it" },
  { id: "tempo",     name: "Reading tempo and pauses",        subtext: "Where you slowed, where you rushed" },
  { id: "register",  name: "Measuring vocal register",        subtext: "When you spoke from truth, not performance" },
  { id: "ownership", name: "Tracking first-person ownership", subtext: "How clearly you're claiming the story" },
  { id: "brain",     name: "Mapping cortical activations",    subtext: "Where the patterns lit up — TRIBE v2" },
  { id: "synthesis", name: "Drawing the through-line",        subtext: "Putting words and brain in one frame" },
  { id: "seal",      name: "Sealing for delivery",            subtext: "Ten days. On the dot." },
];

type StageStatus = "pending" | "active" | "done";

export default function Processing({ session, onComplete }: Props) {
  const [doneStages, setDoneStages] = useState<Set<Stage["id"]>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const completedRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runAnalyze();

    async function runAnalyze() {
      for (let attempt = 1; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
        setRetryAttempt(attempt);
        try {
          const finalSignals = await streamAnalyze(session, (id) => {
            setDoneStages((prev) => {
              if (prev.has(id)) return prev;
              const next = new Set(prev);
              next.add(id);
              return next;
            });
          });
          if (completedRef.current) return;
          completedRef.current = true;
          onComplete(new Date(finalSignals.deliverAt), finalSignals.signals);
          return;
        } catch (err) {
          if (attempt < MAX_UPLOAD_RETRIES) {
            await wait(1500 * attempt);
            // Reset stages for the retry so the UI doesn't lie about progress
            setDoneStages(new Set());
          } else {
            setErrorMessage(
              err instanceof Error ? err.message : "analysis failed"
            );
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Active stage is the first not-yet-done stage. If all are done, no active.
  const activeIndex = STAGES.findIndex((s) => !doneStages.has(s.id));
  const overallPct = Math.min(1, doneStages.size / STAGES.length);

  return (
    <section className="stage fade-in">
      <header className="stage-header">
        <span className="brand-lockup">
          <Logo height={26} />
        </span>
        <span className="meta">
          Processing · Take 01 · {Math.round(overallPct * 100)}%
        </span>
      </header>

      <div className="stage-body">
        <span className="eyebrow">Processing your take</span>
        <hr className="rule" />

        <ol className="stage-list" aria-label="Processing stages">
          {STAGES.map((stage, i) => {
            const status: StageStatus = doneStages.has(stage.id)
              ? "done"
              : i === activeIndex
              ? "active"
              : "pending";
            const isRetrySubtext =
              status === "active" && retryAttempt > 1 && stage.id === "receive";
            return (
              <li key={stage.id} className={`stage-row ${status}`}>
                <span className="stage-mark" aria-hidden>
                  {status === "done" ? "✓" : ""}
                </span>
                <div className="stage-content">
                  <span className="stage-name">{stage.name}</span>
                  <span className="stage-sub">
                    {isRetrySubtext
                      ? "Reconnecting · staying with you"
                      : stage.subtext}
                  </span>
                  {status === "active" && (
                    <span className="stage-meter" aria-hidden>
                      <span className="stage-meter-indeterminate" />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <hr className="rule" style={{ marginTop: 32 }} />

        <div className="overall-meter">
          <span className="overall-percent">{Math.round(overallPct * 100)}%</span>
          <span className="overall-divider">·</span>
          <span className="overall-remaining">
            {errorMessage
              ? "We need a moment"
              : doneStages.size === STAGES.length
              ? "Almost there"
              : "Real analysis in progress"}
          </span>
        </div>

        {errorMessage && (
          <p className="subtext" style={{ marginTop: 24 }}>
            {errorMessage}. Ask a staff member to retry.
          </p>
        )}
      </div>

      <footer className="stage-footer">
        <span>Do not close this window</span>
        <span>Mental fitness infrastructure</span>
      </footer>
    </section>
  );
}

type AnalyzeResult = {
  deliverAt: string;
  signals: SignalData;
};

/**
 * POST the recording to /api/analyze and consume the NDJSON event stream.
 * Resolves with the final `complete` event payload. Rejects on stream-level
 * `error` events or transport failure.
 */
async function streamAnalyze(
  session: SessionState,
  onStageDone: (id: Stage["id"]) => void
): Promise<AnalyzeResult> {
  if (!session.takes.length) throw new Error("no takes to analyze");

  const fd = new FormData();
  fd.append("firstName", session.firstName);
  fd.append("email", session.email);
  fd.append("focus", session.focus);
  fd.append("takeCount", String(session.takes.length));

  // Each take gets its own audio_N, durationSeconds_N, register_N,
  // questionIndex_N fields. Server iterates 1..takeCount.
  session.takes.forEach((take, i) => {
    const n = i + 1;
    fd.append(`audio_${n}`, take.audioBlob, `take-${n}.webm`);
    fd.append(`durationSeconds_${n}`, String(take.durationSeconds));
    fd.append(`register_${n}`, JSON.stringify(take.register));
    fd.append(`questionIndex_${n}`, String(take.questionIndex));
  });

  const res = await fetch("/api/analyze", { method: "POST", body: fd });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: AnalyzeResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: "stage_done"; id: Stage["id"]; data?: unknown }
        | { type: "complete"; deliverAt: string; signals: SignalData }
        | { type: "error"; message: string };

      if (event.type === "stage_done") {
        onStageDone(event.id);
      } else if (event.type === "complete") {
        final = { deliverAt: event.deliverAt, signals: event.signals };
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }

  if (!final) throw new Error("stream ended without complete event");
  return final;
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
