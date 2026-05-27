import postgres from "postgres";

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
  recorded_at: Date;
  deliver_at: Date;
  delivered_at: Date | null;
};
