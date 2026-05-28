import OpenAI from "openai";
import type { CertaintySignal, OwnershipSignal, WordTimestamp } from "@/lib/signals";

if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY is not set — analyze pipeline will fail");
}

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

export type TranscriptResult = {
  text: string;
  words: WordTimestamp[];
  duration: number;
};

/**
 * Transcribe an audio blob with OpenAI Whisper-1, returning the full text
 * plus word-level timestamps required for the tempo signal.
 */
export async function transcribe(audio: Blob): Promise<TranscriptResult> {
  // OpenAI SDK expects a File-like with a name; Blob → File coerced via Web API.
  const file = new File([audio], "recording.webm", {
    type: audio.type || "audio/webm",
  });

  const res = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });

  const words = (res as unknown as { words?: { word: string; start: number; end: number }[] })
    .words ?? [];
  return {
    text: res.text,
    duration: (res as unknown as { duration?: number }).duration ?? 0,
    words: words.map((w) => ({ word: w.word, start: w.start, end: w.end })),
  };
}

/**
 * Combined text-analysis call — extracts certainty + ownership signals from
 * the transcript in a single GPT-4o-mini call. Structured JSON output for
 * deterministic parsing. The system prompt is brand-voice; summaries land
 * "loving, direct, no BS" without clinical jargon.
 *
 * Each summary must anchor on a verbatim quote from the transcript (the
 * `verbatim_quote` field). The quote is post-validated to actually appear
 * in the transcript — if it doesn't, the summary falls back to a quote-less
 * variant so we never ship a hallucinated quote to the user.
 */
export async function analyzeText(transcript: string): Promise<{
  certainty: CertaintySignal;
  ownership: OwnershipSignal;
}> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "signal_extraction",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            certainty: {
              type: "object",
              additionalProperties: false,
              properties: {
                hedge_count: { type: "integer" },
                certainty_count: { type: "integer" },
                hedge_examples: {
                  type: "array",
                  items: { type: "string" },
                  description: "Up to 3 short hedge phrases verbatim from the transcript",
                },
                certainty_examples: {
                  type: "array",
                  items: { type: "string" },
                  description: "Up to 3 short certainty phrases verbatim",
                },
                verbatim_quote: {
                  type: "string",
                  description:
                    "A short verbatim substring from the transcript (max 14 words) that the summary anchors on. MUST appear in the transcript exactly — do not paraphrase, do not invent. Empty string if no good quote exists.",
                },
                summary: {
                  type: "string",
                  description:
                    "ONE sentence, brand voice (loving, direct, no BS). MUST include the verbatim_quote wrapped in straight double quotes. Translate the count into a human insight. No jargon. Address the speaker as 'you'. Max 26 words.",
                },
              },
              required: [
                "hedge_count",
                "certainty_count",
                "hedge_examples",
                "certainty_examples",
                "verbatim_quote",
                "summary",
              ],
            },
            ownership: {
              type: "object",
              additionalProperties: false,
              properties: {
                first_person_count: { type: "integer" },
                passive_count: { type: "integer" },
                third_person_count: { type: "integer" },
                first_person_examples: { type: "array", items: { type: "string" } },
                passive_examples: { type: "array", items: { type: "string" } },
                third_person_examples: { type: "array", items: { type: "string" } },
                verbatim_quote: {
                  type: "string",
                  description:
                    "A short verbatim substring from the transcript (max 14 words) showing the agency pattern. MUST appear in the transcript exactly. Empty string if no good quote.",
                },
                summary: {
                  type: "string",
                  description:
                    "ONE sentence. MUST include the verbatim_quote in straight double quotes. Brand voice. Address the speaker as 'you'. Max 26 words.",
                },
              },
              required: [
                "first_person_count",
                "passive_count",
                "third_person_count",
                "first_person_examples",
                "passive_examples",
                "third_person_examples",
                "verbatim_quote",
                "summary",
              ],
            },
          },
          required: ["certainty", "ownership"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content: `You are the Space of Mind measurement engine. You read a transcript of someone speaking to their future self about what they are becoming.

POSITIONING (read this twice):
Space of Mind is mental fitness infrastructure. It is NOT a wellness trend, NOT a therapy replacement, NOT passive self-care. You are NOT a therapist. You do NOT diagnose. You do NOT name mental-health conditions. You measure patterns and reflect them back so the person can act.

YOU COUNT TWO SIGNALS:

1. CERTAINTY vs HEDGING
- Hedge phrases: "I think", "maybe", "hopefully", "I'm trying to", "kind of", "I guess", "sort of", "I'm working on", "I'll try", "I want to", "I'd like to"
- Certainty markers: "I will", "I am", "I know", "when I", "I'm building", "I've decided", "I always", "I never"
Strict counts — only obvious matches.

2. FIRST-PERSON OWNERSHIP
- First-person singular active: "I", "my", "I'm", "I've", "I'll" used as agent of a verb
- Passive: "it happened to me", "things fell into place", "I was given", "it just worked out"
- Third-person deflection: "you know how it is", "people always say", "everyone does this"

VERBATIM QUOTE RULE (load-bearing):
For each signal, pick ONE short substring from the transcript (max 14 words) that BEST illustrates the pattern. The substring MUST appear character-for-character in the transcript. Never paraphrase. Never invent. Never alter punctuation. If no clean substring exists, return empty string for verbatim_quote and write the summary without a quote.

SUMMARY RULES:
- ONE sentence. Maximum 26 words. Address the speaker as "you".
- If verbatim_quote is non-empty, the summary MUST include it inside straight double quotes. Example: "You said \\"I'm trying to\\" three times — your future self has the harder job."
- Loving but direct. No BS. No "I noticed". No "It seems".
- Translate the COUNT into what it MEANS for who they are becoming. Not the number itself.
- No clinical jargon. Never say: hedge ratio, first-person count, agency, semantic, syntactic.
- Brand vocabulary is welcome where natural: becoming, in between, patterns, alignment, threshold. Do not force it.
- Land on a beat. The last 4–6 words should carry the insight.

Return only what the transcript contains. Strict counts. Verbatim quotes. No diagnoses.`,
      },
      {
        role: "user",
        content: `Transcript:\n\n${transcript}`,
      },
    ],
  });

  const raw = completion.choices[0].message.content;
  if (!raw) throw new Error("empty analyzeText response");
  const parsed = JSON.parse(raw) as {
    certainty: {
      hedge_count: number;
      certainty_count: number;
      hedge_examples: string[];
      certainty_examples: string[];
      verbatim_quote: string;
      summary: string;
    };
    ownership: {
      first_person_count: number;
      passive_count: number;
      third_person_count: number;
      first_person_examples: string[];
      passive_examples: string[];
      third_person_examples: string[];
      verbatim_quote: string;
      summary: string;
    };
  };

  const c = parsed.certainty;
  const o = parsed.ownership;
  const hedgeTotal = c.hedge_count + c.certainty_count;
  const agencyTotal =
    o.first_person_count + o.passive_count + o.third_person_count;

  // Validate that any claimed verbatim quote actually appears in the
  // transcript. If GPT hallucinated, strip the quoted segment from the
  // summary so we never ship an invented quote to the speaker.
  const certaintySummary = validateQuoteOrStrip(c.summary, c.verbatim_quote, transcript);
  const ownershipSummary = validateQuoteOrStrip(o.summary, o.verbatim_quote, transcript);

  return {
    certainty: {
      hedge_count: c.hedge_count,
      certainty_count: c.certainty_count,
      hedge_ratio: hedgeTotal > 0 ? c.hedge_count / hedgeTotal : 0,
      examples: {
        hedge: c.hedge_examples.slice(0, 3),
        certainty: c.certainty_examples.slice(0, 3),
      },
      summary: certaintySummary,
    },
    ownership: {
      first_person_count: o.first_person_count,
      passive_count: o.passive_count,
      third_person_count: o.third_person_count,
      agency_ratio: agencyTotal > 0 ? o.first_person_count / agencyTotal : 0,
      examples: {
        first_person: o.first_person_examples.slice(0, 3),
        passive: o.passive_examples.slice(0, 3),
        third_person: o.third_person_examples.slice(0, 3),
      },
      summary: ownershipSummary,
    },
  };
}

/**
 * If GPT claims a verbatim quote, verify it appears in the transcript
 * (case-insensitive, whitespace-flexible). If not, remove the quoted span
 * from the summary so we never expose a hallucinated quote.
 */
function validateQuoteOrStrip(
  summary: string,
  quote: string,
  transcript: string
): string {
  if (!quote.trim()) return summary;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (norm(transcript).includes(norm(quote))) return summary;

  // Hallucinated. Strip the quoted span and surrounding em-dash glue.
  console.warn("hallucinated verbatim quote stripped:", JSON.stringify(quote));
  return summary
    .replace(/[“"]?\s*[^"“”]*[”"]?\s*—\s*/g, "")
    .replace(/[“"][^"“”]*[”"]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
