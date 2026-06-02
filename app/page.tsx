"use client";

import { useCallback, useState } from "react";
import Welcome from "@/components/screens/Welcome";
import Intake from "@/components/screens/Intake";
import Prompt from "@/components/screens/Prompt";
import Recording from "@/components/screens/Recording";
import BetweenQuestions from "@/components/screens/BetweenQuestions";
import Processing from "@/components/screens/Processing";
import Confirmation from "@/components/screens/Confirmation";
import { QUESTIONS, TOTAL_QUESTIONS } from "@/lib/prompts";
import type { RegisterData } from "@/lib/pitch";
import type { SignalData } from "@/lib/signals";

export type Screen =
  | "welcome"
  | "intake"
  | "prompt"
  | "recording"
  | "between"
  | "processing"
  | "confirmation";

/** One audio take, captured for one question. */
export type Take = {
  questionIndex: number; // 1..5
  audioBlob: Blob;
  durationSeconds: number;
  register: RegisterData;
};

export type SessionState = {
  firstName: string;
  email: string;
  focus: string;
  takes: Take[];
  /** Which question we're currently on (1..5). Drives the Recording screen. */
  currentQuestionIdx: number;
  signals: SignalData | null;
  deliverAt: Date | null;
};

const EMPTY: SessionState = {
  firstName: "",
  email: "",
  focus: "",
  takes: [],
  currentQuestionIdx: 1,
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

  // After a take is recorded: append it, then either advance to the next
  // question via the between-screen, or jump to processing if this was Q5.
  const handleTakeComplete = useCallback(
    (blob: Blob, duration: number, register: RegisterData) => {
      setSession((prev) => {
        const take: Take = {
          questionIndex: prev.currentQuestionIdx,
          audioBlob: blob,
          durationSeconds: duration,
          register,
        };
        return { ...prev, takes: [...prev.takes, take] };
      });
      // Read fresh from state when deciding next screen
      setSession((prev) => {
        if (prev.currentQuestionIdx >= TOTAL_QUESTIONS) {
          setScreen("processing");
        } else {
          setScreen("between");
        }
        return prev;
      });
    },
    []
  );

  const currentQuestion =
    QUESTIONS.find((q) => q.index === session.currentQuestionIdx) ?? QUESTIONS[0];

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
          question={currentQuestion}
          onComplete={handleTakeComplete}
        />
      )}
      {screen === "between" && (
        <BetweenQuestions
          completedIdx={session.currentQuestionIdx}
          nextQuestion={
            QUESTIONS.find((q) => q.index === session.currentQuestionIdx + 1) ??
            QUESTIONS[0]
          }
          onContinue={() => {
            update({ currentQuestionIdx: session.currentQuestionIdx + 1 });
            setScreen("recording");
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
          takes={session.takes}
          onDone={reset}
        />
      )}
    </main>
  );
}
