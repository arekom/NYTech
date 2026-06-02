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
          Five questions · One take each · {firstName}
        </span>
      </header>

      <div className="stage-body">
        <span className="eyebrow">What we&rsquo;ll ask</span>

        <h1 className="headline" style={{ marginTop: 24, maxWidth: "32ch" }}>
          Five questions. <em>One take</em> each.
        </h1>

        <p className="subtext">
          Take a breath between each. There&rsquo;s no wrong answer —<br />
          your future self is already listening.
        </p>

        <ol className="question-preview" aria-label="The five questions">
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
        <span>Question 1 of {TOTAL_QUESTIONS} next</span>
        <span>30 seconds minimum per take</span>
      </footer>
    </section>
  );
}
