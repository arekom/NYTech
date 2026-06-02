import type { SignalData, Synthesis } from "@/lib/signals";

/**
 * Clinical jargon audit. The brand book bans diagnostic / pathologizing
 * language in user-facing copy. Every booth visit's output passes through
 * this audit — both in the analyze route (logs warnings if a hit slips
 * past LLM constraints) and in the eval harness (fails the test).
 *
 * Scope: USER-FACING strings only — summaries, interpretations, headlines,
 * synthesis bodies. We do NOT scan the verbatim transcript itself (the
 * user gets to say whatever they want), or the internal clinical SLUGS
 * (e.g. "impostor-syndrome" as a type tag is fine; "impostor syndrome"
 * appearing in copy is not).
 */
const FORBIDDEN = [
  // Diagnostic labels
  "depression", "depressive", "depressed",
  "anxiety disorder", "anxiety-disorder",
  "trauma", "traumatized", "PTSD", "C-PTSD",
  "disorder", "disordered",
  "OCD", "obsessive-compulsive", "obsessive compulsive",
  "ADHD", "ADD", "attention deficit",
  "bipolar",
  "psychosis", "psychotic",
  "schizophrenia", "schizophrenic",
  "borderline",
  "narcissistic", "narcissist",
  "addict", "addiction", "substance use",
  "mental illness", "mentally ill",
  // Clinical action words
  "diagnose", "diagnosis", "diagnostic",
  "clinical",
  "therapist", "therapy", "treatment", "treat",
  "patient",
  "medication", "medicate", "prescribe",
  "symptom", "symptoms",
  "pathology", "pathological",
  // Soft "I noticed" / "It seems" wishy-washy hedges the brand voice bans
  "i noticed", "it seems", "it appears",
];

export type ForbiddenWordHit = {
  /** Which field the offending text came from. */
  source: string;
  /** The exact word/phrase we matched. */
  match: string;
  /** Trimmed context around the match. */
  context: string;
};

/**
 * Scan every user-facing string in a SignalData payload for forbidden
 * words. Returns the list of hits with source field + context.
 */
export function auditSignalData(s: SignalData): ForbiddenWordHit[] {
  const hits: ForbiddenWordHit[] = [];
  const fields: Array<[string, string]> = [
    ["certainty.summary", s.certainty.summary],
    ["tempo.summary", s.tempo.summary],
    ["register.summary", s.register.summary],
    ["ownership.summary", s.ownership.summary],
    ["future_vision.summary", s.future_vision.summary],
    ["sentiment.summary", s.sentiment.summary],
  ];

  for (const b of s.limiting_beliefs) {
    fields.push([`limiting_beliefs[${b.type}].interpretation`, b.interpretation]);
  }
  for (const p of s.thinking_patterns) {
    fields.push([`thinking_patterns[${p.pattern}].interpretation`, p.interpretation]);
  }
  for (const e of s.emerging_patterns) {
    fields.push([`emerging_patterns.recommendation`, e.recommendation]);
  }
  if (s.synthesis) {
    hits.push(...auditSynthesis(s.synthesis));
  }

  for (const [source, text] of fields) {
    hits.push(...scan(source, text));
  }
  return hits;
}

function auditSynthesis(syn: Synthesis): ForbiddenWordHit[] {
  const hits: ForbiddenWordHit[] = [];
  hits.push(...scan("synthesis.intro", syn.intro));
  syn.findings.forEach((f, i) => {
    hits.push(...scan(`synthesis.findings[${i}].headline`, f.headline));
    hits.push(...scan(`synthesis.findings[${i}].body`, f.body));
  });
  syn.region_attributions.forEach((a, i) => {
    hits.push(...scan(`synthesis.region_attributions[${i}].activated_by`, a.activated_by));
    hits.push(...scan(`synthesis.region_attributions[${i}].hints`, a.hints));
  });
  return hits;
}

function scan(source: string, text: string): ForbiddenWordHit[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const out: ForbiddenWordHit[] = [];
  for (const word of FORBIDDEN) {
    const idx = lower.indexOf(word.toLowerCase());
    if (idx < 0) continue;
    const start = Math.max(0, idx - 30);
    const end = Math.min(text.length, idx + word.length + 30);
    out.push({
      source,
      match: word,
      context: "…" + text.slice(start, end).trim() + "…",
    });
  }
  return out;
}
