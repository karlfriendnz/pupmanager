import type { NextConfig } from "next";
import path from "path";

// Unique per build. Inlined into the client bundle (NEXT_PUBLIC_) AND
// readable server-side, so a stale client can detect it's running an
// older build than what's deployed and prompt a reload. Prefer the
// Vercel git SHA when present; fall back to a build timestamp (covers
// CLI `vercel deploy` which has no git context).
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || `t${Date.now()}`

const nextConfig: NextConfig = {
  // E2E builds set E2E_DIST_DIR so their production build/start lives in a
  // separate folder and never collides with a running `next dev` (.next).
  // Unset in normal dev/prod → defaults to .next.
  distDir: process.env.E2E_DIST_DIR || '.next',
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Hide the dev-mode "N" badge so it doesn't show up in screenshots.
  // Remove this when you're done with marketing screenshots.
  devIndicators: false,
  async headers() {
    return [
      {
        // Allow /form/* pages to be embedded in iframes from any origin
        source: '/form/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: "frame-ancestors *" },
        ],
      },
    ]
  },
};

export default nextConfig;
