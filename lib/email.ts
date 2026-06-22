import { Resend } from "resend";
import type { SignalData } from "@/lib/signals";
import { LIMITING_BELIEF_LABELS, PATTERN_LABELS } from "@/lib/signals";

if (!process.env.RESEND_API_KEY) {
  // Don't throw at import time in case the app is starting without email yet
  console.warn("RESEND_API_KEY is not set");
}

export const resend = new Resend(process.env.RESEND_API_KEY || "");

export const FROM = process.env.RESEND_FROM || "Karolina at Space of Mind <studio@spaceofmind.app>";

export type DeliveryPayload = {
  to: string;
  firstName: string;
  prompt: string;
  /** Fallback single audio (legacy concat). New sessions also populate
   *  `takeUrls` — when both are present, the per-take block is the
   *  primary player and `audioUrl` is only used by clients that strip
   *  the per-take HTML. */
  audioUrl: string;
  /** Per-take signed URLs, one per question. Null for legacy rows that
   *  haven't been migrated to the per-take pathname schema. */
  takeUrls: TakeAudioUrl[] | null;
  recordedAt: Date;
  eventName: string | null;
  signals: SignalData | null;
};

export type TakeAudioUrl = {
  question_index: number;
  url: string;
  duration_seconds: number;
};

export function deliverySubject() {
  return "Ten days ago, you described her perfectly.";
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
  takeUrls,
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
  // Founding100 landing page. Env override wins; otherwise the live landing.
  const foundingUrl = process.env.FOUNDING_MEMBER_URL || "https://landing.spaceofmind.com/";
  const parsedQuestions = parsePrompt(prompt);

  // The participant's own words, pulled from the question-tagged transcript
  // stored on signal_data. Each quote is optional — older/failed sessions may
  // lack tags, in which case the surrounding lead-in line is dropped too.
  const transcript = signals?.transcript;
  const q2 = extractQuote(transcript, 2); // her future self, described
  const q3 = extractQuote(transcript, 3); // where she needs to show up
  const q4 = extractQuote(transcript, 4); // the cost of staying
  const q5 = extractQuote(transcript, 5); // the belief she'd shed

  const vocalBlock = signals ? vocalHtml(signals) : "";
  const audioBlock = renderAudioBlock({ audioUrl, takeUrls, questions: parsedQuestions });
  const reportBlock = signals ? signalsHtml(signals) : "";
  const name = escapeHtml(firstName);

  // Space of Mind brand palette. A personal letter from Karolina (CEO &
  // Co-Founder), sent 10 days post-event: narrative + the participant's own
  // words + their voice data + recording, closing on the Founding100 invite.
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

          <tr><td style="border-top:1px solid #E3E3FF;padding-top:24px;padding-bottom:6px;">
            <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1B1B2F;padding-bottom:14px;">${name},</div>
            <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:26px;line-height:1.25;letter-spacing:-0.01em;color:#1B1B2F;">
              Ten days ago, you did something most people never do.
            </div>
          </td></tr>

          <tr><td style="padding-top:22px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${para("You said her name out loud. You described exactly who she is — how she moves, what she carries differently, the thing she believes about herself that you haven&rsquo;t fully claimed yet.")}
              ${para("You spoke her into the room.")}
              ${para("And we were listening.")}
            </table>
          </td></tr>

          ${vocalBlock}

          <tr><td style="padding-top:22px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${para("Here&rsquo;s what we heard — from everyone in that space, together:")}
              ${para("Your future self is not a vague aspiration. She is specific. You know her. You described the calm in her body, the way she doesn&rsquo;t apologize for taking up space, the way she walks into a room like she&rsquo;s already been there a hundred times. You said she&rsquo;s confident — not loud, not performing. Just certain.")}
              ${q2 ? para("You said:") + quoteRow(q2) : ""}
              ${q3 ? para("And you told us exactly where she needs to show up most:") + quoteRow(q3) : ""}
              ${q5 ? para("When it comes to what&rsquo;s standing in the way, you put it this way:") + quoteRow(q5) : ""}
              ${para("That&rsquo;s the story. One story. Running underneath every hesitation, every conversation you haven&rsquo;t started yet.")}
              ${para("You named it. In that room, out loud.")}
              ${para("That matters more than you know.")}
              ${q4 ? para("You also told us what staying has cost you.") + quoteRow(q4) : ""}
              ${para("The gap between who you are right now and who you described in that room — that&rsquo;s not a failure.")}
            </table>
          </td></tr>

          <tr><td style="padding:28px 0 0;">
            ${sectionLabel("Hear yourself again")}
          </td></tr>
          <tr><td style="padding:12px 0 4px;">
            ${audioBlock}
          </td></tr>

          <tr><td style="padding-top:28px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${para("That gap is the work. And the work deserves a home.")}
              ${para("Which is exactly why we built Space of Mind.")}
              ${para("What you did at the Future Self Studio was a glimpse of what&rsquo;s possible when you get out of your own way and actually meet yourself — your future self — with honesty.")}
              ${para("That&rsquo;s what our app is built to hold.")}
              ${para("Space of Mind is designed to close the gap between who you are today and who you already know you&rsquo;re capable of being. It keeps your vision alive, tracks the beliefs you&rsquo;re actively shedding, and puts you back in conversation with the version of yourself you spoke about in that room — not just once, but every day.")}
              ${para("You&rsquo;re invited to become a <strong style=\"font-weight:600;\">Founding Member</strong> of Space of Mind.")}
            </table>
          </td></tr>

          <tr><td style="padding:6px 0 0;">
            ${foundingBullet("Early access", "You&rsquo;re in before anyone else, before the public launch.")}
            ${foundingBullet("A direct line to us", "Your experience shapes what we build next. We mean that.")}
            ${foundingBullet("Founding Member pricing", "Locked in for life, no matter where the product goes.")}
            ${foundingBullet("A community", "A private space of members sharing how they&rsquo;re meeting their future selves daily.")}
          </td></tr>

          <tr><td style="padding:28px 0 6px;">
            <a href="${foundingUrl}" style="display:inline-block;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:15px;letter-spacing:0.02em;color:#FFFFFF;background:#1B1B2F;text-decoration:none;border-radius:999px;padding:16px 30px;">
              Claim Your Founding Member Spot &rarr;
            </a>
          </td></tr>
          <tr><td style="padding-bottom:8px;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#5F6264;">
            Only 100 spots available
          </td></tr>

          <tr><td style="padding-top:24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${para("We&rsquo;ll see you on the other side.")}
            </table>
            <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-style:italic;font-size:16px;line-height:1.5;color:#1B1B2F;padding-top:6px;">With belief in everything you&rsquo;re becoming,</div>
            <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:18px;color:#1B1B2F;padding-top:10px;">Karolina</div>
            <div style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#5F6264;padding-top:4px;">CEO &amp; Co-Founder, Space of Mind</div>
          </td></tr>

          ${reportBlock
            ? `<tr><td style="border-top:1px solid #E3E3FF;margin-top:40px;padding-top:32px;">
                 ${sectionLabel("The full read — what your words and voice revealed")}
               </td></tr>
               ${reportBlock}`
            : ""}

          <tr><td style="padding-top:48px;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#5F6264;">
            Space of Mind · Mental fitness infrastructure
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** A letter paragraph row. Copy is trusted (static, may contain entities). */
function para(html: string): string {
  return `<tr><td style="padding:0 0 16px;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1B1B2F;">${html}</td></tr>`;
}

/** The participant's own words, set as an accented pull-quote. Escaped. */
function quoteRow(text: string): string {
  return `<tr><td style="padding:2px 0 18px;">
    <div style="border-left:3px solid #1B1B2F;padding:2px 0 2px 18px;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-style:italic;font-size:19px;line-height:1.5;letter-spacing:-0.005em;color:#1B1B2F;">&ldquo;${escapeHtml(text)}&rdquo;</div>
  </td></tr>`;
}

/** A Founding Member benefit line: bold title — muted body. Trusted copy. */
function foundingBullet(title: string, body: string): string {
  return `<div style="padding:7px 0;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;">
    <span style="font-weight:600;color:#1B1B2F;">${title}</span><span style="color:#5F6264;"> — ${body}</span>
  </div>`;
}

/**
 * Extract one question's verbatim answer from the [Q1]…[Q5]-tagged transcript
 * stored on signal_data. Returns "" when the tag is absent (single-take or
 * legacy sessions) so callers can drop the surrounding copy gracefully.
 */
function extractQuote(transcript: string | undefined, index: number): string {
  if (!transcript) return "";
  const m = transcript.match(new RegExp(`\\[Q${index}\\]([\\s\\S]*?)(?=\\[Q\\d+\\]|$)`));
  return m ? m[1].trim() : "";
}

/**
 * Dedicated "Your voice" section — the two voice-derived signals (pitch /
 * register and pace / tempo) lifted out of the lower analytics table into a
 * prominent block right after "And we were listening." Each row is dropped if
 * its signal is empty (e.g. register failed to capture pitch samples).
 */
function vocalHtml(s: SignalData): string {
  const r = s.register;
  const t = s.tempo;
  const pitchRow =
    r.avg_hz > 0
      ? signalRowHtml(
          "Pitch",
          r.summary,
          `${Math.round(r.avg_hz)} Hz average · range ${Math.round(r.min_hz)}–${Math.round(r.max_hz)} Hz · ${r.drop_count} drop${r.drop_count === 1 ? "" : "s"}, ${r.rise_count} rise${r.rise_count === 1 ? "" : "s"} into truth`
        )
      : "";
  const paceRow =
    t.speech_rate_wpm > 0
      ? signalRowHtml(
          "Pace",
          t.summary,
          `${t.speech_rate_wpm} words per minute · ${t.pause_count} pause${t.pause_count === 1 ? "" : "s"}`
        )
      : "";
  if (!pitchRow && !paceRow) return "";
  return `
    <tr><td style="padding:28px 0 0;">
      ${sectionLabel("Your voice")}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;padding-top:6px;">
        ${pitchRow}
        ${paceRow}
      </table>
    </td></tr>
  `;
}

/**
 * Audio section. When `takeUrls` is present (new-schema sessions), render
 * one player per question with its prompt above. When null (legacy rows
 * recorded before the per-take refactor), fall back to a single player
 * pointed at the byte-concatenated WebM — which most email clients will
 * only play the first take of, but it's still better than nothing.
 */
function renderAudioBlock({
  audioUrl,
  takeUrls,
  questions,
}: {
  audioUrl: string;
  takeUrls: TakeAudioUrl[] | null;
  questions: { index: number; text: string }[];
}): string {
  // Gmail (and several other webmail clients) strip <audio> tags during
  // sanitization, so every player is paired with a "Listen" pill link to
  // the same URL. <a> always survives — clicking opens the file in a new
  // tab where the browser plays it natively.
  if (!takeUrls || takeUrls.length === 0) {
    return `
      <audio controls src="${audioUrl}" style="width:100%;"></audio>
      <div style="padding-top:10px;">${listenButton(audioUrl, "Listen to your recording")}</div>
    `;
  }
  const byIndex = new Map(questions.map((q) => [q.index, q.text]));
  const sorted = [...takeUrls].sort((a, b) => a.question_index - b.question_index);
  const rows = sorted.map((t) => {
    const promptText = byIndex.get(t.question_index) ?? `Question ${t.question_index}`;
    return `
      <tr><td style="padding:16px 0;border-top:1px solid #E3E3FF;">
        <div style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#5F6264;padding-bottom:6px;">
          Q${t.question_index}${t.duration_seconds ? ` · ${Math.round(t.duration_seconds)}s` : ""}
        </div>
        <div style="font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1B1B2F;padding-bottom:10px;">
          ${escapeHtml(promptText)}
        </div>
        <audio controls src="${t.url}" style="width:100%;display:block;margin-bottom:8px;"></audio>
        ${listenButton(t.url, `Listen to Q${t.question_index}`)}
      </td></tr>`;
  });
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows.join("")}</table>`;
}

/** Pill-shaped link button. Survives Gmail's HTML sanitization where
 *  <audio> tags do not. Visually matches the "Finish" CTA at the bottom. */
function listenButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:500;font-size:13px;letter-spacing:0.02em;color:#FFFFFF;background:#1B1B2F;text-decoration:none;border-radius:999px;padding:10px 18px;">▶ ${escapeHtml(label)}</a>`;
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
  audioUrl,
  takeUrls,
  recordedAt,
  eventName,
  signals,
}: DeliveryPayload) {
  const dateStr = recordedAt.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  const context = eventName ? `${dateStr} — ${eventName}` : dateStr;
  const foundingUrl = process.env.FOUNDING_MEMBER_URL || "https://landing.spaceofmind.com/";

  const transcript = signals?.transcript;
  const q2 = extractQuote(transcript, 2);
  const q3 = extractQuote(transcript, 3);
  const q4 = extractQuote(transcript, 4);
  const q5 = extractQuote(transcript, 5);

  const lines: string[] = [
    `Space of Mind · Future Self Studio · ${context}`,
    "",
    `${firstName},`,
    "",
    "Ten days ago, you did something most people never do.",
    "",
    "You said her name out loud. You described exactly who she is — how she moves, what she carries differently, the thing she believes about herself that you haven't fully claimed yet.",
    "",
    "You spoke her into the room.",
    "",
    "And we were listening.",
    "",
  ];

  // YOUR VOICE — pitch + pace lifted up front to mirror the HTML.
  if (signals && (signals.register.avg_hz > 0 || signals.tempo.speech_rate_wpm > 0)) {
    lines.push("YOUR VOICE");
    lines.push("");
    if (signals.register.avg_hz > 0) {
      lines.push(`  PITCH · ${signals.register.summary}`);
      lines.push(`    ${Math.round(signals.register.avg_hz)} Hz average · range ${Math.round(signals.register.min_hz)}–${Math.round(signals.register.max_hz)} Hz · ${signals.register.drop_count} drops, ${signals.register.rise_count} rises into truth`);
      lines.push("");
    }
    if (signals.tempo.speech_rate_wpm > 0) {
      lines.push(`  PACE · ${signals.tempo.summary}`);
      lines.push(`    ${signals.tempo.speech_rate_wpm} words per minute · ${signals.tempo.pause_count} pauses`);
      lines.push("");
    }
  }

  lines.push("Here's what we heard — from everyone in that space, together:");
  lines.push("");
  lines.push("Your future self is not a vague aspiration. She is specific. You know her. You described the calm in her body, the way she doesn't apologize for taking up space, the way she walks into a room like she's already been there a hundred times. You said she's confident — not loud, not performing. Just certain.");
  lines.push("");
  if (q2) {
    lines.push("You said:");
    lines.push(`  "${q2}"`);
    lines.push("");
  }
  if (q3) {
    lines.push("And you told us exactly where she needs to show up most:");
    lines.push(`  "${q3}"`);
    lines.push("");
  }
  if (q5) {
    lines.push("When it comes to what's standing in the way, you put it this way:");
    lines.push(`  "${q5}"`);
    lines.push("");
  }
  lines.push("That's the story. One story. Running underneath every hesitation, every conversation you haven't started yet.");
  lines.push("");
  lines.push("You named it. In that room, out loud.");
  lines.push("");
  lines.push("That matters more than you know.");
  lines.push("");
  if (q4) {
    lines.push("You also told us what staying has cost you.");
    lines.push(`  "${q4}"`);
    lines.push("");
  }
  lines.push("The gap between who you are right now and who you described in that room — that's not a failure.");
  lines.push("");

  // Hear yourself again — per-take URLs when present, single legacy URL otherwise.
  lines.push("HEAR YOURSELF AGAIN");
  if (takeUrls && takeUrls.length > 0) {
    const sorted = [...takeUrls].sort((a, b) => a.question_index - b.question_index);
    for (const t of sorted) {
      lines.push(`  Q${t.question_index} (${Math.round(t.duration_seconds)}s): ${t.url}`);
    }
    lines.push("");
  } else {
    lines.push(`  ${audioUrl}`);
    lines.push("");
  }

  // The pitch.
  lines.push("That gap is the work. And the work deserves a home.");
  lines.push("");
  lines.push("Which is exactly why we built Space of Mind.");
  lines.push("");
  lines.push("What you did at the Future Self Studio was a glimpse of what's possible when you get out of your own way and actually meet yourself — your future self — with honesty.");
  lines.push("");
  lines.push("That's what our app is built to hold.");
  lines.push("");
  lines.push("Space of Mind is designed to close the gap between who you are today and who you already know you're capable of being. It keeps your vision alive, tracks the beliefs you're actively shedding, and puts you back in conversation with the version of yourself you spoke about in that room — not just once, but every day.");
  lines.push("");
  lines.push("You're invited to become a Founding Member of Space of Mind.");
  lines.push("");
  lines.push("  • Early access — you're in before anyone else, before the public launch.");
  lines.push("  • A direct line to us — your experience shapes what we build next. We mean that.");
  lines.push("  • Founding Member pricing — locked in for life, no matter where the product goes.");
  lines.push("  • A community — a private space of members sharing how they're meeting their future selves daily.");
  lines.push("");
  lines.push(`Claim Your Founding Member Spot → ${foundingUrl}`);
  lines.push("(Only 100 spots available)");
  lines.push("");
  lines.push("We'll see you on the other side.");
  lines.push("");
  lines.push("With belief in everything you're becoming,");
  lines.push("Karolina");
  lines.push("CEO & Co-Founder, Space of Mind");

  if (signals) {
    lines.push("");
    lines.push("──────────────────────────────");
    lines.push("THE FULL READ — what your words and voice revealed");
    lines.push("");
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
