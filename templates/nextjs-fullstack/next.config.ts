import type { NextConfig } from 'next';

/**
 * The dev server here is not reached directly. It listens on port 3000 inside a Daytona
 * sandbox, and the user sees it through Daytona's TLS proxy on a completely different
 * hostname, embedded in an iframe.
 *
 * Two consequences, both handled below:
 *
 *  - Next treats requests whose Origin does not match the dev host as cross-origin and
 *    refuses to serve dev assets to them. `allowedDevOrigins` is what makes hot reload
 *    work through the proxy at all — without it the HMR requests are rejected and the
 *    preview silently stops updating.
 *  - The page is framed, so any header that forbids framing would blank the preview.
 */
/**
 * The platform sets PREVIEW_HOST to the exact hostname this app will be reached on before
 * starting the dev server, because that hostname is assigned by the sandbox provider and
 * cannot be known when this file is written. The fallbacks are only a safety net.
 */
const previewHost = process.env.PREVIEW_HOST;

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    ...(previewHost ? [previewHost] : []),
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
          // Explicitly permissive: the preview is meant to be framed by the builder UI.
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
        ],
      },
    ];
  },
};

export default nextConfig;
