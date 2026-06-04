import { NextResponse } from "next/server";
import { del, issueSignedToken, presignUrl } from "@vercel/blob";
import { sql, type Session } from "@/lib/db";
import {
  resend,
  FROM,
  deliverySubject,
  deliveryHtml,
  deliveryText,
  type TakeAudioUrl,
} from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel Blob caps signed-token validity at 7 days, so the listen window
// (and the post-delivery blob retention) must stay within that.
const LISTEN_WINDOW_DAYS = 7;

/**
 * Daily cron — two phases:
 *   1. Deliver: rows whose deliver_at has arrived. Mint a signed URL valid
 *      for LISTEN_WINDOW_DAYS, send the email, mark delivered_at.
 *   2. Cleanup: rows whose delivered_at is older than LISTEN_WINDOW_DAYS.
 *      Delete the blob and null out the pathname so we don't try again.
 *
 * Recordings are private throughout — the only readable link is the signed
 * URL the recipient receives in their email, and it expires.
 */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const sent: Array<{ id: string; status: "sent" | "failed"; error?: string }> = [];
  const deleted: Array<{ id: string; status: "deleted" | "failed"; error?: string }> = [];

  // ---------------- Phase 1: Deliver ----------------
  const due = await sql<Session[]>`
    select * from sessions
    where delivered_at is null
      and deliver_at <= now()
      and audio_pathname is not null
    order by deliver_at asc
    limit 100
  `;

  for (const row of due) {
    try {
      if (!row.audio_pathname) throw new Error("missing audio_pathname");

      const validUntil = Date.now() + LISTEN_WINDOW_DAYS * 86400_000;

      const presignedUrl = await mintSignedGet(row.audio_pathname, validUntil);

      // Re-sign brain assets at send time. URLs minted during /api/analyze
      // only live 24h (Confirmation scope); the listen window needs fresh
      // signatures. Two assets: the peak-frame PNG (shown in email) and
      // the activation tensor binary (if present; email doesn't currently
      // render the cortex viewer, but re-signing keeps the data live for
      // a future deep-link / replay flow).
      const signals = row.signal_data;
      const brainPathname = signals?.brain_map?.image_pathname;
      if (brainPathname) {
        signals.brain_map!.image_url = await mintSignedGet(brainPathname, validUntil);
      }
      const activationsPathname = signals?.brain_map?.activations_pathname;
      if (activationsPathname) {
        signals.brain_map!.activations_url = await mintSignedGet(activationsPathname, validUntil);
      }

      // Re-sign per-take audio if this session was recorded under the new
      // schema (one Blob file per question). Legacy rows have signals.takes
      // missing/empty — the email falls back to the single `audioUrl` above.
      let takeUrls: TakeAudioUrl[] | null = null;
      if (signals?.takes && signals.takes.length > 0) {
        takeUrls = await Promise.all(
          signals.takes.map(async (t) => ({
            question_index: t.question_index,
            url: await mintSignedGet(t.pathname, validUntil),
            duration_seconds: t.duration_seconds,
          }))
        );
      }

      const html = deliveryHtml({
        to: row.email,
        firstName: row.first_name,
        prompt: row.prompt,
        audioUrl: presignedUrl,
        takeUrls,
        recordedAt: new Date(row.recorded_at),
        eventName: row.event_name,
        signals,
      });
      const text = deliveryText({
        to: row.email,
        firstName: row.first_name,
        prompt: row.prompt,
        audioUrl: presignedUrl,
        takeUrls,
        recordedAt: new Date(row.recorded_at),
        eventName: row.event_name,
        signals,
      });

      const send = await resend.emails.send({
        from: FROM,
        to: row.email,
        subject: deliverySubject(),
        html,
        text,
      });

      if (send.error) throw new Error(send.error.message || "resend error");

      await sql`
        update sessions
        set delivered_at = now()
        where id = ${row.id}
      `;

      sent.push({ id: row.id, status: "sent" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("delivery failed", row.id, message);
      sent.push({ id: row.id, status: "failed", error: message });
    }
  }

  // ---------------- Phase 2: Cleanup ----------------
  // Delete blobs for sessions delivered more than LISTEN_WINDOW_DAYS ago.
  // Per session: legacy audio_pathname + every per-take pathname + brain
  // image + brain activations. We pull signal_data so we know all of them.
  const expired = await sql<Pick<Session, "id" | "audio_pathname" | "signal_data">[]>`
    select id, audio_pathname, signal_data from sessions
    where audio_pathname is not null
      and delivered_at is not null
      and delivered_at <= now() - interval '${sql.unsafe(String(LISTEN_WINDOW_DAYS))} days'
    limit 200
  `;

  for (const row of expired) {
    try {
      const toDelete: string[] = [];
      if (row.audio_pathname) toDelete.push(row.audio_pathname);
      const takes = row.signal_data?.takes ?? [];
      for (const t of takes) {
        // Don't double-delete if audio_pathname happens to equal the first
        // take's pathname (which is the case for new sessions).
        if (t.pathname && !toDelete.includes(t.pathname)) toDelete.push(t.pathname);
      }
      const brainImage = row.signal_data?.brain_map?.image_pathname;
      if (brainImage) toDelete.push(brainImage);
      const brainActivations = row.signal_data?.brain_map?.activations_pathname;
      if (brainActivations) toDelete.push(brainActivations);

      if (toDelete.length === 0) continue;

      // @vercel/blob's del() accepts an array — single round-trip.
      await del(toDelete);
      await sql`
        update sessions
        set audio_pathname = null, audio_url = ''
        where id = ${row.id}
      `;
      deleted.push({ id: row.id, status: "deleted" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("cleanup failed", row.id, message);
      deleted.push({ id: row.id, status: "failed", error: message });
    }
  }

  return NextResponse.json({
    ok: true,
    delivered: sent.filter((r) => r.status === "sent").length,
    deliveryFailed: sent.filter((r) => r.status === "failed").length,
    cleaned: deleted.filter((r) => r.status === "deleted").length,
    cleanupFailed: deleted.filter((r) => r.status === "failed").length,
    sent,
    deleted,
  });
}

/**
 * Mint a Vercel Blob signed GET URL valid until `validUntil` (epoch ms).
 * Used for audio, brain images, and activation tensors at email-send time.
 */
async function mintSignedGet(pathname: string, validUntil: number): Promise<string> {
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(
    {
      clientSigningToken: token.clientSigningToken,
      delegationToken: token.delegationToken,
    },
    {
      operation: "get",
      pathname,
      access: "private",
    }
  );
  return presignedUrl;
}
