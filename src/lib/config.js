import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGINS: z.string().default('http://localhost:3000'),
  MONGODB_URI: z.string().min(10),
  SESSION_SECRET: z.string().min(32),
  HTTP_RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(5000).default(180),
  SOCKET_RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(1000).default(90)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration.');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  origins: parsed.data.APP_ORIGINS
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
};
