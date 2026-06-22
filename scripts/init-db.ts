import postgres from "postgres";

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is not set");

  const sql = postgres(url, { ssl: "require", prepare: false });

  await sql`
    create table if not exists sessions (
      id uuid primary key default gen_random_uuid(),
      first_name text not null,
      email text not null,
      focus text not null,
      prompt text not null,
      audio_url text not null,
      audio_pathname text,
      duration_seconds integer not null,
      event_name text,
      transcript text,
      signal_data jsonb,
      recorded_at timestamptz not null default now(),
      deliver_at timestamptz not null,
      delivered_at timestamptz,
      -- Resend correlation + real delivery lifecycle (updated by the webhook).
      -- delivered_at means "handed to Resend successfully" (won't re-send);
      -- delivery_status reflects what actually happened to the message.
      resend_email_id text,
      delivery_status text,
      delivery_updated_at timestamptz
    )
  `;

  // Migrate existing schema if upgrading
  await sql`alter table sessions add column if not exists audio_pathname text`;
  await sql`alter table sessions add column if not exists transcript text`;
  await sql`alter table sessions add column if not exists signal_data jsonb`;
  await sql`alter table sessions add column if not exists resend_email_id text`;
  await sql`alter table sessions add column if not exists delivery_status text`;
  await sql`alter table sessions add column if not exists delivery_updated_at timestamptz`;

  await sql`create index if not exists sessions_deliver_at_idx on sessions (deliver_at) where delivered_at is null`;
  await sql`create index if not exists sessions_cleanup_idx on sessions (delivered_at) where audio_pathname is not null`;
  // Webhook events correlate back to a session by the Resend email id.
  await sql`create index if not exists sessions_resend_email_id_idx on sessions (resend_email_id)`;

  console.log("sessions table ready");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
