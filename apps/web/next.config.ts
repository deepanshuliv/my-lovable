import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
  try {
    process.loadEnvFile(rootEnv);
  } catch {}
}

const nextConfig: NextConfig = {
  reactStrictMode: true,

  devIndicators: false,

  output: 'standalone',
};

export default nextConfig;
