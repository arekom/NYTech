/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  // Keep ffmpeg-static OUT of the webpack bundle. If it's inlined, its
  // __dirname-based binary path resolves next to the route file
  // (.next/server/app/api/analyze/ffmpeg) instead of node_modules, and the
  // spawn fails with ENOENT. As an external package it's required at runtime
  // from node_modules, so ffmpegPath points at the real binary location.
  serverExternalPackages: ["ffmpeg-static"],
  // The binary itself is a data file, not a JS require, so output file tracing
  // won't pick it up automatically — include it explicitly for the route. The
  // glob covers whichever platform binary ffmpeg-static installed (e.g.
  // `ffmpeg` on Vercel's Linux build).
  outputFileTracingIncludes: {
    "/api/analyze": ["./node_modules/ffmpeg-static/**"],
  },
};

module.exports = nextConfig;
