import type { Client as NotionClient } from '@notionhq/client';
import ClientModule from '@notionhq/client/build/src/Client.js';
import { NOTION_API_VERSION } from '../../src/notion/schema.js';

// The SDK is CommonJS. Its deep Client module avoids the top-level webhook/Node crypto export;
// the nested default unwrap preserves the class under ESM browser bundling.
const clientModule = ClientModule as unknown;
const BrowserClient = (
  typeof clientModule === 'function'
    ? clientModule
    : (clientModule as { default: typeof NotionClient }).default
) as typeof NotionClient;

export interface NotionRequest {
  path: string;
  method: string;
  body?: string;
}

export interface NotionOperationContext {
  assertActive(): void | Promise<void>;
  signal?: AbortSignal;
  deadline?: number;
  beforeMutation?(): void | Promise<void>;
}

export interface NotionRequestGateway {
  dispatch(request: NotionRequest, send: () => Promise<Response>): Promise<Response>;
}

export class NotionTransportError extends Error {
  constructor(
    readonly code: 'UNAVAILABLE' | 'RATE_LIMITED' | 'TIMEOUT' | 'FORBIDDEN',
    message: string,
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = 'NotionTransportError';
  }
}

interface Options {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  loadCooldown?(): Promise<number>;
  saveCooldown?(timestamp: number): Promise<void>;
  now?(): number;
  sleep?(milliseconds: number): Promise<void>;
  requestTimeoutMs?: number;
}

const ID = '[a-fA-F0-9-]{32,36}';
const READ_PATH = new RegExp(
  `^/v1/(?:pages/${ID}|blocks/${ID}(?:/children)?|data_sources/${ID}|databases/${ID})(?:\\?[^#]*)?$`,
);
const QUERY_PATH = new RegExp(`^/v1/data_sources/${ID}/query$`);
const UPDATE_PATH = new RegExp(`^/v1/(?:pages/${ID}|blocks/${ID}(?:/children)?)$`);

export function isNotionRead(request: NotionRequest): boolean {
  return request.method === 'GET' || (request.method === 'POST' && QUERY_PATH.test(request.path));
}

export function isNonIdempotentNotionWrite(request: NotionRequest): boolean {
  return (
    (request.method === 'POST' && request.path === '/v1/pages') ||
    (request.method === 'PATCH' &&
      /^\/v1\/blocks\/[a-fA-F0-9-]{32,36}\/children$/.test(request.path))
  );
}

function validateRequest(request: NotionRequest): void {
  if (!(
    (request.method === 'GET' && READ_PATH.test(request.path)) ||
    (request.method === 'POST' &&
      (request.path === '/v1/pages' || QUERY_PATH.test(request.path))) ||
    (request.method === 'PATCH' && UPDATE_PATH.test(request.path))
  )) {
    throw new NotionTransportError('FORBIDDEN', 'This Notion operation is not supported.');
  }
  const url = new URL(request.path, 'https://api.notion.com');
  if (url.origin !== 'https://api.notion.com' || !url.pathname.startsWith('/v1/') || url.hash) {
    throw new NotionTransportError('FORBIDDEN', 'This Notion destination is not supported.');
  }
}

/** One scheduler shared by every client in a worker, including connection checks. */
export class NotionTransport {
  private tail: Promise<void> = Promise.resolve();
  private tokens = 3;
  private updatedAt: number;
  private cooldown = 0;
  private readonly now: () => number;
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>;

  constructor(private readonly options: Options = {}) {
    this.now = options.now ?? Date.now;
    this.updatedAt = this.now();
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  }

  createClient(
    token: string,
    context: NotionOperationContext,
    gateway?: NotionRequestGateway,
  ): NotionClient {
    const bounded = { ...context, deadline: context.deadline ?? this.now() + 120_000 };
    return new BrowserClient({
      auth: token,
      notionVersion: NOTION_API_VERSION,
      retry: false,
      logger: () => {},
      // The injected fetch owns actual aborts, including response-body consumption.
      timeoutMs: 125_000,
      fetch: async (input, init) => {
        const url = new URL(input);
        if (url.origin !== 'https://api.notion.com' || url.username || url.password || url.hash) {
          throw new NotionTransportError('FORBIDDEN', 'This Notion destination is not supported.');
        }
        if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string') {
          throw new NotionTransportError('FORBIDDEN', 'This Notion request body is not supported.');
        }
        return this.request(
          {
            path: url.pathname + url.search,
            method: (init?.method ?? 'GET').toUpperCase(),
            ...(typeof init?.body === 'string' ? { body: init.body } : {}),
          },
          token,
          bounded,
          gateway,
        );
      },
    });
  }

  async request(
    request: NotionRequest,
    token: string,
    context: NotionOperationContext,
    gateway?: NotionRequestGateway,
  ): Promise<Response> {
    validateRequest(request);
    const send = () => this.enqueue(() => this.perform(request, token, context));
    return gateway && isNonIdempotentNotionWrite(request)
      ? gateway.dispatch(request, send)
      : send();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => {}).then(operation);
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async active(context: NotionOperationContext): Promise<void> {
    if (context.signal?.aborted)
      throw new NotionTransportError(
        'UNAVAILABLE',
        'The Notion operation stopped. Check the saved result before retrying.',
      );
    await context.assertActive();
    if (this.now() >= (context.deadline ?? Infinity))
      throw new NotionTransportError('TIMEOUT', 'Notion took too long. Retry the same attempt.');
  }

  private async wait(milliseconds: number, context: NotionOperationContext): Promise<void> {
    if (milliseconds <= 0) return;
    if (milliseconds > 10_000)
      throw new NotionTransportError(
        'RATE_LIMITED',
        'Notion asked LCTrack to wait before retrying.',
        this.now() + milliseconds,
      );
    if (this.now() + milliseconds >= (context.deadline ?? Infinity))
      throw new NotionTransportError('TIMEOUT', 'Notion took too long. Retry the same attempt.');
    if (this.options.sleep) await this.options.sleep(milliseconds);
    else
      await new Promise<void>((resolve, reject) => {
        const stopped = () => {
          clearTimeout(timer);
          reject(new NotionTransportError('UNAVAILABLE', 'The Notion operation stopped.'));
        };
        const timer = setTimeout(() => {
          context.signal?.removeEventListener('abort', stopped);
          resolve();
        }, milliseconds);
        context.signal?.addEventListener('abort', stopped, { once: true });
        if (context.signal?.aborted) stopped();
      });
    await this.active(context);
  }

  private async perform(
    request: NotionRequest,
    token: string,
    context: NotionOperationContext,
  ): Promise<Response> {
    const read = isNotionRead(request);
    for (let attempt = 0; ; attempt++) {
      await this.active(context);
      this.cooldown = Math.max(this.cooldown, (await this.options.loadCooldown?.()) ?? 0);
      await this.wait(this.cooldown - this.now(), context);
      const now = this.now();
      this.tokens = Math.min(3, this.tokens + (Math.max(0, now - this.updatedAt) * 3) / 1000);
      this.updatedAt = now;
      if (this.tokens < 1) {
        await this.wait(Math.ceil(((1 - this.tokens) * 1000) / 3), context);
        this.tokens = Math.min(
          3,
          this.tokens + (Math.max(0, this.now() - this.updatedAt) * 3) / 1000,
        );
        this.updatedAt = this.now();
      }
      this.tokens = Math.max(0, this.tokens - 1);
      await this.active(context);
      if (!read) await context.beforeMutation?.();
      await this.active(context);
      const response = await this.fetchBounded(request, token, context);
      if (response.status === 429 || response.status === 529) {
        const raw = response.headers.get('Retry-After');
        const seconds = raw !== null && /^\d+$/.test(raw) ? Number(raw) : 2 ** attempt;
        this.cooldown = Math.max(this.cooldown, this.now() + Math.max(1, seconds) * 1000);
        await this.options.saveCooldown?.(this.cooldown);
      }
      if (!read || attempt >= 2 || ![429, 529, 500, 502, 503, 504].includes(response.status))
        return response;
      if (![429, 529].includes(response.status)) await this.wait(1000 * 2 ** attempt, context);
    }
  }

  private async fetchBounded(
    request: NotionRequest,
    token: string,
    context: NotionOperationContext,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = Math.min(
      this.options.requestTimeoutMs ?? 20_000,
      (context.deadline ?? Infinity) - this.now(),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort!: (error: Error) => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const stop = () => {
      controller.abort();
      rejectAbort(
        new NotionTransportError(
          'UNAVAILABLE',
          'The Notion operation stopped. Check the saved result before retrying.',
        ),
      );
    };
    context.signal?.addEventListener('abort', stop, { once: true });
    timeout = setTimeout(
      () => {
        controller.abort();
        rejectAbort(
          new NotionTransportError('TIMEOUT', 'Notion took too long. Retry the same attempt.'),
        );
      },
      Math.max(0, timeoutMs),
    );
    try {
      if (context.signal?.aborted) stop();
      const result = await Promise.race([
        aborted,
        (async () => {
          const response = await this.fetcher(`https://api.notion.com${request.path}`, {
            method: request.method,
            headers: {
              Authorization: `Bearer ${token}`,
              'Notion-Version': NOTION_API_VERSION,
              ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(request.body !== undefined ? { body: request.body } : {}),
            signal: controller.signal,
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
          });
          const body = await response.text();
          return new Response(body, { status: response.status, headers: response.headers });
        })(),
      ]);
      await this.active(context);
      return result;
    } catch (error) {
      if (error instanceof NotionTransportError) throw error;
      throw new NotionTransportError(
        'UNAVAILABLE',
        'Notion could not be reached. Check the saved result before retrying.',
      );
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener('abort', stop);
    }
  }
}
