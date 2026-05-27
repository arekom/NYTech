"use client";

import Logo from "@/components/Logo";

type Props = {
  firstName: string;
  deliverAt: Date;
  onDone: () => void;
};

export default function Confirmation({ firstName, deliverAt, onDone }: Props) {
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
        <span className="eyebrow">Your message has been saved</span>
        <hr className="rule" />

        <h1 className="headline">
          {firstName}, your future self<br />
          will receive this on<br />
          <em>{dateLabel}</em>
        </h1>

        <p className="subtext">Check your inbox then.</p>

        <hr className="rule" style={{ marginTop: 40 }} />

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

function formatDeliveryDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
