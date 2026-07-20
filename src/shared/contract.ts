import { z } from 'zod';

export const DifficultySchema = z.enum(['Easy', 'Medium', 'Hard', 'Unknown']);
export const OutcomeSchema = z.enum(['Red', 'Yellow', 'Green']);
export const MasterySchema = z.enum(['Unseen', 'Red', 'Yellow', 'Green', 'Mastered']);
export const HelpUsedSchema = z.enum([
  'None',
  'Pattern Hint',
  'Conceptual Hint',
  'Pseudocode',
  'Editorial',
  'Code Viewed',
]);
export const FailureCodeSchema = z.enum([
  'P — Pattern Recognition',
  'A — Algorithm / Invariant',
  'I — Implementation / Syntax',
  'E — Edge Cases / Testing',
  'T — Time Management',
  'C — Communication',
]);
export const SubmissionResultSchema = z.enum([
  'Accepted',
  'Wrong Answer',
  'Time Limit Exceeded',
  'Memory Limit Exceeded',
  'Runtime Error',
  'Compile Error',
  'Not Submitted',
]);

export const ProblemSnapshotSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9-]+$/, 'Expected a LeetCode problem slug.'),
  title: z.string().trim().min(1).max(240),
  number: z.number().int().positive().nullable().optional(),
  url: z
    .string()
    .url()
    .refine((value) => new URL(value).hostname === 'leetcode.com', {
      message: 'Problem URL must be on leetcode.com.',
    }),
  difficulty: DifficultySchema,
});

export const AttemptInputSchema = z.object({
  attemptedAt: z.string().datetime({ offset: true }),
  language: z.string().trim().min(1).max(50),
  submissionResult: SubmissionResultSchema.default('Not Submitted'),
  outcome: OutcomeSchema,
  coldAttempt: z.boolean().default(true),
  helpUsed: HelpUsedSchema.default('None'),
  failureCode: FailureCodeSchema.nullable().optional(),
  totalMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  primaryPattern: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  code: z.string().max(20_000).nullable().optional(),
});

export const CaptureEventSchema = z.object({
  clientEventId: z.string().uuid(),
  problem: ProblemSnapshotSchema,
  attempt: AttemptInputSchema,
});

export const ReviewStateSchema = z.object({
  mastery: MasterySchema,
  greenCount: z.number().int().min(0),
  nextReview: z.string().datetime({ offset: true }).nullable(),
});

export const CaptureResultSchema = z.object({
  duplicate: z.boolean(),
  problemPageId: z.string().min(1),
  attemptPageId: z.string().min(1),
  review: ReviewStateSchema,
});

export const NotionManifestSchema = z.object({
  version: z.literal(1),
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
export type Outcome = z.infer<typeof OutcomeSchema>;
export type Mastery = z.infer<typeof MasterySchema>;
export type HelpUsed = z.infer<typeof HelpUsedSchema>;
export type FailureCode = z.infer<typeof FailureCodeSchema>;
export type SubmissionResult = z.infer<typeof SubmissionResultSchema>;
export type ProblemSnapshot = z.infer<typeof ProblemSnapshotSchema>;
export type AttemptInput = z.infer<typeof AttemptInputSchema>;
export type CaptureEvent = z.infer<typeof CaptureEventSchema>;
export type ReviewState = z.infer<typeof ReviewStateSchema>;
export type CaptureResult = z.infer<typeof CaptureResultSchema>;
export type NotionManifest = z.infer<typeof NotionManifestSchema>;
