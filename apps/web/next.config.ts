import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

// Monorepo: read the single root .env (Next only looks inside apps/<app> by default).
loadEnvConfig(path.resolve(__dirname, '../..'));

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
  images: { remotePatterns: [{ protocol: 'http', hostname: 'localhost' }, { protocol: 'https', hostname: '**' }] },
};

export default withNextIntl(config);
