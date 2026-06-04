import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Inter is the closest free substitute for Neue Haas Grotesk Display Pro,
// the licensed brand face called out in the Space of Mind brand book.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-feature",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Space of Mind — Future Self Studio",
  description:
    "Record a message to the version of you on the other side of the pattern. Space of Mind makes mental fitness measurable.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#F7F7FF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetBrainsMono.variable}`}>
      {/* suppressHydrationWarning: Grammarly + similar extensions inject
          attributes on <body> after SSR (data-new-gr-c-s-check-loaded,
          data-gr-ext-installed, etc.), which trips React's hydration
          mismatch check. We can't control extensions; suppress is the
          documented escape hatch and only affects this one element. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
