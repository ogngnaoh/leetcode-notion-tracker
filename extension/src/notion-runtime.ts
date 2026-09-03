import { z } from 'zod';
import {
  CaptureEventSchema,
  CaptureResultSchema,
  type CaptureEvent,
} from '../../src/shared/contract.js';
import { CaptureService } from '../../src/tracker/capture-service.js';
import { NotionCaptureRepository } from '../../src/tracker/notion-repository.js';
import { localDate, type DashboardSnapshot } from '../../src/tracker/review.js';
import {
  NotionVault,
  VaultError,
  type VaultData,
  type VaultPublicState,
  type VaultStorageArea,
} from './notion-vault.js';
import {
  ConnectionError,
  parseConnectionManifest,
  parseReviewPreferences,
  verifyNotionConnection,
} from './notion-connection.js';
import {
  NotionTransport,
  NotionTransportError,
  type NotionOperationContext,
} from './notion-transport.js';
import {
  NotionMutationGateway,
  NotionRecoveryError,
  MutationCheckpointsSchema,
  type MutationCheckpoint,
} from './notion-recovery.js';
import {
  isNotionSender,
  parseNotionRequest,
  type NotionRequest,
  type NotionResponse,
  type NotionState,
  type PendingView,
  type CompletedView,
  type ReviewPreferences,
  type NotionChanged,
} from './notion-protocol.js';

const CACHE_KEY = 'lctrack.notion.private.review.v1';
const COOLDOWN_KEY = 'lctrack.notion.cooldown.v1';
const REVISION_KEY = 'lctrack.notion.stateRevision.v1';
const sourceSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    fingerprint: z.string().min(1).max(512),
    navigationId: z.number().int().nonnegative().optional(),
  })
  .strict();
const completedSchema = z
  .object({
    eventId: z.string().uuid(),
    bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    result: CaptureResultSchema,
    source: sourceSchema,
    completedAt: z.string().datetime(),
  })
  .strict();
const pendingSchema = z
  .object({
    event: CaptureEventSchema,
    source: sourceSchema,
    bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(['prepared', 'saving', 'needs-verification']),
    disposition: z.enum(['retry', 'check']),
    createdAt: z.string().datetime(),
    message: z.string().max(300).optional(),
    dispatched: z.boolean(),
    checkpoints: MutationCheckpointsSchema,
  })
  .strict();
const snapshotSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    goal: z.number().int().min(1).max(100),
    newProblemCount: z.number().int().nonnegative().max(5000),
    generatedAt: z.string().datetime(),
    stale: z.boolean(),
    due: z
      .array(
        z
          .object({
            title: z.string().max(1000),
            url: z.string().url(),
            difficulty: z.enum(['Easy', 'Medium', 'Hard', 'Unknown']),
            practiceState: z.enum(['New', 'Needed help', 'Solved', 'Mastered']),
            solvedStreak: z.number().int().min(0).max(5),
            nextReview: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();

interface PendingCapture extends PendingView {
  bodyDigest: string;
  dispatched: boolean;
  checkpoints: MutationCheckpoint[];
}
export interface RuntimeVaultData extends VaultData {
  preferences: ReviewPreferences;
  preferenceRevision: number;
  pending: PendingCapture | null;
  completed: CompletedView | null;
}

function validateData(value: unknown): RuntimeVaultData {
  const parsed = z
    .object({
      token: z.string().min(1).max(4096),
      manifest: z.unknown(),
      preferences: z.unknown(),
      preferenceRevision: z.number().int().nonnegative(),
      pending: pendingSchema.nullable(),
      completed: completedSchema.nullable(),
    })
    .strict()
    .parse(value);
  return {
    ...parsed,
    manifest: parseConnectionManifest(parsed.manifest),
    preferences: parseReviewPreferences(parsed.preferences),
  } as RuntimeVaultData;
}

class RuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function safeError(error: unknown): { code: string; message: string } {
  if (
    error instanceof RuntimeError ||
    error instanceof VaultError ||
    error instanceof ConnectionError ||
    error instanceof NotionRecoveryError ||
    error instanceof NotionTransportError
  )
    return { code: error.code, message: error.message };
  const status =
    error !== null && typeof error === 'object' && 'status' in error ? error.status : null;
  if (status === 401)
    return {
      code: 'AUTHENTICATION',
      message: 'Notion rejected the saved credential. Replace the token in Settings.',
    };
  if (status === 403)
    return {
      code: 'PERMISSION',
      message:
        'Notion denied this operation. Check the integration capabilities and shared databases.',
    };
  if (status === 429 || status === 529)
    return {
      code: 'RATE_LIMITED',
      message: 'Notion asked LCTrack to wait. Retry the same attempt later.',
    };
  if (status === 409)
    return {
      code: 'CAPACITY',
      message:
        'Notion could not complete this operation now. Check the pending result before retrying.',
    };
  return {
    code: 'UNAVAILABLE',
    message:
      'The Notion operation could not be completed. Any pending save is preserved; check it before retrying.',
  };
}

async function digest(event: CaptureEvent): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(event))),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

interface Options {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  changed?: (event: NotionChanged) => void | Promise<void>;
}

/** A worker-local coordinator; encrypted storage is authoritative across worker retirement. */
export class NotionRuntime {
  readonly vault: NotionVault<RuntimeVaultData>;
  private readonly transport: NotionTransport;
  private readonly now: () => number;
  private busy = false;
  private epoch = 0;
  private active: AbortController | null = null;
  private review: DashboardSnapshot | null = null;
  private reviewIdentity = '';
  private privateRevision = 0;
  private stateRevision = 0;
  private revisionTail: Promise<void> = Promise.resolve();
  private reviewTask: Promise<void> | null = null;
  private problemStatus: NotionState['problemStatus'];
  private cacheTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: { local: VaultStorageArea; session: VaultStorageArea },
    private readonly options: Options = {},
  ) {
    this.now = options.now ?? Date.now;
    this.vault = new NotionVault<RuntimeVaultData>(storage, {
      validateData,
      purgePrivate: async () => {
        this.clearPrivate();
        await this.purgeCache();
      },
    });
    this.transport = new NotionTransport({
      ...(options.fetch ? { fetch: options.fetch } : {}),
      now: this.now,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      loadCooldown: async () => {
        const value = (await storage.local.get(COOLDOWN_KEY))[COOLDOWN_KEY];
        if (value === undefined) return 0;
        if (
          !value ||
          typeof value !== 'object' ||
          !('until' in value) ||
          typeof value.until !== 'number' ||
          !Number.isFinite(value.until)
        )
          throw new VaultError('STORAGE_FAILURE');
        return value.until;
      },
      saveCooldown: async (until) => {
        // Retain a conservative profile-wide cooldown even through token replacement/disconnect.
        await storage.local.set({ [COOLDOWN_KEY]: { until } });
        const saved = (await storage.local.get(COOLDOWN_KEY))[COOLDOWN_KEY] as
          { until?: number } | undefined;
        if (saved?.until !== until) throw new VaultError('STORAGE_FAILURE');
      },
    });
  }

  async handle(
    message: unknown,
    sender: { id?: string; url?: string; tab?: { incognito?: boolean } },
    extensionId: string,
  ): Promise<NotionResponse> {
    const id =
      message &&
      typeof message === 'object' &&
      'id' in message &&
      typeof message.id === 'string' &&
      message.id.length <= 128
        ? message.id
        : '';
    const identity = () => ({
      version: 1 as const,
      id,
      vaultId: this.vault.vaultId,
      generation: this.vault.generation,
    });
    if (!isNotionSender(sender, extensionId))
      return {
        ...identity(),
        ok: false,
        code: 'FORBIDDEN',
        message: 'Notion commands are accepted only from the LCTrack sidebar in a normal profile.',
      };
    let request: NotionRequest;
    try {
      request = parseNotionRequest(message);
    } catch {
      return {
        ...identity(),
        ok: false,
        code: 'INVALID_REQUEST',
        message: 'Invalid or unsupported LCTrack request.',
      };
    }
    try {
      await this.execute(request);
      return { ...identity(), ok: true, data: await this.state() };
    } catch (error) {
      return { ...identity(), ok: false, ...safeError(error) };
    }
  }

  private clearPrivate(): void {
    this.privateRevision++;
    this.review = null;
    this.reviewIdentity = '';
    this.problemStatus = undefined;
  }
  private async loadRevision(): Promise<void> {
    const value = (await this.storage.session.get(REVISION_KEY))[REVISION_KEY];
    if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0))
      throw new VaultError('STORAGE_FAILURE');
    this.stateRevision = Math.max(this.stateRevision, (value as number | undefined) ?? 0);
  }
  private changed(requirePublicState = false): Promise<void> {
    const next = this.revisionTail
      .catch(() => {})
      .then(async () => {
        try {
          await this.loadRevision();
          const revision = this.stateRevision + 1;
          await this.storage.session.set({ [REVISION_KEY]: revision });
          if ((await this.storage.session.get(REVISION_KEY))[REVISION_KEY] !== revision)
            throw new VaultError('STORAGE_FAILURE');
          this.stateRevision = revision;
        } catch {
          throw new VaultError('STORAGE_FAILURE');
        }
        // State acquisition is authoritative: Lock must fall back to a conservative
        // notification when local storage cannot confirm the public vault state.
        let connection: VaultPublicState;
        try {
          connection = await this.vault.publicState();
        } catch (error) {
          if (requirePublicState) throw error;
          return;
        }
        // Only notification delivery is best effort. The revision and state must be known first.
        try {
          await this.options.changed?.({
            type: 'lctrack.notion.changed',
            connection,
            busy: this.busy,
            stateRevision: this.stateRevision,
          });
        } catch {}
      });
    this.revisionTail = next;
    return next;
  }
  private assertEpoch(epoch: number): void {
    if (this.epoch !== epoch) throw new VaultError('LOCKED');
  }

  private async state(): Promise<NotionState> {
    const epoch = this.epoch;
    const revision = this.privateRevision;
    const stateRevision = this.stateRevision;
    const connection = await this.vault.publicState();
    const empty: NotionState = {
      stateRevision,
      connection,
      busy: this.busy,
      pending: null,
      completed: null,
      preferences: null,
      review: null,
    };
    if (!connection.unlocked) return empty;
    const data = await this.vault.read();
    await this.vault.assertAccess(connection.generation);
    this.assertEpoch(epoch);
    await this.hydrateReview(data, connection.generation);
    this.assertEpoch(epoch);
    await this.vault.assertAccess(connection.generation);
    if (revision !== this.privateRevision || stateRevision !== this.stateRevision)
      throw new RuntimeError('STALE_STATE', 'Notion state changed. Refresh the current view.');
    const pending = data.pending;
    return {
      ...empty,
      preferences: data.preferences,
      completed: data.completed,
      pending: pending
        ? {
            event: pending.event,
            source: pending.source,
            state:
              pending.state === 'saving' && !this.busy
                ? pending.dispatched
                  ? 'needs-verification'
                  : 'prepared'
                : pending.state,
            disposition: pending.checkpoints.some((item) => item.status === 'uncertain')
              ? 'check'
              : pending.disposition,
            createdAt: pending.createdAt,
            ...(pending.message ? { message: pending.message } : {}),
          }
        : null,
      review: this.review,
      ...(this.problemStatus ? { problemStatus: this.problemStatus } : {}),
    };
  }

  private async execute(request: NotionRequest): Promise<void> {
    if (request.op === 'connection.lock') {
      this.epoch++;
      this.active?.abort();
      this.clearPrivate();
      const locking = this.vault.lock();
      let lockError: unknown;
      try {
        await locking;
      } catch (error) {
        lockError = error;
        throw error;
      } finally {
        try {
          await this.changed(true);
        } catch {
          // The changed grant generation fences panels even if the nonsecret revision cannot persist.
          // Preserve the Lock result; a metadata failure must not conceal failed key removal.
          const connection = await this.vault.publicState().catch(() => ({
            configured: this.vault.vaultId !== null,
            unlocked: false,
            hasPending: true,
            reconciliationRequired: true,
            lockFailed: lockError !== undefined,
            vaultId: this.vault.vaultId,
            generation: this.vault.generation,
          }));
          try {
            await this.options.changed?.({
              type: 'lctrack.notion.changed',
              connection,
              busy: this.busy,
              stateRevision: this.stateRevision,
            });
          } catch {}
        }
      }
      return;
    }
    if (request.op === 'connection.state' || request.op === 'capture.pending') {
      await this.vault.initialize();
      await this.loadRevision();
      return;
    }
    if ((request.op === 'review.read' || request.op === 'review.refresh') && this.reviewTask) {
      await this.reviewTask;
      return;
    }
    if (this.busy) throw new RuntimeError('BUSY', 'Another Notion operation is still running.');
    this.busy = true;
    const epoch = this.epoch;
    const controller = new AbortController();
    this.active = controller;
    try {
      await this.changed();
      if (request.op === 'connection.disconnect') {
        this.epoch++;
        this.clearPrivate();
        await this.vault.disconnect(request.confirmUncertain);
        return;
      }
      await this.vault.initialize();
      this.assertEpoch(epoch);
      const generation = this.vault.generation;
      const context: NotionOperationContext = {
        signal: controller.signal,
        deadline: this.now() + 120_000,
        assertActive: async () => {
          this.assertEpoch(epoch);
          await this.vault.assertAccess(generation);
        },
      };
      switch (request.op) {
        case 'connection.connect': {
          const manifest = parseConnectionManifest(request.manifest);
          const preferences = parseReviewPreferences(request.preferences);
          if ((await this.vault.publicState()).configured)
            throw new VaultError('ALREADY_CONNECTED');
          const connectContext = { ...context, assertActive: () => this.assertEpoch(epoch) };
          await verifyNotionConnection(
            this.transport.createClient(request.token, connectContext),
            manifest,
          );
          this.assertEpoch(epoch);
          await this.vault.create(
            {
              token: request.token,
              manifest,
              preferences,
              preferenceRevision: 0,
              pending: null,
              completed: null,
            },
            request.passphrase,
          );
          this.assertEpoch(epoch);
          break;
        }
        case 'connection.unlock':
          await this.vault.unlock(request.passphrase);
          break;
        case 'connection.changePassphrase':
          await this.vault.changePassphrase(request.oldPassphrase, request.newPassphrase);
          break;
        case 'connection.replaceToken': {
          const data = await this.vault.read();
          await verifyNotionConnection(
            this.transport.createClient(request.token, context),
            data.manifest,
          );
          await context.assertActive();
          await this.vault.update((current) => ({ ...current, token: request.token }));
          break;
        }
        case 'connection.acknowledgeReconciliation':
          await this.vault.acknowledgeReconciliation();
          break;
        case 'preferences.setGoal':
        case 'preferences.resetSession': {
          await context.assertActive();
          await this.vault.update((current) => ({
            ...current,
            preferences:
              request.op === 'preferences.setGoal'
                ? { ...current.preferences, dailyNewProblemGoal: request.goal }
                : {
                    ...current.preferences,
                    newProblemSessionStartedAt: new Date(this.now()).toISOString(),
                  },
            preferenceRevision: current.preferenceRevision + 1,
          }));
          this.clearPrivate();
          await this.purgeCache().catch(() => {});
          break;
        }
        case 'problem.status': {
          const data = await this.vault.read();
          const repository = new NotionCaptureRepository(
            this.transport.createClient(data.token, context),
            data.manifest,
          );
          const status = await new CaptureService(repository).getProblemStatus(request.slug);
          await context.assertActive();
          this.problemStatus = { slug: request.slug, status };
          break;
        }
        case 'review.read':
        case 'review.refresh': {
          this.reviewTask = this.loadReview(request.op === 'review.refresh', context);
          try {
            await this.reviewTask;
          } finally {
            this.reviewTask = null;
          }
          break;
        }
        case 'capture.submit': {
          await context.assertActive();
          if ((await this.vault.publicState()).reconciliationRequired)
            throw new RuntimeError(
              'RECONCILIATION_REQUIRED',
              'Confirm manual reconciliation in Settings before making another save.',
            );
          const event = request.event;
          if (event.problem.url !== `https://leetcode.com/problems/${event.problem.slug}/`)
            throw new RuntimeError(
              'INVALID_REQUEST',
              'The confirmed problem URL must match its LeetCode slug.',
            );
          const bodyDigest = await digest(event);
          const data = await this.vault.read();
          if (data.completed?.eventId === event.clientEventId) {
            if (data.completed.bodyDigest !== bodyDigest)
              throw new RuntimeError(
                'EVENT_CONFLICT',
                'This attempt ID was already used with different content.',
              );
            break;
          }
          if (data.pending) {
            if (
              data.pending.event.clientEventId === event.clientEventId &&
              data.pending.bodyDigest !== bodyDigest
            )
              throw new RuntimeError(
                'EVENT_CONFLICT',
                'The pending attempt has different content. Its original snapshot is preserved.',
              );
            throw new RuntimeError(
              'PENDING_CAPTURE',
              'Resolve the pending save before confirming another attempt.',
            );
          }
          await this.vault.update((current) => ({
            ...current,
            pending: {
              event,
              source: {
                tabId: request.source.tabId,
                fingerprint: request.source.fingerprint,
                ...(request.source.navigationId !== undefined
                  ? { navigationId: request.source.navigationId }
                  : {}),
              },
              bodyDigest,
              createdAt: new Date(this.now()).toISOString(),
              state: 'prepared',
              disposition: 'retry',
              dispatched: false,
              checkpoints: [],
            },
          }));
          this.clearPrivate();
          await this.performCapture(event.clientEventId, false, context);
          break;
        }
        case 'capture.retry':
        case 'capture.check':
          if ((await this.vault.publicState()).reconciliationRequired)
            throw new RuntimeError(
              'RECONCILIATION_REQUIRED',
              'Confirm manual reconciliation in Settings first.',
            );
          await this.performCapture(request.eventId, request.op === 'capture.check', context);
          break;
      }
    } finally {
      this.busy = false;
      if (this.active === controller) this.active = null;
      await this.changed();
    }
  }

  private async performCapture(
    eventId: string,
    checkOnly: boolean,
    context: NotionOperationContext,
  ): Promise<void> {
    const data = await this.vault.read();
    const pending = data.pending;
    if (!pending || pending.event.clientEventId !== eventId) {
      if (data.completed?.eventId === eventId) return;
      throw new RuntimeError('NO_PENDING_CAPTURE', 'No matching pending save exists.');
    }
    if ((await digest(pending.event)) !== pending.bodyDigest) throw new VaultError('INVALID_VAULT');
    const update = async (transform: (current: PendingCapture) => PendingCapture) => {
      await context.assertActive();
      await this.vault.update((current) => {
        if (!current.pending || current.pending.event.clientEventId !== eventId)
          throw new VaultError('INVALID_VAULT');
        return { ...current, pending: transform(current.pending) };
      });
    };
    const gateway = new NotionMutationGateway({
      event: pending.event,
      manifest: data.manifest,
      store: {
        load: async () => {
          await context.assertActive();
          const current = await this.vault.read();
          if (current.pending?.event.clientEventId !== eventId)
            throw new VaultError('INVALID_VAULT');
          return current.pending.checkpoints;
        },
        save: async (checkpoints) => update((current) => ({ ...current, checkpoints })),
      },
      read: (request) => this.transport.request(request, data.token, context),
      assertActive: context.assertActive,
    });
    try {
      await gateway.check();
      if (checkOnly) {
        await update((current) => ({
          ...current,
          state: 'prepared',
          disposition: 'retry',
          message:
            'Checked the saved result. Retry the same attempt to finish any remaining writes.',
        }));
        return;
      }
      await update((current) => ({ ...current, state: 'saving', disposition: 'retry' }));
      const mutationContext = {
        ...context,
        beforeMutation: async () => {
          await context.assertActive();
          if (!pending.dispatched) {
            await update((current) => ({ ...current, dispatched: true }));
            pending.dispatched = true;
          }
        },
      };
      const repository = new NotionCaptureRepository(
        this.transport.createClient(data.token, mutationContext, gateway),
        data.manifest,
      );
      const result = await new CaptureService(repository).capture(pending.event);
      await context.assertActive();
      await this.vault.update((current) => {
        if (current.pending?.event.clientEventId !== eventId) throw new VaultError('INVALID_VAULT');
        return {
          ...current,
          pending: null,
          completed: {
            eventId,
            bodyDigest: pending.bodyDigest,
            result,
            source: pending.source,
            completedAt: new Date(this.now()).toISOString(),
          },
        };
      });
      this.clearPrivate();
      await this.purgeCache().catch(() => {});
    } catch (error) {
      const safe = safeError(error);
      try {
        await update((current) => ({
          ...current,
          state: current.dispatched ? 'needs-verification' : 'prepared',
          disposition: current.checkpoints.some((item) => item.status === 'uncertain')
            ? 'check'
            : 'retry',
          message: safe.message,
        }));
      } catch {
        /* Original durable journal remains authoritative after Lock or storage failure. */
      }
      throw error;
    }
  }

  private cacheIdentity(data: RuntimeVaultData, generation: string): string {
    return `${this.vault.vaultId}:${generation}:${data.preferenceRevision}:${data.completed?.eventId ?? ''}:${data.pending?.event.clientEventId ?? ''}:${localDate(new Date(this.now()))}`;
  }
  private serializeCache<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.cacheTail.catch(() => {}).then(operation);
    this.cacheTail = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  private purgeCache(): Promise<void> {
    return this.serializeCache(async () => {
      await this.storage.session.remove(CACHE_KEY);
      if ((await this.storage.session.get(CACHE_KEY))[CACHE_KEY] !== undefined)
        throw new VaultError('STORAGE_FAILURE');
    });
  }
  private persistReview(
    snapshot: DashboardSnapshot,
    identity: string,
    context: NotionOperationContext,
  ): Promise<void> {
    return this.serializeCache(async () => {
      await context.assertActive();
      await this.storage.session.set({ [CACHE_KEY]: { identity, snapshot } });
      await context.assertActive();
    });
  }
  private async hydrateReview(data: RuntimeVaultData, generation: string): Promise<void> {
    const epoch = this.epoch;
    const revision = this.privateRevision;
    const identity = this.cacheIdentity(data, generation);
    if (this.reviewIdentity === identity) return;
    const stored = (await this.storage.session.get(CACHE_KEY))[CACHE_KEY];
    await this.vault.assertAccess(generation);
    this.assertEpoch(epoch);
    if (revision !== this.privateRevision)
      throw new RuntimeError('STALE_STATE', 'Notion state changed. Refresh the current view.');
    this.review = null;
    this.reviewIdentity = identity;
    if (
      stored &&
      typeof stored === 'object' &&
      'identity' in stored &&
      stored.identity === identity &&
      'snapshot' in stored
    ) {
      const parsed = snapshotSchema.safeParse(stored.snapshot);
      if (parsed.success) this.review = parsed.data;
    }
  }
  private async loadReview(force: boolean, context: NotionOperationContext): Promise<void> {
    const data = await this.vault.read();
    const generation = this.vault.generation;
    await this.hydrateReview(data, generation);
    await context.assertActive();
    if (this.review && !this.review.stale && !force) return;
    try {
      const repository = new NotionCaptureRepository(
        this.transport.createClient(data.token, context),
        data.manifest,
      );
      const date = localDate(new Date(this.now()));
      const loaded = await repository.loadDashboard(
        date,
        data.preferences.newProblemSessionStartedAt,
      );
      const snapshot = snapshotSchema.parse({
        date,
        goal: data.preferences.dailyNewProblemGoal,
        ...loaded,
        generatedAt: new Date(this.now()).toISOString(),
        stale: false,
      });
      await context.assertActive();
      await this.persistReview(snapshot, this.cacheIdentity(data, generation), context);
      await context.assertActive();
      this.privateRevision++;
      this.review = snapshot;
      this.reviewIdentity = this.cacheIdentity(data, generation);
    } catch (error) {
      await context.assertActive();
      if (this.review) {
        this.privateRevision++;
        this.review = { ...this.review, stale: true };
        await this.persistReview(this.review, this.reviewIdentity, context);
        await context.assertActive();
      }
      throw error;
    }
  }
}
