import { Resend } from "resend";

if (!process.env.RESEND_API_KEY) {
  // Don't throw at import time in case the app is starting without email yet
  console.warn("RESEND_API_KEY is not set");
}

export const resend = new Resend(process.env.RESEND_API_KEY || "");

export const FROM = process.env.RESEND_FROM || "Space of Mind <studio@spaceofmind.app>";

export type DeliveryPayload = {
  to: string;
  firstName: string;
  prompt: string;
  audioUrl: string;
  recordedAt: Date;
  eventName: string | null;
};

export function deliverySubject() {
  return "She's been waiting. Here's what you told her.";
}

export function deliveryHtml({
  firstName,
  prompt,
  audioUrl,
  recordedAt,
  eventName,
}: DeliveryPayload) {
  const dateStr = recordedAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const context = eventName ? `${dateStr} — ${eventName}` : dateStr;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://spaceofmind.app";

  // Space of Mind brand palette
  //   Core Dark      #1B1B2F (Quiet Lavender 100, primary ink)
  //   Quiet Lavender #B4B4DB (primary accent)
  //   Lavender Mist  #F7F7FF (background)
  //   Calm Grey      #D8DCDE (rule color)
  //   Grey Deep      #5F6264 (secondary ink)
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>From your future self</title>
  </head>
  <body style="margin:0;padding:0;background:#F7F7FF;color:#1B1B2F;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F7FF;padding:48px 24px;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E3E3FF;border-radius:24px;padding:40px;">

          <tr><td style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#5F6264;padding-bottom:24px;">
            Space of Mind · Future Self Studio · ${context}
          </td></tr>

          <tr><td style="border-top:1px solid #E3E3FF;padding-top:24px;">
            <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:28px;line-height:1.25;letter-spacing:-0.01em;color:#1B1B2F;">
              ${escapeHtml(firstName)}, she&rsquo;s been waiting.
            </div>
          </td></tr>

          <tr><td style="padding:24px 0 12px;">
            <div style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#5F6264;padding-bottom:8px;">
              The question you answered
            </div>
            <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;line-height:1.45;color:#1B1B2F;">
              ${escapeHtml(prompt)}
            </div>
          </td></tr>

          <tr><td style="padding:24px 0;">
            <audio controls src="${audioUrl}" style="width:100%;"></audio>
            <div style="padding-top:14px;">
              <a href="${audioUrl}" style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#1B1B2F;text-decoration:none;border-bottom:1px solid #B4B4DB;padding-bottom:4px;">
                Download recording →
              </a>
            </div>
          </td></tr>

          <tr><td style="border-top:1px solid #E3E3FF;padding-top:24px;">
            <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5;color:#1B1B2F;">
              You said this when you were in the middle of it.<br>
              Listen to who you were becoming.
            </div>
          </td></tr>

          <tr><td style="padding-top:32px;">
            <a href="${appUrl}" style="display:inline-block;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:14px;letter-spacing:0.02em;color:#FFFFFF;background:#1B1B2F;text-decoration:none;border-radius:999px;padding:16px 28px;">
              Start your 90-day protocol →
            </a>
          </td></tr>

          <tr><td style="padding-top:48px;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#5F6264;">
            Space of Mind · Mental fitness infrastructure
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function deliveryText({
  firstName,
  prompt,
  audioUrl,
  recordedAt,
  eventName,
}: DeliveryPayload) {
  const dateStr = recordedAt.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  const context = eventName ? `${dateStr} — ${eventName}` : dateStr;
  return [
    `Future Self Studio · ${context}`,
    "",
    `${firstName}, she's been waiting.`,
    "",
    "The question you answered:",
    prompt,
    "",
    `Your recording: ${audioUrl}`,
    "",
    "You said this when you were in the middle of it.",
    "Listen to who you were becoming.",
    "",
    "Ready to close the gap faster?",
    `Start your 90-day protocol: ${process.env.NEXT_PUBLIC_APP_URL || "https://spaceofmind.app"}`,
    "",
    "— Space of Mind",
  ].join("\n");
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
