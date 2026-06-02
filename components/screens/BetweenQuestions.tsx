"use client";

import { useEffect, useRef, useState } from "react";
import Logo from "@/components/Logo";
import { TOTAL_QUESTIONS, type BoothQuestion } from "@/lib/prompts";

const AUTO_ADVANCE_MS = 3500;

type Props = {
  /** The 1-indexed question just completed. */
  completedIdx: number;
  /** The next question to record. */
  nextQuestion: BoothQuestion;
  /** Manual continue, OR called automatically after AUTO_ADVANCE_MS. */
  onContinue: () => void;
};

/**
 * The breath between questions. 3.5-second auto-advance — long enough to
 * settle, short enough to maintain rhythm. Attendee can tap "Continue"
 * early. The next question previews on screen so they can already start
 * forming their answer.
 */
export default function BetweenQuestions({ completedIdx, nextQuestion, onContinue }: Props) {
  const advancedRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(AUTO_ADVANCE_MS / 1000));

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (advancedRef.current) return;
      advancedRef.current = true;
      onContinue();
    }, AUTO_ADVANCE_MS);

    const interval = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);

    return () => {
      window.clearTimeout(t);
      window.clearInterval(interval);
    };
  }, [onContinue]);

  const handleContinue = () => {
    if (advancedRef.current) return;
    advancedRef.current = true;
    onContinue();
  };

  return (
    <section className="stage fade-in">
      <header className="stage-header">
        <span className="brand-lockup">
          <Logo height={26} />
        </span>
        <span className="meta">
          Take {completedIdx} of {TOTAL_QUESTIONS} captured
        </span>
      </header>

      <div className="stage-body">
        <span className="eyebrow">Take a breath</span>
        <hr className="rule" />

        <p className="between-eyebrow">
          Question {nextQuestion.index} of {TOTAL_QUESTIONS}
        </p>
        <h1 className="headline" style={{ marginTop: 16, maxWidth: "26ch" }}>
          {nextQuestion.text}
        </h1>

        <hr className="rule" style={{ marginTop: 40 }} />

        <button
          className="linear-btn"
          onClick={handleContinue}
          autoFocus
        >
          Ready <span className="arrow">→</span>
        </button>

        <p className="between-autoadvance">
          Auto-advancing in {secondsLeft}s
        </p>
      </div>

      <footer className="stage-footer">
        <span>{completedIdx} of {TOTAL_QUESTIONS} complete</span>
        <span>{TOTAL_QUESTIONS - completedIdx} to go</span>
      </footer>
    </section>
  );
}
