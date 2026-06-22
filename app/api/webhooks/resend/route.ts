import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { sql, type DeliveryStatus } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Resend webhook receiver. Resend (via Svix) POSTs message lifecycle events
 * here; we correlate each to a session by `data.email_id` (stored as
 * `resend_email_id` at send time in /api/cron/deliver) and advance
 * `delivery_status` to reflect what actually happened to the message.
 *
 * Why this exists: `delivered_at` only means "Resend accepted the send". It
 * does NOT mean the email reached an inbox — it can still bounce or be marked
 * spam. This handler is the only place the DB learns the real outcome.
 *
 * Setup: in the Resend dashboard add a webhook pointing at
 *   https://<deployment>/api/webhooks/resend
 * subscribed to the email.* events, and put its signing secret in
 * RESEND_WEBHOOK_SECRET (format: "whsec_…").
 *
 * Signature verification uses the Svix scheme (HMAC-SHA256 over
 * "<id>.<timestamp>.<body>") so we don't pull in the svix dependency.
 */

const STATUS_BY_EVENT: Record<string, DeliveryStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

// Replay window for the svix timestamp, in seconds.
const TOLERANCE_SECONDS = 5 * 60;

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; to?: string[] | string };
};

export async function POST(req: Request) {
  // Raw body is required for signature verification — must not be re-parsed.
  const payload = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const verified = verifySvixSignature(req, payload, secret);
    if (!verified) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Refuse to accept unverified webhooks in production.
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  } else {
    console.warn("[resend-webhook] no RESEND_WEBHOOK_SECRET — skipping verification (dev)");
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(payload) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const status = event.type ? STATUS_BY_EVENT[event.type] : undefined;
  const emailId = event.data?.email_id;

  // Unknown/engagement event (opened, clicked, …) or no id to correlate —
  // acknowledge so Resend doesn't retry, but don't touch the DB.
  if (!status || !emailId) {
    return NextResponse.json({ ok: true, ignored: event.type ?? "unknown" });
  }

  // Advance the row, but never downgrade a terminal negative outcome (a late
  // 'delivered' must not clobber a 'bounced'/'complained'/'failed').
  const updated = await sql`
    update sessions
    set delivery_status = ${status}, delivery_updated_at = now()
    where resend_email_id = ${emailId}
      and (delivery_status is null
           or delivery_status not in ('bounced', 'complained', 'failed'))
    returning id
  `;

  if (updated.length === 0) {
    // Either no matching row, or we deliberately skipped a downgrade. Either
    // way the event was handled — return 200 so Resend stops retrying.
    console.warn(
      `[resend-webhook] ${event.type} for ${emailId} matched no updatable row`
    );
  }

  return NextResponse.json({ ok: true, status, matched: updated.length });
}

/**
 * Verify a Svix-signed webhook (the scheme Resend uses). The signing secret is
 * "whsec_<base64>"; the signature header is a space-separated list of
 * "v1,<base64sig>" entries — any one matching is sufficient.
 */
function verifySvixSignature(req: Request, payload: string, secret: string): boolean {
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject stale/replayed timestamps.
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expected = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  // Header: "v1,sig1 v2,sig2 …" — compare the signature portion of each.
  return svixSignature.split(" ").some((part) => {
    const sig = part.split(",")[1];
    if (!sig) return false;
    const sigBuf = Buffer.from(sig);
    return (
      sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)
    );
  });
}
