import { Resend } from "resend";
import type { SignalData } from "@/lib/signals";
import { LIMITING_BELIEF_LABELS, PATTERN_LABELS } from "@/lib/signals";

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

/**
 * Parse the `prompt` column out of the sessions row. New rows store the
 * five-question list as JSON; legacy rows (pre-multi-question refactor)
 * store a single plain-text prompt. Return a normalized array either way.
 */
function parsePrompt(prompt: string): { index: number; text: string }[] {
  const trimmed = prompt.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((q) => typeof q?.text === "string")) {
        return parsed.map((q, i) => ({
          index: typeof q.index === "number" ? q.index : i + 1,
          text: q.text,
        }));
      }
    } catch {
      // fall through to legacy single-prompt path
    }
  }
  return [{ index: 1, text: trimmed }];
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
  const parsedQuestions = parsePrompt(prompt);

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
              ${parsedQuestions.length === 1 ? "The question you answered" : `The ${parsedQuestions.length} questions you answered`}
            </div>
            ${parsedQuestions.length === 1
              ? `<div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;line-height:1.45;color:#1B1B2F;">${escapeHtml(parsedQuestions[0].text)}</div>`
              : `<ol style="margin:0;padding-left:24px;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5;color:#1B1B2F;">${parsedQuestions
                  .map((q) => `<li style="padding:6px 0;">${escapeHtml(q.text)}</li>`)
                  .join("")}</ol>`}
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

function synthesisHtml(s: SignalData): string {
  if (!s.synthesis || s.synthesis.findings.length === 0) return "";
  const intro = s.synthesis.intro || "";
  const findings = s.synthesis.findings
    .map(
      (f, i) => `
      <tr><td style="padding:18px 0;border-top:1px solid #E3E3FF;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:top;width:32px;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:12px;color:#5F6264;padding-top:2px;">${i + 1}.</td>
            <td style="vertical-align:top;">
              <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:17px;line-height:1.35;letter-spacing:-0.005em;color:#1B1B2F;">${escapeHtml(f.headline)}</div>
              <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#5F6264;padding-top:6px;">${escapeHtml(f.body)}</div>
            </td>
          </tr>
        </table>
      </td></tr>`
    )
    .join("");

  return `
    <tr><td style="padding:24px 0 0;">
      ${sectionLabel("Your Result")}
      <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:22px;line-height:1.25;letter-spacing:-0.01em;color:#1B1B2F;padding-top:10px;">
        What this says about your beliefs &amp; habits
      </div>
      <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#5F6264;padding-top:8px;padding-bottom:10px;">
        ${escapeHtml(intro)}
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${findings}
      </table>
    </td></tr>
  `;
}

function signalsHtml(s: SignalData): string {
  const peakBlock = s.linguistic.peak_emotional_phrase
    ? `
    <tr><td style="padding:24px 0 0;">
      <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-style:italic;font-weight:400;font-size:22px;line-height:1.35;letter-spacing:-0.005em;color:#1B1B2F;text-align:center;">
        &ldquo;${escapeHtml(s.linguistic.peak_emotional_phrase)}&rdquo;
      </div>
    </td></tr>
  `
    : "";

  const themesBlock = s.linguistic.themes.length
    ? `
    <tr><td style="padding:16px 0 0;text-align:center;">
      ${s.linguistic.themes
        .map(
          (t) =>
            `<span style="display:inline-block;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#1B1B2F;background:#F0F0FF;border:1px solid rgba(27,27,47,0.12);border-radius:999px;padding:5px 10px;margin:3px 3px;">${escapeHtml(t)}</span>`
        )
        .join("")}
    </td></tr>
  `
    : "";

  const visionBlock = s.future_vision.summary
    ? `
    <tr><td style="padding:24px 0 0;">
      ${sectionLabel("What you said is coming")}
      <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:19px;line-height:1.45;letter-spacing:-0.005em;color:#1B1B2F;padding-top:10px;">
        ${escapeHtml(s.future_vision.summary)}
      </div>
    </td></tr>
  `
    : "";

  // Only render the brain block if we actually have a usable image AND at
  // least one decoded region. Belt-and-braces guard: a partial row with
  // brain_map populated but image_url empty (e.g. a render that crashed
  // mid-pipeline) would otherwise emit a broken <img> in the recipient's
  // inbox.
  const brainImageUrl = s.brain_map?.image_url || "";
  const brainBlock = s.brain_map && brainImageUrl && s.brain_map.top_regions.length
    ? `
    <tr><td style="padding:28px 0 0;">
      ${sectionLabel("Where the patterns lit up")}
      <img src="${brainImageUrl}" alt="Cortical activation map" style="display:block;width:100%;height:auto;margin-top:10px;border-radius:16px;border:1px solid #E3E3FF;background:#F7F7FF;" />
      <div style="margin-top:14px;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#5F6264;">
        ${s.brain_map.top_regions
          .slice(0, 4)
          .map(
            (r) =>
              `<div style="padding:4px 0;"><span style="font-weight:500;color:#1B1B2F;">${escapeHtml(r.scientific_name)}</span> &middot; <span style="font-style:italic;">${escapeHtml(r.short_function)}</span></div>`
          )
          .join("")}
      </div>
      <div style="margin-top:8px;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:9px;letter-spacing:0.16em;color:#5F6264;">
        TRIBE v2 cortical prediction &middot; research use only
      </div>
    </td></tr>
  `
    : "";

  const beliefsBlock = s.limiting_beliefs.length
    ? `
    <tr><td style="padding:28px 0 0;">
      ${sectionLabel("Beliefs running underneath")}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;padding-top:6px;">
        ${s.limiting_beliefs
          .map((b) =>
            patternRowHtml(
              LIMITING_BELIEF_LABELS[b.type],
              b.interpretation,
              "#1B1B2F"
            )
          )
          .join("")}
      </table>
    </td></tr>
  `
    : "";

  const unhelpful = s.thinking_patterns.filter((p) => p.pattern_type === "unhelpful");
  const helpful = s.thinking_patterns.filter((p) => p.pattern_type === "helpful");

  const unhelpfulBlock = unhelpful.length
    ? `
    <tr><td style="padding:28px 0 0;">
      ${sectionLabel("Patterns to notice")}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;padding-top:6px;">
        ${unhelpful
          .map((p) => patternRowHtml(PATTERN_LABELS[p.pattern], p.interpretation, "#1B1B2F"))
          .join("")}
      </table>
    </td></tr>
  `
    : "";

  // Helpful patterns get their own section with the section label doing the
  // "this is positive" lift — name color stays Core Dark so readability holds
  // on white. (Quiet Meadow is too light for body text.)
  const helpfulBlock = helpful.length
    ? `
    <tr><td style="padding:28px 0 0;">
      ${sectionLabel("What's working")}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;padding-top:6px;">
        ${helpful
          .map((p) => patternRowHtml(PATTERN_LABELS[p.pattern], p.interpretation))
          .join("")}
      </table>
    </td></tr>
  `
    : "";

  const repeatedBlock = s.linguistic.repeated_phrases.length
    ? `
    <tr><td style="padding:28px 0 0;">
      ${sectionLabel("Phrases you came back to")}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;padding-top:6px;">
        ${s.linguistic.repeated_phrases
          .map(
            (r) => `
          <tr>
            <td style="vertical-align:top;padding:10px 0;border-top:1px solid #E3E3FF;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-style:italic;font-size:14px;line-height:1.4;color:#1B1B2F;">&ldquo;${escapeHtml(r.phrase)}&rdquo;</td>
            <td style="vertical-align:top;padding:10px 0;border-top:1px solid #E3E3FF;width:80px;text-align:right;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.14em;color:#5F6264;">×${r.count}</td>
          </tr>`
          )
          .join("")}
      </table>
    </td></tr>
  `
    : "";

  const sentimentBlock = `
    <tr><td style="padding:28px 0 0;">
      ${sectionLabel("Where you're at")}
      <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:16px;line-height:1.5;color:#1B1B2F;padding-top:10px;">
        ${escapeHtml(s.sentiment.summary)}
      </div>
      <div style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.14em;color:#5F6264;padding-top:6px;">
        ${s.sentiment.overall_score}/100 · ${escapeHtml(s.sentiment.dominant_emotion)} · trajectory ${escapeHtml(s.sentiment.trajectory)}
      </div>
    </td></tr>
  `;

  return `
    ${synthesisHtml(s)}
    ${peakBlock}
    ${themesBlock}
    ${visionBlock}
    ${brainBlock}
    <tr><td style="padding:28px 0 0;">
      ${sectionLabel("What we listened for")}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;padding-top:6px;">
        ${signalRowHtml("Certainty", s.certainty.summary, `${s.certainty.hedge_count} hedges · ${s.certainty.certainty_count} certainty markers`)}
        ${signalRowHtml("Tempo",     s.tempo.summary,     `${s.tempo.pause_count} pauses · ${s.tempo.speech_rate_wpm} wpm`)}
        ${signalRowHtml("Register",  s.register.summary,  `${Math.round(s.register.avg_hz)} Hz avg · ${s.register.drop_count} drop${s.register.drop_count === 1 ? "" : "s"}, ${s.register.rise_count} rise${s.register.rise_count === 1 ? "" : "s"}`)}
        ${signalRowHtml("Ownership", s.ownership.summary, `${s.ownership.first_person_count} first-person · ${s.ownership.passive_count} passive · ${s.ownership.third_person_count} third-person`)}
      </table>
    </td></tr>
    ${beliefsBlock}
    ${unhelpfulBlock}
    ${helpfulBlock}
    ${repeatedBlock}
    ${sentimentBlock}
  `;
}

function sectionLabel(text: string): string {
  return `<div style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#5F6264;">${escapeHtml(text)}</div>`;
}

/**
 * Pattern row used for beliefs + thinking patterns. `nameColor` defaults to
 * Core Dark; pass Quiet Meadow `#CADAC8` for helpful patterns so the
 * "what's working" reflection reads visually distinct from unhelpful ones.
 */
function patternRowHtml(name: string, interpretation: string, nameColor = "#1B1B2F"): string {
  return `
    <tr>
      <td style="vertical-align:top;padding:12px 16px 12px 0;width:170px;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:14px;color:${nameColor};letter-spacing:-0.005em;border-top:1px solid #E3E3FF;">${escapeHtml(name)}</td>
      <td style="vertical-align:top;padding:12px 0;border-top:1px solid #E3E3FF;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#5F6264;">${escapeHtml(interpretation)}</td>
    </tr>
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
  const parsedQuestions = parsePrompt(prompt);
  const lines: string[] = [
    `Space of Mind · Future Self Studio · ${context}`,
    "",
    `${firstName}, she's been waiting.`,
    "",
    parsedQuestions.length === 1
      ? "The question you answered:"
      : `The ${parsedQuestions.length} questions you answered:`,
    ...parsedQuestions.map((q) =>
      parsedQuestions.length === 1 ? q.text : `  ${q.index}. ${q.text}`
    ),
    "",
    `Your recording: ${audioUrl}`,
    "",
  ];

  if (signals) {
    if (signals.synthesis && signals.synthesis.findings.length) {
      lines.push("YOUR RESULT — What this says about your beliefs & habits");
      lines.push("");
      if (signals.synthesis.intro) {
        lines.push(signals.synthesis.intro);
        lines.push("");
      }
      signals.synthesis.findings.forEach((f, i) => {
        lines.push(`${i + 1}. ${f.headline}`);
        lines.push(`   ${f.body}`);
        lines.push("");
      });
    }

    if (signals.linguistic.peak_emotional_phrase) {
      lines.push(`"${signals.linguistic.peak_emotional_phrase}"`);
      lines.push("");
    }

    if (signals.linguistic.themes.length) {
      lines.push(`Themes: ${signals.linguistic.themes.join(" · ")}`);
      lines.push("");
    }

    if (signals.future_vision.summary) {
      lines.push("What you said is coming:");
      lines.push(`  ${signals.future_vision.summary}`);
      lines.push("");
    }

    if (signals.brain_map && signals.brain_map.top_regions.length) {
      lines.push("Where the patterns lit up (TRIBE v2 cortical prediction):");
      for (const r of signals.brain_map.top_regions.slice(0, 4)) {
        lines.push(`  ${r.scientific_name} · ${r.short_function}`);
      }
      // Only print the image URL if we actually have one — otherwise the
      // recipient sees "Image: undefined" in their plaintext fallback.
      if (signals.brain_map.image_url) {
        lines.push(`  Image: ${signals.brain_map.image_url}`);
      }
      lines.push("");
    }

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

    if (signals.limiting_beliefs.length) {
      lines.push("Beliefs running underneath:");
      lines.push("");
      for (const b of signals.limiting_beliefs) {
        lines.push(`  ${LIMITING_BELIEF_LABELS[b.type].toUpperCase()}`);
        lines.push(`    ${b.interpretation}`);
        lines.push("");
      }
    }

    const unhelpful = signals.thinking_patterns.filter((p) => p.pattern_type === "unhelpful");
    if (unhelpful.length) {
      lines.push("Patterns to notice:");
      lines.push("");
      for (const p of unhelpful) {
        lines.push(`  ${PATTERN_LABELS[p.pattern].toUpperCase()}`);
        lines.push(`    ${p.interpretation}`);
        lines.push("");
      }
    }

    const helpful = signals.thinking_patterns.filter((p) => p.pattern_type === "helpful");
    if (helpful.length) {
      lines.push("What's working:");
      lines.push("");
      for (const p of helpful) {
        lines.push(`  ${PATTERN_LABELS[p.pattern].toUpperCase()}`);
        lines.push(`    ${p.interpretation}`);
        lines.push("");
      }
    }

    if (signals.linguistic.repeated_phrases.length) {
      lines.push("Phrases you came back to:");
      lines.push("");
      for (const r of signals.linguistic.repeated_phrases) {
        lines.push(`  "${r.phrase}" ×${r.count}`);
      }
      lines.push("");
    }

    lines.push("Where you're at:");
    lines.push(`  ${signals.sentiment.summary}`);
    lines.push(`  (${signals.sentiment.overall_score}/100 · ${signals.sentiment.dominant_emotion} · trajectory ${signals.sentiment.trajectory})`);
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
