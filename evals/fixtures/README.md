# Evals fixtures

Each subdirectory is one test case for the analysis pipeline.

## Adding a fixture

Create a new directory under `evals/fixtures/<short-slug>/` containing:

```
evals/fixtures/01-impostor/
  audio.webm          (or .m4a / .ogg / .wav / .mp3)
  ground_truth.yaml   what we expect the pipeline to extract
  script.md           (optional) the script the recorder read
```

Then run:

```powershell
npm run evals -- --filter=01-impostor
```

## Recording audio

Easiest path: open the booth app locally (`npm run dev`), navigate through to the Recording screen for one of the 5 questions, read your fixture's `script.md`, hit Stop. Right-click the resulting `<audio>` element in the booth confirmation screen (or capture the upload payload from Network tab) to grab the .webm. Drop it in the fixture directory as `audio.webm`.

For a totally different approach: record in QuickTime / Audacity / OBS / any mic recorder, export as WAV or M4A.

## Ground truth schema

See [`evals/types.ts`](../types.ts) `GroundTruth`. Minimal shape:

```yaml
description: Heavy impostor-syndrome script — perfectionism + comparison.

expected:
  themes:
    - impostor
    - self-doubt
  limiting_beliefs:
    - impostor-syndrome
    - perfectionism
  not_limiting_beliefs:
    - entitlement
  thinking_patterns:
    - disqualifying-positive
  hedge_count:
    value: 8
    tolerance: 3
  self_focus_ratio:
    value: 0.22
    tolerance: 0.05
  sentiment_score:
    value: 30
    tolerance: 10
  sentiment_category: negative
  dominant_emotion_oneof: [shame, doubt, anxiety]
```

Every field under `expected` is optional. Omit anything you don't want scored — the evaluator silently skips fields that aren't declared. This lets you build targeted fixtures (e.g. one fixture that ONLY tests distortion detection).

## Reading the output

`npm run evals` writes a session summary to `evals/results.json` and prints a per-fixture table to stdout:

```
[PASS] 01-impostor  (12.4s)
  ✓  themes  —  detected: impostor, self-doubt, comparison
  ✓  limiting_beliefs (precision)  —  impostor-syndrome, perfectionism
  ✗  hedge_count  —  3 outside 8 ±3
  ⚠ FORBIDDEN WORDS in user-facing copy:
    "anxiety" in synthesis.findings[2].body
```

Each `✗` is a measurable regression you can fix; each `⚠` is a clinical-jargon leak the brand voice forbids.

## Determinism

Both LLM calls use `temperature: 0` and a fixed `seed` parameter. Identical transcript in → identical output (best-effort, within an OpenAI model version). Whisper transcription itself has small variance run-to-run (no seed param), so the evaluators use fuzzy matching on transcript-derived fields like themes and verbatim quotes.

## Skipping expensive stages

```
npm run evals -- --no-brain   skip TRIBE (no Railway needed, faster)
npm run evals -- --no-synth   skip the gpt-4o synthesis call (cheaper)
```
