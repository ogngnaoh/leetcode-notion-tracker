import { SyntheticNotion } from './fixture.js';
import type { NotionManifest } from '../../src/shared/contract.js';
import {
  REQUIRED_ATTEMPTS_TYPES,
  REQUIRED_PROBLEMS_TYPES,
  RESULT_OPTIONS,
  STATE_OPTIONS,
} from '../../src/notion/schema.js';
import { DIFFICULTY_OPTIONS } from '../../src/notion/presentation.js';

export const directManifest: NotionManifest = {
  version: 4,
  notionApiVersion: '2026-03-11',
  createdAt: '2026-09-03T00:00:00.000Z',
  parentPageId: '00000000-0000-4000-8000-000000000001',
  problems: {
    databaseId: '00000000-0000-4000-8000-000000000002',
    dataSourceId: '00000000-0000-4000-8000-000000000003',
  },
  attempts: {
    databaseId: '00000000-0000-4000-8000-000000000004',
    dataSourceId: '00000000-0000-4000-8000-000000000005',
  },
};

export interface DirectFixtureRequest {
  method: string;
  path: string;
  mutation: boolean;
}

function outward(value: unknown): any {
  if (Array.isArray(value)) return value.map(outward);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, outward(item)]));
  if (value === 'problems') return directManifest.problems.dataSourceId;
  if (value === 'attempts') return directManifest.attempts.dataSourceId;
  if (typeof value === 'string') {
    const match = /^(page|block)-(\d+)$/.exec(value);
    if (match)
      return `${match[1] === 'page' ? '10000000' : '20000000'}-0000-4000-8000-${Number(match[2]).toString(16).padStart(12, '0')}`;
  }
  return value;
}

function inward(value: unknown): any {
  if (Array.isArray(value)) return value.map(inward);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inward(item)]));
  if (value === directManifest.problems.dataSourceId) return 'problems';
  if (value === directManifest.attempts.dataSourceId) return 'attempts';
  if (typeof value === 'string') {
    const match = /^(10000000|20000000)-0000-4000-8000-([a-f0-9]{12})$/.exec(value);
    if (match) return `${match[1] === '10000000' ? 'page' : 'block'}-${parseInt(match[2]!, 16)}`;
  }
  return value;
}

function dataSource(problems: boolean): Record<string, unknown> {
  const own = problems ? directManifest.problems : directManifest.attempts;
  const other = problems ? directManifest.attempts : directManifest.problems;
  const types = problems ? REQUIRED_PROBLEMS_TYPES : REQUIRED_ATTEMPTS_TYPES;
  const selects: Record<string, unknown> = problems
    ? { 'Practice State': STATE_OPTIONS, Difficulty: DIFFICULTY_OPTIONS }
    : { Result: RESULT_OPTIONS, 'Resulting State': STATE_OPTIONS };
  const properties = Object.fromEntries(
    Object.entries(types).map(([name, type]) => [
      name,
      {
        id: name,
        name,
        type,
        [type]:
          type === 'select'
            ? { options: selects[name] ?? [] }
            : type === 'relation'
              ? {
                  type: 'dual_property',
                  data_source_id: other.dataSourceId,
                  dual_property: {
                    synced_property_name: problems ? 'Problem' : 'Attempts',
                    synced_property_id: 'relation',
                  },
                }
              : {},
      },
    ]),
  );
  return {
    object: 'data_source',
    id: own.dataSourceId,
    parent: { type: 'database_id', database_id: own.databaseId },
    properties,
    in_trash: false,
  };
}

/** UUID-shaped wrapper around the existing stateful fixture. Never forwards network traffic. */
export class DirectSyntheticNotion {
  private readonly base = new SyntheticNotion();
  private readonly blocks = new Map<string, any>();
  readonly requests: DirectFixtureRequest[] = [];
  latencyMs = 0;
  beforeRequest?: (request: DirectFixtureRequest) => Promise<Response | void> | Response | void;
  afterRequest?: (
    request: DirectFixtureRequest,
    response: Response,
  ) => Promise<Response | void> | Response | void;

  get counts() {
    return {
      ...this.base.counts,
      total: this.requests.length,
      mutations: this.requests.filter((request) => request.mutation).length,
    };
  }
  resetCounts(): void {
    this.base.resetCounts();
    this.requests.length = 0;
  }
  reset(): void {
    this.base.reset();
    this.blocks.clear();
    this.requests.length = 0;
  }

  readonly respond = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    if (url.origin !== 'https://api.notion.com')
      throw new Error('Synthetic Notion accepts only its fixed API origin.');
    const method = (init.method ?? 'GET').toUpperCase();
    const request = {
      method,
      path: url.pathname,
      mutation: method !== 'GET' && !url.pathname.endsWith('/query'),
    };
    this.requests.push(request);
    const intercepted = await this.beforeRequest?.(request);
    if (intercepted) return intercepted;
    if (this.latencyMs) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    let response: Response;
    const schema = /^\/v1\/(databases|data_sources)\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && schema) {
      const problems =
        schema[2] === directManifest.problems.databaseId ||
        schema[2] === directManifest.problems.dataSourceId;
      const selected = problems ? directManifest.problems : directManifest.attempts;
      if (schema[2] !== (schema[1] === 'databases' ? selected.databaseId : selected.dataSourceId))
        return Response.json(
          { object: 'error', code: 'object_not_found', message: 'Unknown synthetic schema' },
          { status: 404 },
        );
      response = Response.json(
        schema[1] === 'databases'
          ? {
              object: 'database',
              id: selected.databaseId,
              data_sources: [
                { id: selected.dataSourceId, name: problems ? 'Problems' : 'Attempts' },
              ],
              in_trash: false,
            }
          : dataSource(problems),
      );
    } else {
      const blockGet = /^\/v1\/blocks\/([^/]+)$/.exec(url.pathname);
      if (method === 'GET' && blockGet) {
        const block = this.blocks.get(blockGet[1]!);
        response = block
          ? Response.json(block)
          : Response.json(
              { object: 'error', code: 'object_not_found', message: 'Unknown synthetic block' },
              { status: 404 },
            );
      } else {
        const rewritten = new URL(url);
        rewritten.pathname = url.pathname
          .split('/')
          .map((part) => inward(part))
          .join('/');
        const internal = await this.base.respond(rewritten.href, {
          ...init,
          method,
          ...(typeof init.body === 'string'
            ? { body: JSON.stringify(inward(JSON.parse(init.body))) }
            : {}),
        });
        const value = outward(await internal.json());
        const children = /^\/v1\/blocks\/([^/]+)\/children$/.exec(url.pathname);
        if (children && Array.isArray(value.results)) {
          for (const block of value.results) {
            block.object = 'block';
            block.parent = {
              type: children[1]!.startsWith('10000000') ? 'page_id' : 'block_id',
              [children[1]!.startsWith('10000000') ? 'page_id' : 'block_id']: children[1],
            };
            this.blocks.set(block.id, structuredClone(block));
          }
        } else if (blockGet && method === 'PATCH') {
          value.object = 'block';
          value.parent = this.blocks.get(value.id)?.parent;
          this.blocks.set(value.id, structuredClone(value));
        }
        response = Response.json(value);
      }
    }
    return (await this.afterRequest?.(request, response.clone())) ?? response;
  };
}
