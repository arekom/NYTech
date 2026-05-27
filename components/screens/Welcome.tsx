"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/Logo";

export default function Welcome({ onBegin }: { onBegin: () => void }) {
  const [stamp, setStamp] = useState("");

  useEffect(() => {
    const d = new Date();
    setStamp(
      d.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      }).toUpperCase()
    );
  }, []);

  return (
    <section className="stage fade-in">
      <header className="stage-header">
        <span className="brand-lockup">
          <Logo height={28} />
        </span>
        <span className="meta">{stamp} · Session 001</span>
      </header>

      <div className="stage-body">
        <span className="eyebrow">A recording for the version of you</span>
        <hr className="rule" />
        <h1 className="headline">
          Speak to the you<br />
          already on the other side<br />
          of the pattern <em>holding you back</em>.
        </h1>
        <p className="subtext">
          One take. One question. Ten days from now,<br />
          your future self sends it home.
        </p>
        <hr className="rule" style={{ marginTop: 40 }} />
        <button className="linear-btn" onClick={onBegin} autoFocus>
          Begin <span className="arrow">→</span>
        </button>
      </div>

      <footer className="stage-footer">
        <span>Mental fitness infrastructure</span>
        <span>Take 01</span>
      </footer>
    </section>
  );
}
