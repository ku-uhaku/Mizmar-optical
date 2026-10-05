import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import path from 'node:path';

/** Migrate + seed the dedicated test database once before the e2e suites run. */
export default async function globalSetup() {
  config({ path: path.resolve(__dirname, '../../../.env') });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set');
  const env = { ...process.env, DATABASE_URL: url };
  const cwd = path.resolve(__dirname, '..');
  execSync('node_modules/.bin/prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('node_modules/.bin/tsx prisma/seed.ts', { cwd, env, stdio: 'pipe' });
}
