import { BRAIN_COLD_AFTER_MS } from "./brain-config";

type WarmState = { lastWarmAt: number };

function state(): WarmState {
  const g = globalThis as typeof globalThis & { __brainWarmState?: WarmState };
  if (!g.__brainWarmState) g.__brainWarmState = { lastWarmAt: 0 };
  return g.__brainWarmState;
}

export function shouldWarmBrain(): boolean {
  return Date.now() - state().lastWarmAt > BRAIN_COLD_AFTER_MS;
}

export function markBrainWarmed(): void {
  state().lastWarmAt = Date.now();
}
