import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  FRONTEND_ORIGIN: z
    .url()
    .refine((value) => new URL(value).origin === value, 'must be an origin without a path')
    .default('http://localhost:5173'),
  MONGODB_URI: z
    .string()
    .trim()
    .min(1, 'is required')
    .refine(
      (value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'),
      'must use the mongodb:// or mongodb+srv:// scheme',
    ),
  JWT_SECRET: z.string().min(32, 'must contain at least 32 characters'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `- ${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('\n');

  console.error(`Invalid backend environment configuration:\n${details}`);
  throw new Error('Backend environment validation failed. Review the messages above.');
}

export const env = Object.freeze(result.data);
