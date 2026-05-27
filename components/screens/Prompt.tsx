"use client";

import Logo from "@/components/Logo";
import { OPTIONAL_PROMPTS } from "@/lib/prompts";

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
        <span className="meta">Prompt · Recording for {firstName}</span>
      </header>

      <div className="stage-body">
        <span className="eyebrow">Your question</span>
        <hr className="rule" />

        <h1 className="headline">
          What is <em>a future you</em><br />
          celebrating with you<br />
          a year from today?
        </h1>

        <p className="subtext">
          Speak freely. There&rsquo;s no wrong answer.<br />
          Take a breath first.
        </p>

        <hr className="rule" style={{ marginTop: 40 }} />

        <button className="linear-btn" onClick={onReady} autoFocus>
          I&rsquo;m ready to record <span className="arrow">→</span>
        </button>

        <ul className="optional-prompts" aria-label="Optional extensions">
          <span className="label">If you want to keep going</span>
          {OPTIONAL_PROMPTS.map((p) => (
            <li key={p}>— {p}</li>
          ))}
        </ul>
      </div>

      <footer className="stage-footer">
        <span>One take</span>
        <span>30 seconds minimum</span>
      </footer>
    </section>
  );
}
