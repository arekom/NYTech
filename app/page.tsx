"use client";

import { useCallback, useState } from "react";
import Welcome from "@/components/screens/Welcome";
import Intake from "@/components/screens/Intake";
import Prompt from "@/components/screens/Prompt";
import Recording from "@/components/screens/Recording";
import Processing from "@/components/screens/Processing";
import Confirmation from "@/components/screens/Confirmation";

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
  deliverAt: Date | null;
};

const EMPTY: SessionState = {
  firstName: "",
  email: "",
  focus: "",
  audioBlob: null,
  durationSeconds: 0,
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
          onComplete={(blob, duration) => {
            update({ audioBlob: blob, durationSeconds: duration });
            setScreen("processing");
          }}
        />
      )}
      {screen === "processing" && (
        <Processing
          session={session}
          onComplete={(deliverAt) => {
            update({ deliverAt });
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
          onDone={reset}
        />
      )}
    </main>
  );
}
