import postgres from "postgres";
import type { SignalData } from "@/lib/signals";

if (!process.env.POSTGRES_URL) {
  throw new Error("POSTGRES_URL is not set");
}

export const sql = postgres(process.env.POSTGRES_URL, {
  ssl: "require",
  prepare: false,
});

export type Session = {
  id: string;
  first_name: string;
  email: string;
  focus: string;
  prompt: string;
  audio_url: string;
  audio_pathname: string | null;
  duration_seconds: number;
  event_name: string | null;
  transcript: string | null;
  signal_data: SignalData | null;
  recorded_at: Date;
  deliver_at: Date;
  delivered_at: Date | null;
};
