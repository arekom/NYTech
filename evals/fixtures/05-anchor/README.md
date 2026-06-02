# 05-anchor — your own regression baseline

This fixture is the only one in the eval suite that's **yours specifically**, not a scripted character. It exists to catch *drift* — when a prompt change or model upgrade subtly alters how the pipeline reads YOU.

## How to use it

1. **Record yourself** answering any one of the five booth questions in a single take. Use the booth app (`npm run dev`) or any audio recorder. ~45–90s.
2. Save the file here as `audio.webm` (or `.m4a` / `.ogg` / `.wav` / `.mp3`).
3. **Run the eval once** to capture YOUR baseline:
   ```powershell
   npm run evals -- --filter=05-anchor
   ```
   Note the values it produces — themes, beliefs, patterns, hedge count, self-focus ratio, sentiment.
4. **Author the ground truth** based on those values + a tolerance you're comfortable with:
   - For counts (hedge / certainty / self_focus_ratio / sentiment_score): set tolerance to ~30% of the observed value
   - For beliefs / patterns / themes: include the strongest 2–3 you saw
   - For sentiment_category and dominant_emotion: use what the pipeline produced
5. Copy your authored ground truth into `ground_truth.yaml` here. After that, every future eval run measures against YOUR baseline.

## Why this matters

The first four fixtures test extreme cases — heavy impostor, heavy catastrophizing, heavy passive. They tell you whether the pipeline can DETECT patterns when they're clearly present.

This fixture tests whether the pipeline stays STABLE on a real, mixed, in-between answer. If a prompt edit shifts your self_focus_ratio from 0.18 to 0.28, something drifted — even if the impostor / catastrophizing fixtures still pass.

## Template

When you've recorded your audio, copy this template into `ground_truth.yaml` and edit:

```yaml
description: >
  Anchor recording — Kevin's own take on Q1 (the celebration question).
  Tolerances calibrated against the first eval run on 2026-MM-DD.

expected:
  themes:
    - <your-strongest-theme>
    - <your-second-theme>

  limiting_beliefs: []      # or list any that surfaced
  thinking_patterns: []     # or list any that surfaced

  hedge_count:
    value: <observed>
    tolerance: 3
  certainty_count:
    value: <observed>
    tolerance: 3
  self_focus_ratio:
    value: <observed>
    tolerance: 0.05

  sentiment_score:
    value: <observed>
    tolerance: 10
  sentiment_category: <observed>

  dominant_emotion_oneof:
    - <observed-emotion>
```
