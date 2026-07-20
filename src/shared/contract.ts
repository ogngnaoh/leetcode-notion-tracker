import { z } from 'zod';

export const DifficultySchema = z.enum(['Easy', 'Medium', 'Hard', 'Unknown']);
export const AttemptResultSchema = z.enum(['Couldn’t solve', 'Needed help', 'Solved']);
export const PracticeStateSchema = z.enum([
  'New',
  'Couldn’t solve',
  'Needed help',
  'Solved',
  'Mastered',
]);

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const CalendarDateSchema = z
  .string()
  .refine(isCalendarDate, 'Expected a valid YYYY-MM-DD calendar date.');

export const ProblemSnapshotSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9-]+$/, 'Expected a LeetCode problem slug.'),
    // Display title only; the LeetCode problem number belongs in `number`.
    title: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine(
        (value) => !/^\d+\s*\.\s*/.test(value),
        'Problem title must not include the LeetCode problem number.',
      ),
    number: z.number().int().positive().nullable().optional(),
    url: z
      .string()
      .url()
      .refine((value) => new URL(value).hostname === 'leetcode.com', {
        message: 'Problem URL must be on leetcode.com.',
      }),
    difficulty: DifficultySchema,
    topics: z.array(z.string().trim().min(1).max(100)),
  })
  .strict();

export const AttemptInputSchema = z
  .object({
    attemptedAt: z.string().datetime({ offset: true }),
    attemptedOn: CalendarDateSchema,
    language: z.string().trim().min(1).max(50),
    code: z
      .string()
      .min(1)
      .max(20_000)
      .refine((value) => value.trim().length > 0, 'Code must not be blank.'),
    result: AttemptResultSchema,
  })
  .strict();

export const CaptureEventSchema = z
  .object({
    clientEventId: z.string().uuid(),
    problem: ProblemSnapshotSchema,
    attempt: AttemptInputSchema,
  })
  .strict();

export const ReviewStateSchema = z
  .object({
    practiceState: PracticeStateSchema,
    solvedStreak: z.number().int().min(0).max(5),
    nextReview: CalendarDateSchema.nullable(),
  })
  .strict();

export const CaptureResultSchema = z
  .object({
    duplicate: z.boolean(),
    problemPageId: z.string().min(1),
    attemptPageId: z.string().min(1),
    review: ReviewStateSchema,
  })
  .strict();

export const ProblemStatusSchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }).strict(),
  z
    .object({
      found: z.literal(true),
      practiceState: PracticeStateSchema,
      solvedStreak: z.number().int().min(0).max(5),
      nextReview: CalendarDateSchema.nullable(),
      lastAttempt: z.string().datetime({ offset: true }).nullable(),
    })
    .strict(),
]);

export const NotionManifestSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  notionApiVersion: z.literal('2026-03-11'),
  createdAt: z.string().datetime({ offset: true }),
  parentPageId: z.string().min(1),
  problems: z.object({
    databaseId: z.string().min(1),
    dataSourceId: z.string().min(1),
  }),
  attempts: z.object({
    databaseId: z.string().min(1),
    dataSourceId: z.string().min(1),
  }),
});

export type Difficulty = z.infer<typeof DifficultySchema>;
export type AttemptResult = z.infer<typeof AttemptResultSchema>;
export type PracticeState = z.infer<typeof PracticeStateSchema>;
export type ProblemSnapshot = z.infer<typeof ProblemSnapshotSchema>;
export type AttemptInput = z.infer<typeof AttemptInputSchema>;
export type CaptureEvent = z.infer<typeof CaptureEventSchema>;
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export type CaptureResult = z.infer<typeof CaptureResultSchema>;
export type ProblemStatus = z.infer<typeof ProblemStatusSchema>;
export type NotionManifest = z.infer<typeof NotionManifestSchema>;
