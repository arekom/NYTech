"use client";

import { useCallback, useState } from "react";
import Welcome from "@/components/screens/Welcome";
import Intake from "@/components/screens/Intake";
import Prompt from "@/components/screens/Prompt";
import Recording from "@/components/screens/Recording";
import Processing from "@/components/screens/Processing";
import Confirmation from "@/components/screens/Confirmation";
import type { RegisterData } from "@/lib/pitch";
import type { SignalData } from "@/lib/signals";

export type Screen =
  | "welcome"
  | "intake"
  | "prompt"
  | "recording"
  | "processing"
  | "confirmation";

export type SessionState = {
  firstName: string;
  email: string;
  focus: string;
  audioBlob: Blob | null;
  durationSeconds: number;
  /** Client-captured pitch samples + summary, computed during recording. */
  register: RegisterData | null;
  /** Full four-signal analysis result, populated after Processing succeeds. */
  signals: SignalData | null;
  deliverAt: Date | null;
};

const EMPTY: SessionState = {
  firstName: "",
  email: "",
  focus: "",
  audioBlob: null,
  durationSeconds: 0,
  register: null,
  signals: null,
  deliverAt: null,
};

export default function Page() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [session, setSession] = useState<SessionState>(EMPTY);

  const reset = useCallback(() => {
    setSession(EMPTY);
    setScreen("welcome");
  }, []);

  const update = useCallback((partial: Partial<SessionState>) => {
    setSession((prev) => ({ ...prev, ...partial }));
  }, []);

  return (
    <main>
      {screen === "welcome" && <Welcome onBegin={() => setScreen("intake")} />}
      {screen === "intake" && (
        <Intake
          initial={{ firstName: session.firstName, email: session.email, focus: session.focus }}
          onContinue={(data) => {
            update(data);
            setScreen("prompt");
          }}
        />
      )}
      {screen === "prompt" && (
        <Prompt firstName={session.firstName} onReady={() => setScreen("recording")} />
      )}
      {screen === "recording" && (
        <Recording
          firstName={session.firstName}
          onComplete={(blob, duration, register) => {
            update({ audioBlob: blob, durationSeconds: duration, register });
            setScreen("processing");
          }}
        />
      )}
      {screen === "processing" && (
        <Processing
          session={session}
          onComplete={(deliverAt, signals) => {
            update({ deliverAt, signals });
            setScreen("confirmation");
          }}
          onError={() => {
            // stay on processing until reconnection succeeds; handled inside
          }}
        />
      )}
      {screen === "confirmation" && session.deliverAt && (
        <Confirmation
          firstName={session.firstName}
          deliverAt={session.deliverAt}
          signals={session.signals}
          onDone={reset}
        />
      )}
    </main>
  );
}
