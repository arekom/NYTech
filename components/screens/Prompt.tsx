"use client";

import Logo from "@/components/Logo";
import { QUESTIONS, TOTAL_QUESTIONS } from "@/lib/prompts";

/**
 * Overview screen shown after Intake. Sets the expectation that there are
 * five questions, then hands off to the first recording. We deliberately
 * show all five up front so attendees know what they're committing to —
 * the questions are deep and the booth time is real (4–6 min total).
 */
export default function Prompt({
  firstName,
  onReady,
}: {
  firstName: string;
  onReady: () => void;
}) {
  return (
    <section className="stage fade-in">
      <header className="stage-header">
        <span className="brand-lockup">
          <Logo height={26} />
        </span>
        <span className="meta">
          {countWord(TOTAL_QUESTIONS)} {TOTAL_QUESTIONS === 1 ? "question" : "questions"} · One take each · {firstName}
        </span>
      </header>

      <div className="stage-body">
        <span className="eyebrow">What we&rsquo;ll ask</span>

        <h1 className="headline" style={{ marginTop: 24, maxWidth: "32ch" }}>
          {TOTAL_QUESTIONS === 1 ? (
            <>One question. <em>One take.</em></>
          ) : (
            <>{capitalize(countWord(TOTAL_QUESTIONS))} questions. <em>One take</em> each.</>
          )}
        </h1>

        <p className="subtext">
          {TOTAL_QUESTIONS === 1
            ? "Take a breath first. There's no wrong answer —"
            : "Take a breath between each. There's no wrong answer —"}
          <br />
          your future self is already listening.
        </p>

        <ol
          className="question-preview"
          aria-label={`The ${TOTAL_QUESTIONS} ${TOTAL_QUESTIONS === 1 ? "question" : "questions"}`}
        >
          {QUESTIONS.map((q) => (
            <li key={q.index} className="question-preview-row">
              <span className="question-preview-num">{q.index}</span>
              <span className="question-preview-text">{q.text}</span>
            </li>
          ))}
        </ol>

        <button
          className="linear-btn"
          style={{ marginTop: 32 }}
          onClick={onReady}
          autoFocus
        >
          Begin <span className="arrow">→</span>
        </button>
      </div>

      <footer className="stage-footer">
        <span>
          {TOTAL_QUESTIONS === 1
            ? "One take next"
            : `Question 1 of ${TOTAL_QUESTIONS} next`}
        </span>
        <span>15 seconds minimum per take</span>
      </footer>
    </section>
  );
}

/** "One" / "Two" / ... / "Five", fallback to digit for higher counts. */
function countWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five"][n] ?? String(n);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
