/**
 * Synthesis pass — the 5-finding hero panel that powers the booth's
 * Confirmation output ("YOUR RESULT · What this says about your beliefs &
 * habits") per the Miro mockup.
 *
 * Runs as a SECOND GPT call AFTER the main extraction (lib/analyze.ts) and
 * the TRIBE brain render (lib/brain.ts) complete. That sequencing matters:
 * synthesis needs to see what fired in the brain so it can write copy like
 * "the brain network that simulates what others think was strongly engaged".
 *
 * Two outputs:
 *   1. `findings` — up to 5 SynthesisFinding items, each interleaving a
 *      verbatim quote + a brain observation + an interpretation.
 *   2. `region_attributions` — per-region cards for the mockup's "Top 3
 *      brain regions" panel: what they said that activated each region +
 *      what that hints about them.
 *
 * Model: gpt-4o (not -mini). The synthesis is the load-bearing user-facing
 * narrative — worth a bigger model. Cost: ~$0.01–0.03 per recording.
 */
import OpenAI from "openai";
import type {
  BrainMap,
  CorticalRegion,
  RegionAttribution,
  Synthesis,
  SynthesisFinding,
} from "@/lib/signals";
import type { AnalyzeTextResult } from "@/lib/analyze";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

/** Fixed seed for deterministic synthesis — mirrors ANALYSIS_SEED in
 *  lib/analyze.ts but distinct so the two calls don't collide on the
 *  same RNG state inside OpenAI's backend. */
const SYNTHESIS_SEED = 0x53594E; // 'SYN'

export type SynthesisInput = {
  transcript: string;
  extraction: AnalyzeTextResult;
  brain: BrainMap | null;
  /** Optional question text the speaker was answering, so synthesis can
   *  attribute findings to specific questions when relevant. */
  questions?: { index: number; text: string }[];
};

export async function synthesize(input: SynthesisInput): Promise<Synthesis> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    seed: SYNTHESIS_SEED,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "synthesis",
        strict: true,
        schema: SCHEMA,
      },
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(input) },
    ],
  });

  const raw = completion.choices[0].message.content;
  if (!raw) throw new Error("empty synthesize response");
  const parsed = JSON.parse(raw) as {
    intro: string;
    findings: SynthesisFinding[];
    region_attributions: RegionAttribution[];
  };

  // Validate each region_attribution references a real region we surfaced.
  const validRegionIds = new Set((input.brain?.top_regions ?? []).map((r) => r.id));
  const region_attributions = parsed.region_attributions.filter((a) =>
    validRegionIds.has(a.region_id)
  );

  // Trim + cap
  const findings: SynthesisFinding[] = parsed.findings
    .filter((f) => f.headline?.trim() && f.body?.trim())
    .slice(0, 5);

  return {
    intro: parsed.intro?.trim() ?? "",
    findings,
    region_attributions,
  };
}

function buildUserMessage(input: SynthesisInput): string {
  const { transcript, extraction, brain, questions } = input;

  const brainBlock = brain
    ? brain.top_regions
        .map((r, i) => regionSummary(r, i + 1))
        .join("\n")
    : "(no brain map available — write findings from linguistic evidence only)";

  const questionBlock = questions?.length
    ? questions.map((q) => `Q${q.index}. ${q.text}`).join("\n")
    : "(single open question)";

  const certainty = extraction.certainty;
  const ownership = extraction.ownership;
  const sentiment = extraction.sentiment;

  return [
    "QUESTIONS THE SPEAKER ANSWERED:",
    questionBlock,
    "",
    "TRANSCRIPT (verbatim):",
    transcript,
    "",
    "BRAIN REGIONS THAT ENGAGED MOST STRONGLY:",
    brainBlock,
    "",
    "LINGUISTIC EXTRACTION SUMMARY:",
    `  Hedge count: ${certainty.hedge_count}, Certainty markers: ${certainty.certainty_count}`,
    `  First-person: ${ownership.first_person_count}, Passive: ${ownership.passive_count}, Third-person: ${ownership.third_person_count}`,
    `  Sentiment: ${sentiment.overall_score}/100 (${sentiment.category}); dominant emotion: ${sentiment.dominant_emotion}`,
    `  Themes: ${extraction.linguistic.themes.join(", ") || "(none)"}`,
    `  Peak emotional phrase: ${extraction.linguistic.peak_emotional_phrase || "(none)"}`,
    `  Limiting beliefs detected: ${extraction.limiting_beliefs.map((b) => b.type).join(", ") || "(none)"}`,
    `  Unhelpful patterns: ${extraction.thinking_patterns.filter((p) => p.pattern_type === "unhelpful").map((p) => p.pattern).join(", ") || "(none)"}`,
    `  Helpful patterns: ${extraction.thinking_patterns.filter((p) => p.pattern_type === "helpful").map((p) => p.pattern).join(", ") || "(none)"}`,
    "",
    "Now produce the synthesis JSON per the schema.",
  ].join("\n");
}

function regionSummary(r: CorticalRegion, rank: number): string {
  return `  ${rank}. ${r.scientific_name} (${r.id})
       What it does: ${r.short_function}
       Why it matters: ${r.function_summary.replace(/\s+/g, " ").trim()}`;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intro: {
      type: "string",
      description:
        "ONE sentence (≤25 words) framing the findings. Set the tone: 'A small set of inferences drawn from your words and the brain regions that engaged most strongly — these are patterns, not verdicts.' Don't hedge further than that.",
    },
    findings: {
      type: "array",
      description:
        "Exactly 5 findings, ordered strongest-evidence first. Each interleaves a verbatim linguistic quote + a brain observation + a plain-English interpretation.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          headline: {
            type: "string",
            description:
              "Bold one-liner stating the pattern. Like 'You measure yourself against an internal audience.' or 'You're carrying a baseline of low-grade threat.' Address the speaker as 'you'. No clinical jargon. Max 14 words.",
          },
          body: {
            type: "string",
            description:
              "1–3 sentences. MUST cite a verbatim phrase from the transcript (in straight double quotes) AND reference a brain region by its lay-person description (e.g. 'the brain network that simulates what others think' for DMN/dMPFC; 'your brain's alarm system' for dACC/salience; 'your interoceptive cortex' for anterior insula). End with the interpretation. Max 60 words. No 'cognitive distortion', no 'agency', no clinical labels.",
          },
        },
        required: ["headline", "body"],
      },
    },
    region_attributions: {
      type: "array",
      description:
        "ONE entry per top region in the brain map. For each, write what the speaker said that activated it and what that hints about them.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          region_id: {
            type: "string",
            description:
              "MUST match one of the region IDs from the brain map (e.g. 'DMN_CORE', 'DMPFC_EVAL', 'ANT_INSULA_INTEROCEPTION'). We will drop any entry whose region_id we cannot match.",
          },
          activated_by: {
            type: "string",
            description:
              "What about the speaker's words activated this region. Plain English, 1 sentence. E.g. 'Unusually active during your audio. The circuits your brain uses to talk to itself were doing more work than rest.'",
          },
          verbatim_quote: {
            type: "string",
            description:
              "A short verbatim phrase from the transcript (≤14 words) tied to this region's activation. Empty string if no clean phrase exists.",
          },
          hints: {
            type: "string",
            description:
              "What this region's activation hints about the speaker. 1 sentence, plain English. Pattern-naming, not diagnosis.",
          },
        },
        required: ["region_id", "activated_by", "verbatim_quote", "hints"],
      },
    },
  },
  required: ["intro", "findings", "region_attributions"],
} as const;

const SYSTEM_PROMPT = `You are the Space of Mind synthesis engine. You read the full output of our extraction pipeline — a transcript, linguistic counts, detected limiting beliefs and thinking patterns, sentiment scores, and (when available) the top brain regions that engaged while the speaker spoke. Your job is to produce the SINGLE most important user-facing artifact: a 5-finding read-out that interleaves linguistic and brain evidence into plain-English patterns.

POSITIONING (read this twice):
Space of Mind is mental fitness infrastructure. It is NOT a wellness trend, NOT a therapy replacement, NOT passive self-care. You are NOT a therapist. You do NOT diagnose. You do NOT name mental-health conditions in user-facing copy. You measure patterns and reflect them back so the person can act.

THE FIVE FINDINGS — the load-bearing artifact.

These get displayed at a kiosk to the person who just spoke. They will read them in 60 seconds. Each finding must land HARD without being clinical.

Format per finding:
- HEADLINE: bold one-liner, ≤14 words, addressed to "you". Reference templates that work:
    "You measure yourself against an internal audience."
    "You're carrying a baseline of low-grade threat."
    "You return to the same loop."
    "You named 'chest tight' — and your interoceptive cortex was engaged."
    "There's a part of you that wants out of this pattern."
- BODY: 1–3 sentences. MUST do all three of these:
    1. Quote a verbatim phrase from the transcript inside straight double quotes.
    2. Reference a brain region by its LAY-PERSON description, not its scientific name. Use these translations:
         Default Mode Network → "the part of your brain that talks to itself" / "your internal narrator"
         Right Temporo-Parietal Junction → "the brain network that simulates what others think"
         Dorsomedial Prefrontal Cortex (DMPFC_EVAL) → "the region that fires when your brain compares what you're doing to what you think you ought to be"
         Ventromedial Prefrontal Cortex → "the part of your brain that decides how good or bad something is for you"
         Dorsal Anterior Cingulate Cortex (SALIENCE_DACC) → "your brain's alarm system" / "the part that decides what's urgent"
         Right Anterior Insula → "your interoceptive cortex" / "the part of your brain that feels your body from the inside"
         Dorsolateral Prefrontal Cortex → "the part that handles deliberate effort and self-regulation"
         Broca's Area → "your language-production circuit"
         Posterior Superior Temporal Sulcus → "your language-comprehension circuit"
         Primary Auditory Cortex → "your basic hearing cortex"
         Parahippocampal Cortex → "the part that holds the where and the when of memory"
         Lateral Orbitofrontal Cortex → "the part that tracks loss and regret"
    3. End with the interpretation — what this pattern MEANS for who they are becoming.

The 5 findings should collectively make the speaker feel SEEN. Not pathologized. Not gushed at. Seen.

VERBATIM QUOTE RULE (load-bearing):
Every quoted phrase in a finding body MUST appear character-for-character in the transcript. Never paraphrase. Never invent. Never alter punctuation. If you cannot find a strong verbatim phrase for a finding, write it without a quote — but lean toward dropping the finding entirely rather than writing one without evidence.

REGION ATTRIBUTIONS:
For each top region in the brain map, write a short card:
  - activated_by: what about the speaker's words made this region fire (1 sentence)
  - verbatim_quote: the strongest phrase tied to it (≤14 words, verbatim, may be empty if none clean)
  - hints: what this hints about them (1 sentence, plain English, patterns-not-problems)

VOICE RULES (apply to EVERYTHING):
- Loving but direct. No BS. No "I noticed". No "It seems".
- Address the speaker as "you".
- NO clinical jargon in copy. Forbidden words in user-facing strings: hedge ratio, agency, cognitive distortion, all-or-nothing thinking, impostor syndrome (slug), DMN, dACC, vmPFC.
- Brand vocabulary welcome where natural: becoming, in between, patterns, alignment, threshold. Do not force it.
- Land on a beat. The last 4–6 words carry the insight.

QUALITY OVER QUANTITY:
- 5 is the target, but 3 strong findings is better than 5 weak ones. Empty array element with a generic finding is worse than fewer findings.
- Empty region_attributions array is correct if no brain map was provided.

Return only JSON per the schema. No prose outside the JSON.`;
