import type { NextConfig } from 'next'
import createMDX from '@next/mdx'

const nextConfig: NextConfig = {
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  async redirects() {
    return [
      {
        source: '/vs/duct-tape-stack',
        destination: '/blog/duct-tape-stack',
        permanent: true,
      },
      // Old category slugs → new SEO-friendly slugs
      { source: '/features/your-day',        destination: '/features/dog-training-scheduling',      permanent: true },
      { source: '/features/training',        destination: '/features/dog-training-session-notes',   permanent: true },
      { source: '/features/clients',         destination: '/features/dog-training-client-app',      permanent: true },
      { source: '/features/business',        destination: '/features/dog-trainer-new-clients',      permanent: true },
      { source: '/features/team',            destination: '/features/dog-training-team-management', permanent: true },
      { source: '/features/scheduling',      destination: '/features/dog-training-scheduling',      permanent: true },
      { source: '/features/session-notes',   destination: '/features/dog-training-session-notes',   permanent: true },
      { source: '/features/client-app',      destination: '/features/dog-training-client-app',      permanent: true },
      { source: '/features/payments',        destination: '/features/dog-trainer-new-clients',      permanent: true },
      { source: '/features/dog-trainer-payments', destination: '/features/dog-trainer-new-clients', permanent: true },
      { source: '/features/team-management', destination: '/features/dog-training-team-management', permanent: true },
    ]
  },
}

const withMDX = createMDX({
  extension: /\.(md|mdx)$/,
  options: {
    remarkPlugins: [['remark-gfm']],
  },
})

export default withMDX(nextConfig)
