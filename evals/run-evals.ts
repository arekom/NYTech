#!/usr/bin/env tsx
/**
 * Evaluation harness entrypoint.
 *
 * Usage:
 *   npm run evals                  run every fixture
 *   npm run evals -- --filter=foo  run fixtures whose slug matches /foo/
 *   npm run evals -- --no-brain    skip TRIBE brain render (faster, no Railway needed)
 *   npm run evals -- --no-synth    skip synthesis (faster)
 *
 * Discovers fixtures under evals/fixtures/<slug>/ with:
 *   - audio.{webm,m4a,ogg,wav,mp3}   the recording
 *   - ground_truth.yaml              expectations
 *   - script.md                       (optional) the script the recorder used
 *
 * Drives the same lib/* functions that /api/analyze uses, so what we
 * measure is what the booth will produce — minus the streaming wrapper
 * and DB write.
 */
import { readFile, readdir, stat, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join, dirname } from "path";
import yaml from "js-yaml";

import { transcribe, analyzeText } from "@/lib/analyze";
import { renderBrain } from "@/lib/brain";
import { synthesize } from "@/lib/synthesis";
import { empiricalSentiment } from "@/lib/sentiment-empirical";
import {
  computeTempo,
  buildRegisterSignal,
  type BrainMap,
  type SignalData,
  type Synthesis,
} from "@/lib/signals";
import type { RegisterData } from "@/lib/pitch";

import { evaluate } from "./evaluators";
import { auditSignalData } from "./forbidden-words";
import type {
  CheckResult,
  EvalRunSummary,
  FixtureResult,
  GroundTruth,
} from "./types";

const FIXTURES_DIR = resolve(__dirname, "fixtures");
const RESULTS_PATH = resolve(__dirname, "results.json");

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set — required to run evals");
    process.exit(2);
  }

  const fixtures = await discoverFixtures(FIXTURES_DIR);
  if (fixtures.length === 0) {
    console.log("No fixtures found under evals/fixtures/.");
    console.log("See evals/fixtures/README.md for how to add one.");
    process.exit(0);
  }

  const filtered = args.filter
    ? fixtures.filter((f) => f.slug.includes(args.filter!))
    : fixtures;
  if (filtered.length === 0) {
    console.log(`No fixtures match --filter=${args.filter}`);
    process.exit(0);
  }

  console.log("");
  console.log(`Running ${filtered.length} fixture${filtered.length === 1 ? "" : "s"}...`);
  console.log(`  brain render: ${args.noBrain ? "SKIPPED (--no-brain)" : "enabled (if BRAIN_SERVICE_URL set)"}`);
  console.log(`  synthesis:    ${args.noSynth ? "SKIPPED (--no-synth)" : "enabled"}`);
  console.log("");

  const results: FixtureResult[] = [];
  for (const fixture of filtered) {
    const r = await runFixture(fixture);
    results.push(r);
    printFixtureResult(r);
  }

  const summary: EvalRunSummary = summarize(results);
  printSummary(summary);
  await mkdir(dirname(RESULTS_PATH), { recursive: true });
  await writeFile(RESULTS_PATH, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${RESULTS_PATH}`);

  process.exit(summary.failed > 0 || summary.forbiddenWordHits > 0 ? 1 : 0);
}

/* ─────────────────────────────────────────────────────────────────── */

type Fixture = {
  slug: string;
  dir: string;
  audioPath: string;
  groundTruthPath: string;
};

async function discoverFixtures(root: string): Promise<Fixture[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  const fixtures: Fixture[] = [];
  for (const d of dirs) {
    const dir = join(root, d.name);
    const groundTruthPath = join(dir, "ground_truth.yaml");
    if (!existsSync(groundTruthPath)) continue;
    // Try each supported audio extension
    const audioPath = ["audio.webm", "audio.m4a", "audio.ogg", "audio.wav", "audio.mp3"]
      .map((f) => join(dir, f))
      .find((p) => existsSync(p));
    if (!audioPath) {
      console.warn(`Skipping ${d.name}: no audio.{webm,m4a,ogg,wav,mp3} present`);
      continue;
    }
    fixtures.push({ slug: d.name, dir, audioPath, groundTruthPath });
  }
  fixtures.sort((a, b) => a.slug.localeCompare(b.slug));
  return fixtures;
}

async function runFixture(f: Fixture): Promise<FixtureResult> {
  const start = Date.now();
  const warnings: string[] = [];

  const gtRaw = await readFile(f.groundTruthPath, "utf-8");
  const gt = yaml.load(gtRaw) as GroundTruth;

  const audioBytes = await readFile(f.audioPath);
  // Detect MIME by extension
  const ext = f.audioPath.split(".").pop()!;
  const mime = ext === "webm" ? "audio/webm"
    : ext === "m4a" ? "audio/mp4"
    : ext === "ogg" ? "audio/ogg"
    : ext === "wav" ? "audio/wav"
    : "audio/mpeg";
  const audioBlob = new Blob([new Uint8Array(audioBytes)], { type: mime });

  // ── Transcribe ─────────────────────────────────────────────────
  const transcript = await transcribe(audioBlob);

  // ── Pure-code signals ──────────────────────────────────────────
  const tempoSignal = computeTempo(transcript.words, transcript.duration);
  const registerSignal = buildRegisterSignal(emptyRegister());

  // ── Extraction ─────────────────────────────────────────────────
  const extraction = await analyzeText(transcript.text);
  const wordCount = transcript.words.length;
  if (wordCount > 0) {
    extraction.ownership.self_focus_ratio =
      extraction.ownership.first_person_count / wordCount;
  }

  // Empirical sentiment cross-check
  const empirical = empiricalSentiment(transcript.text);
  extraction.sentiment.empirical_score = empirical.score;
  extraction.sentiment.empirical_hits = empirical.hits;

  // ── Brain (optional) ───────────────────────────────────────────
  let brain_map: BrainMap | null = null;
  if (!args.noBrain && process.env.BRAIN_SERVICE_URL) {
    try {
      brain_map = await renderBrain([{ audio: audioBlob }]);
    } catch (err) {
      warnings.push(`brain render failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (!args.noBrain) {
    warnings.push("BRAIN_SERVICE_URL unset — brain render skipped");
  }

  // ── Synthesis (optional) ───────────────────────────────────────
  let synthesis: Synthesis | null = null;
  if (!args.noSynth) {
    try {
      synthesis = await synthesize({
        transcript: transcript.text,
        extraction,
        brain: brain_map,
      });
    } catch (err) {
      warnings.push(`synthesis failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const signalData: SignalData = {
    transcript: transcript.text,
    duration_seconds: transcript.duration,
    word_count: wordCount,
    certainty: extraction.certainty,
    tempo: tempoSignal,
    register: registerSignal,
    ownership: extraction.ownership,
    future_vision: extraction.future_vision,
    linguistic: extraction.linguistic,
    limiting_beliefs: extraction.limiting_beliefs,
    thinking_patterns: extraction.thinking_patterns,
    sentiment: extraction.sentiment,
    emerging_patterns: extraction.emerging_patterns,
    brain_map,
    synthesis,
  };

  const checks = evaluate(signalData, gt);
  const forbiddenWordHits = auditSignalData(signalData);
  const elapsed = (Date.now() - start) / 1000;

  return {
    slug: f.slug,
    description: gt.description ?? "(no description)",
    audioPath: f.audioPath,
    durationSeconds: elapsed,
    transcript: transcript.text,
    checks,
    forbiddenWordHits,
    warnings,
    signalSummary: {
      themes: signalData.linguistic.themes,
      limiting_beliefs: signalData.limiting_beliefs.map((b) => b.type),
      thinking_patterns: signalData.thinking_patterns.map(
        (p) => `${p.pattern_type}:${p.pattern}`
      ),
      hedge_count: signalData.certainty.hedge_count,
      certainty_count: signalData.certainty.certainty_count,
      self_focus_ratio: signalData.ownership.self_focus_ratio,
      sentiment: {
        score: signalData.sentiment.overall_score,
        category: signalData.sentiment.category,
        dominant_emotion: signalData.sentiment.dominant_emotion,
      },
      synthesis_findings: (signalData.synthesis?.findings ?? []).map((f) => ({
        headline: f.headline,
      })),
    },
  };
}

/* ─────────────────────────────────────────────────────────────────── */

function summarize(results: FixtureResult[]): EvalRunSummary {
  const flat = results.flatMap((r) => r.checks);
  return {
    runId: `${new Date().toISOString().replace(/[:.]/g, "-")}`,
    startedAt: new Date().toISOString(),
    fixtureCount: results.length,
    totalChecks: flat.length,
    passed: flat.filter((c) => c.kind === "pass").length,
    failed: flat.filter((c) => c.kind === "fail").length,
    skipped: flat.filter((c) => c.kind === "skip").length,
    forbiddenWordHits: results.reduce((s, r) => s + r.forbiddenWordHits.length, 0),
    fixtures: results,
  };
}

function printFixtureResult(r: FixtureResult): void {
  const fail = r.checks.filter((c): c is Extract<CheckResult, { kind: "fail" }> => c.kind === "fail");
  const pass = r.checks.filter((c) => c.kind === "pass");
  const icon = fail.length === 0 && r.forbiddenWordHits.length === 0 ? "PASS" : "FAIL";

  console.log(`[${icon}] ${r.slug}  (${r.durationSeconds.toFixed(1)}s)`);
  console.log(`  ${r.description}`);
  console.log(`  ${pass.length} passed, ${fail.length} failed`);

  for (const c of r.checks) {
    if (c.kind === "pass") {
      console.log(`    ✓  ${c.label}${c.detail ? "  —  " + c.detail : ""}`);
    } else if (c.kind === "fail") {
      console.log(`    ✗  ${c.label}  —  ${c.detail}`);
    } else {
      console.log(`    ·  ${c.label}  (skipped: ${c.reason})`);
    }
  }

  if (r.forbiddenWordHits.length > 0) {
    console.log(`  ⚠ FORBIDDEN WORDS in user-facing copy:`);
    for (const h of r.forbiddenWordHits) {
      console.log(`    "${h.match}" in ${h.source}`);
      console.log(`      ${h.context}`);
    }
  }

  for (const w of r.warnings) {
    console.log(`  ! ${w}`);
  }

  console.log("");
}

function printSummary(s: EvalRunSummary): void {
  console.log("━".repeat(60));
  console.log(`Summary: ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped`);
  console.log(`         across ${s.fixtureCount} fixtures (${s.totalChecks} checks)`);
  if (s.forbiddenWordHits > 0) {
    console.log(`         ⚠ ${s.forbiddenWordHits} forbidden-word hit${s.forbiddenWordHits === 1 ? "" : "s"} in user-facing copy`);
  }
  console.log("━".repeat(60));
}

function parseArgs(argv: string[]): { filter?: string; noBrain: boolean; noSynth: boolean } {
  let filter: string | undefined;
  let noBrain = false;
  let noSynth = false;
  for (const a of argv) {
    if (a.startsWith("--filter=")) filter = a.slice("--filter=".length);
    else if (a === "--no-brain") noBrain = true;
    else if (a === "--no-synth") noSynth = true;
  }
  return { filter, noBrain, noSynth };
}

function emptyRegister(): RegisterData {
  return {
    samples: [],
    avg_hz: 0,
    min_hz: 0,
    max_hz: 0,
    std_hz: 0,
    drop_count: 0,
    rise_count: 0,
  };
}

void stat; // prevent unused import elimination if needed

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
