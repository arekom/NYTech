import { NextResponse } from "next/server";
import { submitBrainWarmup } from "@/lib/brain-warm";

export const runtime = "nodejs";
export const maxDuration = 10; // fast — only submits /run, no poll

export async function POST() {
  try {
    const result = await submitBrainWarmup();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[brain/warmup] failed:", err);
    return NextResponse.json(
      { action: "error", message: err instanceof Error ? err.message : "warmup failed" },
      { status: 502 }
    );
  }
}
