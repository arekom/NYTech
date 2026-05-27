"use client";

/**
 * Space of Mind brand lockup.
 *
 * Renders the official white-on-transparent PNG, then re-tints it via a CSS
 * filter chain. Default tone is Core Dark (`#1B1B2F` — Quiet Lavender 100,
 * the brand's primary ink). Pass `tone="white"` to keep the original asset
 * for use on dark surfaces.
 *
 * The asset lives in `public/brand/logo-white.png` so Next.js serves it
 * directly. The source-of-truth remains under `assets/`.
 */
type Tone = "core-dark" | "lavender" | "white";

type Props = {
  /** Pixel height of the lockup. Width auto-scales by aspect ratio. */
  height?: number;
  /** Brand color preset. */
  tone?: Tone;
  className?: string;
  ariaLabel?: string;
};

// Source PNG dimensions
const SRC_WIDTH = 453;
const SRC_HEIGHT = 49;

const FILTERS: Record<Tone, string | undefined> = {
  // From white → #1B1B2F (Core Dark / Quiet Lavender 100). Derived from a
  // CSS-filter color matcher. brightness(0) collapses any color to black,
  // then sepia + hue-rotate + saturate dial in the cool blue cast.
  "core-dark":
    "brightness(0) saturate(100%) invert(8%) sepia(28%) saturate(2057%) hue-rotate(218deg) brightness(94%) contrast(94%)",
  // From white → #B4B4DB (Quiet Lavender — primary accent)
  lavender:
    "brightness(0) saturate(100%) invert(83%) sepia(8%) saturate(1247%) hue-rotate(202deg) brightness(96%) contrast(89%)",
  white: undefined,
};

export default function Logo({
  height = 28,
  tone = "core-dark",
  className,
  ariaLabel = "Space of Mind",
}: Props) {
  return (
    <img
      src="/brand/logo-white.png"
      width={SRC_WIDTH}
      height={SRC_HEIGHT}
      alt={ariaLabel}
      className={className}
      draggable={false}
      style={{
        display: "block",
        height,
        width: "auto",
        filter: FILTERS[tone],
        userSelect: "none",
      }}
    />
  );
}
