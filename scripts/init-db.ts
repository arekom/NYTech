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
      delivered_at timestamptz
    )
  `;

  // Migrate existing schema if upgrading
  await sql`alter table sessions add column if not exists audio_pathname text`;
  await sql`alter table sessions add column if not exists transcript text`;
  await sql`alter table sessions add column if not exists signal_data jsonb`;

  await sql`create index if not exists sessions_deliver_at_idx on sessions (deliver_at) where delivered_at is null`;
  await sql`create index if not exists sessions_cleanup_idx on sessions (delivered_at) where audio_pathname is not null`;

  console.log("sessions table ready");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
