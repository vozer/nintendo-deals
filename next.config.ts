import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.nintendo.com',
        pathname: '/eu/media/images/**',
      },
    ],
  },
};

export default nextConfig;
