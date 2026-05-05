import type { NextConfig } from 'next'
import path from 'path'
import createMDX from '@next/mdx'

const nextConfig: NextConfig = {
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  // Pin tracing root to this subdirectory so Vercel's monorepo detection
  // doesn't pull files from the sibling main app (which has next-auth etc.
  // that aren't in this project's deps).
  outputFileTracingRoot: path.resolve(__dirname),
}

const withMDX = createMDX({
  extension: /\.(md|mdx)$/,
})

export default withMDX(nextConfig)
