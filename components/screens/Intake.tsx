"use client";

import { useState } from "react";
import Logo from "@/components/Logo";

type Props = {
  initial: { firstName: string; email: string; focus: string };
  onContinue: (data: { firstName: string; email: string; focus: string }) => void;
};

export default function Intake({ initial, onContinue }: Props) {
  const [firstName, setFirstName] = useState(initial.firstName);
  const [email, setEmail] = useState(initial.email);
  const [focus, setFocus] = useState(initial.focus);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const ready = firstName.trim().length > 0 && validEmail && focus.trim().length > 0;

  return (
    <section className="stage fade-in">
      <header className="stage-header">
        <span className="brand-lockup">
          <Logo height={26} />
        </span>
        <span className="meta">Intake · Step 01 / 02</span>
      </header>

      <div className="stage-body">
        <span className="eyebrow">Before we begin</span>
        <hr className="rule" />

        <form
          className="field-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) onContinue({ firstName: firstName.trim(), email: email.trim(), focus: focus.trim() });
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="firstName">First name</label>
            <input
              id="firstName"
              className="field-input"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              autoFocus
              spellCheck={false}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="email">Email address</label>
            <input
              id="email"
              className="field-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              spellCheck={false}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="focus">What are you becoming right now?</label>
            <input
              id="focus"
              className="field-input"
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="your company, your raise, your next chapter"
              spellCheck={false}
            />
          </div>

          <hr className="rule" style={{ marginTop: 8 }} />

          <button className="linear-btn" type="submit" disabled={!ready}>
            Continue <span className="arrow">→</span>
          </button>
        </form>
      </div>

      <footer className="stage-footer">
        <span>Not stored beyond 10-day delivery</span>
        <span>Privacy by design</span>
      </footer>
    </section>
  );
}
