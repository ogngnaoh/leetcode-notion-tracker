import { z } from 'zod';
import {
  CaptureEventSchema,
  type CaptureEvent,
  type CaptureResult,
  type ProblemStatus,
} from '../../src/shared/contract.js';
import type { DashboardSnapshot } from '../../src/tracker/review.js';

export interface ReviewPreferences {
  dailyNewProblemGoal: number;
  newProblemSessionStartedAt?: string;
}

export interface NotionConnectionState {
  configured: boolean;
  unlocked: boolean;
  hasPending: boolean;
  reconciliationRequired: boolean;
  lockFailed: boolean;
  vaultId: string | null;
  generation: string;
}

export interface CaptureSource {
  tabId: number;
  fingerprint: string;
  navigationId?: number;
}

export interface PendingView {
  event: CaptureEvent;
  source: CaptureSource;
  state: 'prepared' | 'saving' | 'needs-verification';
  disposition: 'retry' | 'check';
  createdAt: string;
  message?: string;
}

export interface CompletedView {
  eventId: string;
  bodyDigest: string;
  result: CaptureResult;
  source: CaptureSource;
  completedAt: string;
}

export interface NotionState {
  stateRevision: number;
  connection: NotionConnectionState;
  busy: boolean;
  pending: PendingView | null;
  completed: CompletedView | null;
  preferences: ReviewPreferences | null;
  review: DashboardSnapshot | null;
  problemStatus?: { slug: string; status: ProblemStatus };
}

const utf8 = (value: string) => new TextEncoder().encode(value).byteLength;
const passphrase = z
  .string()
  .min(16)
  .max(1024)
  .refine((v) => utf8(v) <= 1024);
const token = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => utf8(v) <= 4096 && !/[\r\n\s]/.test(v));
const source = z
  .object({
    tabId: z.number().int().nonnegative(),
    fingerprint: z.string().min(1).max(512),
    navigationId: z.number().int().nonnegative().optional(),
  })
  .strict();
const envelope = {
  type: z.literal('lctrack.notion'),
  version: z.literal(1),
  id: z.string().min(1).max(128),
};
const command = <const O extends string, T extends z.ZodRawShape>(op: O, fields: T) =>
  z.object({ ...envelope, op: z.literal(op), ...fields }).strict();

const requestSchema = z.union([
  command('connection.state', {}),
  command('connection.connect', {
    manifest: z.unknown(),
    preferences: z.unknown().optional(),
    token,
    passphrase,
  }),
  command('connection.unlock', { passphrase }),
  command('connection.lock', {}),
  command('connection.changePassphrase', { oldPassphrase: passphrase, newPassphrase: passphrase }),
  command('connection.replaceToken', { token }),
  command('connection.disconnect', { confirmUncertain: z.boolean() }),
  command('connection.acknowledgeReconciliation', { confirmed: z.literal(true) }),
  command('capture.submit', { event: CaptureEventSchema, source }),
  command('capture.pending', {}),
  command('capture.retry', { eventId: z.string().uuid() }),
  command('capture.check', { eventId: z.string().uuid() }),
  command('problem.status', {
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9-]+$/),
  }),
  command('review.read', {}),
  command('review.refresh', {}),
  command('preferences.setGoal', { goal: z.number().int().min(1).max(100) }),
  command('preferences.resetSession', {}),
]);

export type NotionRequest = z.infer<typeof requestSchema>;
type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'type' | 'version' | 'id'> : never;
export type NotionOperation = WithoutEnvelope<NotionRequest>;
export type NotionResponse = {
  version: 1;
  id: string;
  vaultId: string | null;
  generation: string;
} & ({ ok: true; data: NotionState } | { ok: false; code: string; message: string });

export interface NotionChanged {
  type: 'lctrack.notion.changed';
  stateRevision: number;
  busy: boolean;
  connection: NotionConnectionState;
}

export function parseNotionRequest(value: unknown): NotionRequest {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error('Invalid LCTrack request.');
  }
  if (!encoded || utf8(encoded) > 150 * 1024) throw new Error('LCTrack request is too large.');
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid or unsupported LCTrack request.');
  if ('event' in parsed.data && utf8(JSON.stringify(parsed.data.event)) > 128 * 1024) {
    throw new Error('Confirmed attempt is too large.');
  }
  return parsed.data;
}

export function isNotionSender(
  sender: { id?: string; url?: string; tab?: { incognito?: boolean } },
  extensionId: string,
): boolean {
  if (sender.id !== extensionId || sender.tab?.incognito || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === 'chrome-extension:' &&
      url.hostname === extensionId &&
      url.pathname === '/sidepanel.html' &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}
