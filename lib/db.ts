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
  /** Set when the email was successfully handed to Resend (dedup marker —
   *  the cron won't re-send a row whose delivered_at is non-null). This is
   *  NOT proof of inbox delivery; see delivery_status for that. */
  delivered_at: Date | null;
  /** Resend's message id, captured at send time so webhook events can be
   *  correlated back to this row. */
  resend_email_id: string | null;
  /** Actual delivery lifecycle, updated by the Resend webhook:
   *  'sent' | 'delivered' | 'delivery_delayed' | 'bounced' | 'complained' | 'failed' */
  delivery_status: DeliveryStatus | null;
  /** When delivery_status last changed. */
  delivery_updated_at: Date | null;
};

export type DeliveryStatus =
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "bounced"
  | "complained"
  | "failed";
