import { z } from 'zod';
import type { CaptureEvent, NotionManifest } from '../../src/shared/contract.js';
import { matchesNotionTimestamp } from '../../src/tracker/notion-timestamps.js';
import { RECEIPTS_LABEL, ReceiptSchema } from '../../src/tracker/latest-attempt.js';
import {
  isNonIdempotentNotionWrite,
  isNotionRead,
  type NotionRequest,
} from './notion-transport.js';

const CheckpointSchema = z
  .object({
    version: z.literal(1),
    eventId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(['problem-create', 'attempt-create', 'block-append']),
    request: z
      .object({
        path: z.string().max(300),
        method: z.enum(['POST', 'PATCH']),
        body: z.string().max(300_000),
      })
      .strict(),
    status: z.enum(['uncertain', 'resolved']),
    targetIds: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
  })
  .strict();

export const MutationCheckpointSchema = CheckpointSchema;
export const MutationCheckpointsSchema = z.array(CheckpointSchema).max(32);

export type MutationCheckpoint = z.infer<typeof CheckpointSchema>;

export class NotionRecoveryError extends Error {
  readonly code = 'NEEDS_VERIFICATION';
  constructor(
    message = 'The saved result needs verification. Check again before retrying this attempt.',
  ) {
    super(message);
    this.name = 'NotionRecoveryError';
  }
}

/** Retain actionable HTTP classification without exposing a provider body or changing recovery state. */
export class NotionRecoveryReadError extends Error {
  constructor(readonly status: number) {
    super('Notion could not verify the saved result. The original recovery record is preserved.');
    this.name = 'NotionRecoveryReadError';
  }
}

interface Options {
  event: CaptureEvent;
  manifest: NotionManifest;
  store: {
    load(): Promise<MutationCheckpoint[]>;
    /** Must durably serialize and verify the encrypted aggregate before resolving. */
    save(checkpoints: MutationCheckpoint[]): Promise<void>;
  };
  read(request: NotionRequest): Promise<Response>;
  assertActive?(): void | Promise<void>;
}

type JsonObject = Record<string, any>;

function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function text(items: unknown): string {
  if (!Array.isArray(items)) throw new NotionRecoveryError();
  return items
    .map((item) => {
      const value = item?.plain_text ?? item?.text?.content;
      if (typeof value !== 'string') throw new NotionRecoveryError();
      return value;
    })
    .join('');
}

function propertiesMatch(actual: JsonObject, expected: JsonObject): boolean {
  return Object.entries(expected).every(([name, requested]) => {
    const got = actual[name];
    if (!object(got) || !object(requested)) return false;
    const type = Object.keys(requested)[0]!;
    if (got.type !== type) return false;
    if (type === 'title' || type === 'rich_text') return text(got[type]) === text(requested[type]);
    if (type === 'date')
      return requested.date === null
        ? got.date === null
        : matchesNotionTimestamp(got.date?.start ?? null, requested.date.start);
    if (type === 'select') return (got.select?.name ?? null) === (requested.select?.name ?? null);
    if (type === 'multi_select')
      return (
        canonical((got.multi_select ?? []).map((item: any) => item.name).sort()) ===
        canonical(requested.multi_select.map((item: any) => item.name).sort())
      );
    if (type === 'relation')
      return (
        canonical((got.relation ?? []).map((item: any) => item.id).sort()) ===
        canonical(requested.relation.map((item: any) => item.id).sort())
      );
    return canonical(got[type]) === canonical(requested[type]);
  });
}

function blockMatches(actual: JsonObject, expected: JsonObject, stable = false): boolean {
  if (actual.type !== expected.type || actual.in_trash || actual.archived) return false;
  if (!['heading_2', 'code', 'toggle'].includes(expected.type)) return false;
  const got = text(actual[actual.type]?.rich_text);
  const want = text(expected[expected.type]?.rich_text);
  if (!stable || expected.type !== 'code') return got === want;
  try {
    const a = ReceiptSchema.parse(JSON.parse(got));
    const b = ReceiptSchema.parse(JSON.parse(want));
    return (
      a.clientEventId === b.clientEventId &&
      a.attemptedAt === b.attemptedAt &&
      a.result === b.result &&
      canonical(a.review) === canonical(b.review)
    );
  } catch {
    return false;
  }
}

/** Durable non-idempotent writes only. Read-only checks never call capture/reconciliation helpers. */
export class NotionMutationGateway {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly options: Options) {}

  check(): Promise<{ resolved: number }> {
    return this.serial(async () => {
      const checkpoints = await this.load();
      let resolved = 0;
      for (const checkpoint of checkpoints) {
        if (checkpoint.status === 'resolved') continue;
        const result = await this.discover(checkpoint);
        checkpoint.status = 'resolved';
        checkpoint.targetIds = this.targetIds(checkpoint, result);
        await this.active();
        await this.options.store.save(checkpoints);
        resolved++;
      }
      return { resolved };
    });
  }

  dispatch(request: NotionRequest, send: () => Promise<Response>): Promise<Response> {
    return this.serial(async () => {
      if (!isNonIdempotentNotionWrite(request))
        throw new NotionRecoveryError('Unsupported capture mutation.');
      await this.active();
      const checkpoint = await this.intent(request);
      const checkpoints = await this.load();
      const existing = checkpoints.find((item) => item.fingerprint === checkpoint.fingerprint);
      if (existing) {
        const recovered =
          existing.status === 'resolved'
            ? await this.retrieveResolved(existing)
            : await this.discover(existing);
        if (existing.status !== 'resolved') {
          existing.status = 'resolved';
          existing.targetIds = this.targetIds(existing, recovered);
          await this.active();
          await this.options.store.save(checkpoints);
        }
        return Response.json(recovered);
      }
      if (checkpoints.some((item) => item.status === 'uncertain')) throw new NotionRecoveryError();
      if (checkpoints.length >= 32)
        throw new NotionRecoveryError('The pending save has too many recovery checkpoints.');
      checkpoints.push(checkpoint);
      await this.options.store.save(checkpoints);
      await this.active();
      const response = await send();
      await this.active();
      if (!response.ok) {
        // A rejection only settles this request. The runtime retains the whole pending capture.
        if ([400, 401, 403, 404, 405, 409, 422, 429, 529].includes(response.status)) {
          await this.options.store.save(checkpoints.filter((item) => item !== checkpoint));
        }
        return response;
      }
      let result: unknown;
      try {
        result = await response.clone().json();
      } catch {
        throw new NotionRecoveryError();
      }
      this.validateResponse(checkpoint, result, false);
      checkpoint.status = 'resolved';
      checkpoint.targetIds = this.targetIds(checkpoint, result as JsonObject);
      await this.active();
      await this.options.store.save(checkpoints);
      return response;
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => {}).then(operation);
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async active(): Promise<void> {
    await this.options.assertActive?.();
  }

  private async intent(request: NotionRequest): Promise<MutationCheckpoint> {
    let body: JsonObject;
    try {
      const parsed: unknown = JSON.parse(request.body ?? '');
      if (!object(parsed)) throw new Error();
      body = parsed;
    } catch {
      throw new NotionRecoveryError('Invalid capture mutation.');
    }
    const key = `leetcode:${this.options.event.problem.slug}`;
    let kind: MutationCheckpoint['kind'];
    if (request.method === 'POST' && request.path === '/v1/pages') {
      if (body.parent?.data_source_id === this.options.manifest.problems.dataSourceId) {
        kind = 'problem-create';
        if (text(body.properties?.['External Key']?.rich_text) !== key)
          throw new NotionRecoveryError();
      } else if (body.parent?.data_source_id === this.options.manifest.attempts.dataSourceId) {
        kind = 'attempt-create';
        if (
          text(body.properties?.['Client Event ID']?.rich_text) !==
            this.options.event.clientEventId ||
          text(body.properties?.['Problem Key']?.rich_text) !== key
        )
          throw new NotionRecoveryError();
      } else throw new NotionRecoveryError('Capture target does not match this connection.');
    } else {
      kind = 'block-append';
      if (!Array.isArray(body.children) || body.children.length < 1 || body.children.length > 2)
        throw new NotionRecoveryError();
      for (const block of body.children) {
        if (block?.type === 'toggle' && text(block.toggle?.rich_text) === RECEIPTS_LABEL) continue;
        if (block?.type !== 'code') throw new NotionRecoveryError();
        try {
          ReceiptSchema.parse(JSON.parse(text(block.code.rich_text)));
        } catch {
          throw new NotionRecoveryError();
        }
      }
    }
    return CheckpointSchema.parse({
      version: 1,
      eventId: this.options.event.clientEventId,
      fingerprint: await digest({
        eventId: this.options.event.clientEventId,
        path: request.path,
        method: request.method,
        body,
      }),
      kind,
      request: { ...request, body: JSON.stringify(body) },
      status: 'uncertain',
    });
  }

  private async load(): Promise<MutationCheckpoint[]> {
    await this.active();
    let checkpoints: MutationCheckpoint[];
    try {
      checkpoints = z
        .array(CheckpointSchema)
        .max(32)
        .parse(await this.options.store.load());
    } catch {
      throw new NotionRecoveryError('The saved recovery record is invalid.');
    }
    const seen = new Set<string>();
    for (const checkpoint of checkpoints) {
      const expected = await this.intent(checkpoint.request);
      if (
        checkpoint.eventId !== this.options.event.clientEventId ||
        checkpoint.fingerprint !== expected.fingerprint ||
        checkpoint.kind !== expected.kind ||
        seen.has(checkpoint.fingerprint) ||
        (checkpoint.status === 'resolved' && !checkpoint.targetIds) ||
        (checkpoint.status === 'uncertain' && checkpoint.targetIds)
      )
        throw new NotionRecoveryError('The saved recovery record does not match this attempt.');
      seen.add(checkpoint.fingerprint);
    }
    return checkpoints;
  }

  private targetIds(checkpoint: MutationCheckpoint, result: JsonObject): string[] {
    return checkpoint.kind === 'block-append'
      ? result.results.map((item: any) => item.id)
      : [result.id];
  }

  private validateResponse(
    checkpoint: MutationCheckpoint,
    value: unknown,
    stable: boolean,
  ): asserts value is JsonObject {
    if (!object(value)) throw new NotionRecoveryError();
    const body = JSON.parse(checkpoint.request.body) as JsonObject;
    if (checkpoint.kind === 'block-append') {
      if (
        !Array.isArray(value.results) ||
        value.results.length !== body.children.length ||
        value.results.some(
          (item: any, index: number) =>
            typeof item?.id !== 'string' || !blockMatches(item, body.children[index], stable),
        )
      )
        throw new NotionRecoveryError();
      if (new Set(value.results.map((item: any) => item.id)).size !== value.results.length)
        throw new NotionRecoveryError();
      return;
    }
    if (
      value.object !== 'page' ||
      typeof value.id !== 'string' ||
      value.parent?.data_source_id !== body.parent.data_source_id ||
      value.in_trash ||
      value.archived ||
      !object(value.properties)
    )
      throw new NotionRecoveryError();
    const identity =
      checkpoint.kind === 'problem-create'
        ? { 'External Key': body.properties['External Key'] }
        : { 'Problem Key': body.properties['Problem Key'], Problem: body.properties.Problem };
    if (!propertiesMatch(value.properties, stable ? identity : body.properties))
      throw new NotionRecoveryError();
  }

  private async read(request: NotionRequest): Promise<JsonObject> {
    if (!isNotionRead(request))
      throw new NotionRecoveryError('Recovery inspection must be read-only.');
    await this.active();
    const response = await this.options.read(request);
    await this.active();
    if (!response.ok) throw new NotionRecoveryReadError(response.status);
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new NotionRecoveryError();
    }
    if (!object(result)) throw new NotionRecoveryError();
    return result;
  }

  private async list(path: string, queryBody?: JsonObject): Promise<JsonObject[]> {
    const result: JsonObject[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.read(
        queryBody
          ? {
              path,
              method: 'POST',
              body: JSON.stringify({
                ...queryBody,
                page_size: 100,
                ...(cursor ? { start_cursor: cursor } : {}),
              }),
            }
          : {
              path: `${path}?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`,
              method: 'GET',
            },
      );
      if (
        !Array.isArray(page.results) ||
        typeof page.has_more !== 'boolean' ||
        page.results.some((item: unknown) => !object(item))
      )
        throw new NotionRecoveryError();
      result.push(...page.results);
      if (result.length > 5000)
        throw new NotionRecoveryError('Too many saved records to verify in one operation.');
      if (!page.has_more) break;
      if (
        typeof page.next_cursor !== 'string' ||
        !page.next_cursor ||
        cursors.has(page.next_cursor)
      )
        throw new NotionRecoveryError();
      cursor = page.next_cursor;
      cursors.add(cursor);
    } while (true);
    return result;
  }

  private async discover(checkpoint: MutationCheckpoint): Promise<JsonObject> {
    const body = JSON.parse(checkpoint.request.body) as JsonObject;
    if (checkpoint.kind !== 'block-append') {
      const property = checkpoint.kind === 'problem-create' ? 'External Key' : 'Client Event ID';
      const value = text(body.properties[property].rich_text);
      const rows = await this.list(`/v1/data_sources/${body.parent.data_source_id}/query`, {
        filter: { property, rich_text: { equals: value } },
      });
      // Do not select the first indexed match: duplicate/partial state requires manual review.
      if (rows.length !== 1) throw new NotionRecoveryError();
      const page = rows[0]!;
      this.validateResponse(checkpoint, page, false);
      if (body.children) await this.verifyChildren(page.id, body.children);
      return page;
    }
    const parent = checkpoint.request.path.split('/')[3]!;
    const blocks = await this.list(`/v1/blocks/${parent}/children`);
    const matches = body.children.map((expected: JsonObject) => {
      const found = blocks.filter((block) => blockMatches(block, expected));
      if (found.length !== 1) throw new NotionRecoveryError();
      return found[0]!;
    });
    const response = { object: 'list', results: matches, has_more: false, next_cursor: null };
    this.validateResponse(checkpoint, response, false);
    return response;
  }

  private async verifyChildren(parent: string, expected: JsonObject[]): Promise<void> {
    const blocks = await this.list(`/v1/blocks/${parent}/children`);
    for (const wanted of expected) {
      const matches = blocks.filter((block) => blockMatches(block, wanted));
      if (matches.length !== 1) throw new NotionRecoveryError();
      const children = wanted[wanted.type]?.children;
      if (children) await this.verifyChildren(matches[0]!.id, children);
    }
  }

  private async retrieveResolved(checkpoint: MutationCheckpoint): Promise<JsonObject> {
    if (!checkpoint.targetIds?.length) throw new NotionRecoveryError();
    if (checkpoint.kind !== 'block-append') {
      const page = await this.read({ path: `/v1/pages/${checkpoint.targetIds[0]}`, method: 'GET' });
      this.validateResponse(checkpoint, page, true);
      if (page.id !== checkpoint.targetIds[0]) throw new NotionRecoveryError();
      return page;
    }
    const parent = checkpoint.request.path.split('/')[3]!;
    const children = await this.list(`/v1/blocks/${parent}/children`);
    const result = {
      object: 'list',
      results: checkpoint.targetIds.map((id) => {
        const matches = children.filter((block) => block.id === id);
        if (matches.length !== 1) throw new NotionRecoveryError();
        return matches[0]!;
      }),
      has_more: false,
      next_cursor: null,
    };
    this.validateResponse(checkpoint, result, true);
    return result;
  }
}
