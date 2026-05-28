"use client";

import Logo from "@/components/Logo";
import type { SignalData } from "@/lib/signals";

type Props = {
  firstName: string;
  deliverAt: Date;
  signals: SignalData | null;
  onDone: () => void;
};

export default function Confirmation({ firstName, deliverAt, signals, onDone }: Props) {
  const dateLabel = formatDeliveryDate(deliverAt);

  return (
    <section className="stage fade-in">
      <header className="stage-header">
        <span className="brand-lockup">
          <Logo height={26} />
        </span>
        <span className="meta">Take complete</span>
      </header>

      <div className="stage-body">
        <span className="eyebrow">Here&rsquo;s what we heard</span>
        <hr className="rule" />

        {signals ? (
          <ul className="signal-readout" aria-label="Signal readout">
            <SignalLine label="Certainty" body={signals.certainty.summary} />
            <SignalLine label="Tempo"     body={signals.tempo.summary} />
            <SignalLine label="Register"  body={signals.register.summary} />
            <SignalLine label="Ownership" body={signals.ownership.summary} />
          </ul>
        ) : (
          <p className="subtext">
            We held your take. The full readout will arrive with your email.
          </p>
        )}

        <hr className="rule" style={{ marginTop: 32 }} />

        <p className="delivery-label">
          {firstName}, your future self will receive this on
        </p>
        <p className="delivery-date">
          <em>{dateLabel}</em>
        </p>

        <p className="brand-line">
          <strong>She&rsquo;s already there.</strong> You&rsquo;re on your way.
        </p>

        <div style={{ marginTop: 40 }}>
          <button className="linear-btn" onClick={onDone} autoFocus>
            Done <span className="arrow">→</span>
          </button>
        </div>
      </div>

      <footer className="stage-footer">
        <span>Recording sealed</span>
        <span>Delivery {dateLabel}</span>
      </footer>
    </section>
  );
}

function SignalLine({ label, body }: { label: string; body: string }) {
  return (
    <li className="signal-line">
      <span className="signal-label">{label}</span>
      <span className="signal-body">{body}</span>
    </li>
  );
}

function formatDeliveryDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
