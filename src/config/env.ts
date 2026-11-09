import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z
    .string()
    .regex(/^\d+$/, 'PORT must be a numeric string')
    .default('3000')
    .transform(Number),
  DB_HOST: z.string().min(1, 'DB_HOST is required'),
  DB_PORT: z
    .string()
    .regex(/^\d+$/, 'DB_PORT must be a numeric string')
    .default('5432')
    .transform(Number),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DB_POOL_MAX: z
    .string()
    .regex(/^\d+$/, 'DB_POOL_MAX must be a numeric string')
    .default('10')
    .transform(Number),
  JWT_ACCESS_SECRET: z
    .string()
    .min(16, 'JWT_ACCESS_SECRET must be at least 16 characters')
    .default('univoice_dev_jwt_access_secret_key_32bytes_min!'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters')
    .default('univoice_dev_jwt_refresh_secret_key_32bytes_min!'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`[config] Missing or invalid environment variables:\n${missing}`);
  process.exit(1);
}

// In production, reject development fallback secrets
if (parsed.data.NODE_ENV === 'production') {
  if (
    parsed.data.JWT_ACCESS_SECRET.startsWith('univoice_dev_') ||
    parsed.data.JWT_REFRESH_SECRET.startsWith('univoice_dev_')
  ) {
    console.error(
      '[config] In production, JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set to custom strong secrets.',
    );
    process.exit(1);
  }
}

export const env = parsed.data;
