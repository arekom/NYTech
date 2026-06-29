import { NextResponse } from "next/server";
import { issueSignedToken, presignUrl } from "@vercel/blob";
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
 * Daily cron — single phase:
 *   1. Deliver: rows whose deliver_at has arrived. Mint a signed URL valid
 *      for LISTEN_WINDOW_DAYS, send the email, mark delivered_at.
 *
 * Recordings + brain assets are retained INDEFINITELY (Phase 2 cleanup
 * intentionally disabled). The email signed URL still expires after
 * LISTEN_WINDOW_DAYS — the data persists in Blob storage, but recipients
 * lose access via the original link. To restore later access we'd need a
 * re-signing endpoint that takes a session id + auth and returns fresh
 * URLs from the stored pathnames.
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

      // Store Resend's message id so the webhook can correlate later delivery/
      // bounce/complaint events back to this row. delivery_status starts at
      // 'sent' (accepted by Resend) and is advanced by /api/webhooks/resend.
      const resendEmailId = send.data?.id ?? null;
      await sql`
        update sessions
        set delivered_at = now(),
            resend_email_id = ${resendEmailId},
            delivery_status = 'sent',
            delivery_updated_at = now()
        where id = ${row.id}
      `;

      sent.push({ id: row.id, status: "sent" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("delivery failed", row.id, message);
      sent.push({ id: row.id, status: "failed", error: message });
    }
  }

  return NextResponse.json({
    ok: true,
    delivered: sent.filter((r) => r.status === "sent").length,
    deliveryFailed: sent.filter((r) => r.status === "failed").length,
    sent,
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
