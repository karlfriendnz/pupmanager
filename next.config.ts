import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
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
