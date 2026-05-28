import { Resend } from "resend";
import type { SignalData } from "@/lib/signals";

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
  signals: SignalData | null;
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
  signals,
}: DeliveryPayload) {
  const dateStr = recordedAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const context = eventName ? `${dateStr} — ${eventName}` : dateStr;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://spaceofmind.app";

  const signalsBlock = signals ? signalsHtml(signals) : "";

  // Space of Mind brand palette
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
          </td></tr>

          ${signalsBlock}

          <tr><td style="border-top:1px solid #E3E3FF;padding-top:24px;">
            <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5;color:#1B1B2F;">
              In 10 days, you&rsquo;ll meet future you to help you close the gap.
            </div>
          </td></tr>

          <tr><td style="padding-top:32px;">
            <a href="${appUrl}" style="display:inline-block;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:14px;letter-spacing:0.02em;color:#FFFFFF;background:#1B1B2F;text-decoration:none;border-radius:999px;padding:16px 28px;">
              Finish &rarr;
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

function signalsHtml(s: SignalData): string {
  return `
    <tr><td style="padding:24px 0 0;">
      <div style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#5F6264;padding-bottom:14px;">
        What we listened for
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${signalRowHtml("Certainty", s.certainty.summary, `${s.certainty.hedge_count} hedges · ${s.certainty.certainty_count} certainty markers`)}
        ${signalRowHtml("Tempo",     s.tempo.summary,     `${s.tempo.pause_count} pauses · ${s.tempo.speech_rate_wpm} wpm`)}
        ${signalRowHtml("Register",  s.register.summary,  `${Math.round(s.register.avg_hz)} Hz avg · ${s.register.drop_count} drop${s.register.drop_count === 1 ? "" : "s"}, ${s.register.rise_count} rise${s.register.rise_count === 1 ? "" : "s"}`)}
        ${signalRowHtml("Ownership", s.ownership.summary, `${s.ownership.first_person_count} first-person · ${s.ownership.passive_count} passive · ${s.ownership.third_person_count} third-person`)}
      </table>
    </td></tr>
  `;
}

function signalRowHtml(label: string, body: string, footnote: string): string {
  return `
    <tr>
      <td style="vertical-align:top;padding:12px 16px 12px 0;width:110px;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#5F6264;border-top:1px solid #E3E3FF;">${escapeHtml(label)}</td>
      <td style="vertical-align:top;padding:12px 0;border-top:1px solid #E3E3FF;">
        <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:16px;line-height:1.4;color:#1B1B2F;">${escapeHtml(body)}</div>
        <div style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.14em;color:#5F6264;padding-top:6px;">${escapeHtml(footnote)}</div>
      </td>
    </tr>
  `;
}

export function deliveryText({
  firstName,
  prompt,
  audioUrl,
  recordedAt,
  eventName,
  signals,
}: DeliveryPayload) {
  const dateStr = recordedAt.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  const context = eventName ? `${dateStr} — ${eventName}` : dateStr;
  const lines: string[] = [
    `Space of Mind · Future Self Studio · ${context}`,
    "",
    `${firstName}, she's been waiting.`,
    "",
    "The question you answered:",
    prompt,
    "",
    `Your recording: ${audioUrl}`,
    "",
  ];

  if (signals) {
    lines.push("What we listened for:");
    lines.push("");
    lines.push(`  CERTAINTY · ${signals.certainty.summary}`);
    lines.push(`    ${signals.certainty.hedge_count} hedges · ${signals.certainty.certainty_count} certainty markers`);
    lines.push("");
    lines.push(`  TEMPO · ${signals.tempo.summary}`);
    lines.push(`    ${signals.tempo.pause_count} pauses · ${signals.tempo.speech_rate_wpm} wpm`);
    lines.push("");
    lines.push(`  REGISTER · ${signals.register.summary}`);
    lines.push(`    ${Math.round(signals.register.avg_hz)} Hz avg · ${signals.register.drop_count} drops, ${signals.register.rise_count} rises`);
    lines.push("");
    lines.push(`  OWNERSHIP · ${signals.ownership.summary}`);
    lines.push(`    ${signals.ownership.first_person_count} first-person · ${signals.ownership.passive_count} passive · ${signals.ownership.third_person_count} third-person`);
    lines.push("");
  }

  lines.push("In 10 days, you'll meet future you to help you close the gap.");
  lines.push("");
  lines.push(`Finish → ${process.env.NEXT_PUBLIC_APP_URL || "https://spaceofmind.app"}`);
  lines.push("");
  lines.push("— Space of Mind");
  return lines.join("\n");
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
