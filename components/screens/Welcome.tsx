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
        <span className="eyebrow">Your future self is listening</span>
        <h1 className="headline" style={{ marginTop: 28 }}>
          Speak to the version of you<br />
          who already <em>made it</em>.
        </h1>
        <p className="subtext">
          One take. One question.<br />
          Ten days from now, you&rsquo;ll hear it back.
        </p>
        <button className="linear-btn" style={{ marginTop: 40 }} onClick={onBegin} autoFocus>
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
