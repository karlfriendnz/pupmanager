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
  // Don't advertise the framework in the X-Powered-By header.
  poweredByHeader: false,
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
      {
        // Security headers for the whole app EXCEPT the embeddable /form pages.
        // X-Frame-Options blocks clickjacking (the native shell loads the app as
        // the top-level document, so it's unaffected). nosniff stops MIME
        // sniffing; Referrer-Policy trims referrer leakage. (A full CSP is a
        // separate, carefully-tested follow-up — it needs Next.js nonces.)
        source: '/((?!form/).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
};

export default nextConfig;
