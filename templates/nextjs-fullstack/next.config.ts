import type { NextConfig } from 'next';

const previewHost = process.env.PREVIEW_HOST;

const nextConfig: NextConfig = {
  devIndicators: false,

  images: { unoptimized: true },

  allowedDevOrigins: [
    ...(previewHost ? [previewHost] : []),

    '*.daytonaproxy01.net',
    '*.daytona.work',
    '*.daytona.app',
    '*.proxy.daytona.work',
    'localhost',
  ],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
        ],
      },
    ];
  },
};

export default nextConfig;
