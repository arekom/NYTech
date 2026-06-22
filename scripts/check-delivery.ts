/**
 * Check the delivery status of emails that have already been sent.
 *
 * For each session row with `delivered_at` set (i.e. handed to Resend), this
 * prints what our DB thinks (`delivery_status`, updated by the webhook) AND
 * the live status from Resend's API (`last_event`) so you can see the real
 * outcome even before/without webhook events.
 *
 *   npm run emails:status
 *
 * Rows sent BEFORE delivery tracking shipped have no `resend_email_id`, so we
 * can't look them up by id — those show "(no id)" and you'll need the Resend
 * dashboard for their status.
 */
import postgres from "postgres";

const RESEND_API = "https://api.resend.com/emails";

type Row = {
  id: string;
  email: string;
  delivered_at: Date | null;
  resend_email_id: string | null;
  delivery_status: string | null;
  delivery_updated_at: Date | null;
};

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is not set");
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) console.warn("RESEND_API_KEY not set — live Resend status will be skipped.\n");

  const sql = postgres(url, { ssl: "require", prepare: false });

  const rows = await sql<Row[]>`
    select id, email, delivered_at, resend_email_id, delivery_status, delivery_updated_at
    from sessions
    where delivered_at is not null
    order by delivered_at desc
  `;

  if (rows.length === 0) {
    console.log("No emails have been sent yet (every row's delivered_at is null).");
    await sql.end();
    return;
  }

  console.log(`${rows.length} email(s) handed to Resend:\n`);
  const tally: Record<string, number> = {};

  for (const r of rows) {
    let live = "—";
    if (apiKey && r.resend_email_id) {
      try {
        const res = await fetch(`${RESEND_API}/${r.resend_email_id}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { last_event?: string };
          live = data.last_event ?? "(unknown)";
        } else {
          live = `(resend ${res.status})`;
        }
      } catch {
        live = "(fetch failed)";
      }
    } else if (!r.resend_email_id) {
      live = "(no id)";
    }

    tally[live] = (tally[live] ?? 0) + 1;
    const sentAt =
      r.delivered_at instanceof Date ? r.delivered_at.toISOString() : String(r.delivered_at);
    console.log(
      [
        r.email.padEnd(30),
        `db:${(r.delivery_status ?? "—").padEnd(16)}`,
        `resend:${live.padEnd(18)}`,
        `sent:${sentAt}`,
      ].join("  ")
    );
  }

  console.log("\nResend status tally:");
  for (const [status, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(20)} ${count}`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
