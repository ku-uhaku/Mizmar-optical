import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('true').transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3002'),
  /** Express `trust proxy`: hops ("1"), "true", "loopback", or a subnet list. Unset = trust nobody (correct when exposed directly). */
  TRUST_PROXY: z.string().optional(),
  THROTTLE_TTL: z.coerce.number().default(60),
  THROTTLE_LIMIT: z.coerce.number().default(600),
  THROTTLE_AUTH_LIMIT: z.coerce.number().default(10),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET: z.string().default('mizmar'),
  S3_FORCE_PATH_STYLE: bool,
  S3_PUBLIC_URL: z.string().url().optional(),
  DEFAULT_LOCALE: z.string().default('fr'),
  DEFAULT_CURRENCY: z.string().default('MAD'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@mizmar.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe!2026'),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_URL: z.string().url().default('http://localhost:3002'),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule: fail fast on boot with a readable message. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
