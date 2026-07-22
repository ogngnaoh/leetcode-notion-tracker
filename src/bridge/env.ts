import { z } from 'zod';

const BridgeEnvSchema = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_MANIFEST_PATH: z.string().default('build/notion-manifest.json'),
  BRIDGE_TOKEN: z.string().min(24),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DAILY_NEW_PROBLEM_GOAL: z
    .string()
    .default('10')
    .refine((value) => /^[1-9]\d*$/.test(value))
    .transform(Number)
    .refine(
      (value) => Number.isSafeInteger(value) && value <= 100,
      'DAILY_NEW_PROBLEM_GOAL must be an integer from 1 through 100.',
    ),
});

export type BridgeEnv = z.infer<typeof BridgeEnvSchema>;

export function readBridgeEnv(source: NodeJS.ProcessEnv = process.env): BridgeEnv {
  return BridgeEnvSchema.parse(source);
}
