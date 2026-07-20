import { createServer, type Server, type ServerResponse } from 'node:http';

export const TEST_BRIDGE_TOKEN = 'browser-suite-bridge-token-2026';

export interface RecordedBridgeRequest {
  method: 'GET' | 'POST';
  path: string;
  authorization: string | null;
  body: string | null;
}

export type BridgeReply =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'disconnect' }
  | { kind: 'deferred' };

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, corsHeaders());
  response.end(JSON.stringify(body));
}

function reviewFor(body: string): {
  practiceState: string;
  solvedStreak: number;
  nextReview: string | null;
} {
  const event = JSON.parse(body) as {
    attempt: { attemptedOn: string; result: string };
  };
  const result = event.attempt.result;
  return {
    practiceState: result,
    solvedStreak: result === 'Solved' ? 1 : 0,
    nextReview: event.attempt.attemptedOn,
  };
}

export class MockBridge {
  readonly requests: RecordedBridgeRequest[] = [];
  statusReply: BridgeReply = { kind: 'response', status: 200, body: { found: false } };
  captureReplies: BridgeReply[] = [];
  private server: Server | null = null;
  private deferred: Array<{ response: ServerResponse; body: string }> = [];

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer(async (request, response) => {
      response.on('error', () => undefined);
      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders());
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1:8787');
      const authorization = request.headers.authorization ?? null;
      if (request.method === 'GET' && /^\/api\/problems\/[^/]+\/status$/.test(url.pathname)) {
        this.requests.push({ method: 'GET', path: url.pathname, authorization, body: null });
        if (authorization !== `Bearer ${TEST_BRIDGE_TOKEN}`) {
          send(response, 401, { error: 'Unauthorized' });
          return;
        }
        this.respond(response, this.statusReply, null);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/capture') {
        let body = '';
        for await (const chunk of request) body += String(chunk);
        this.requests.push({ method: 'POST', path: url.pathname, authorization, body });
        if (authorization !== `Bearer ${TEST_BRIDGE_TOKEN}`) {
          send(response, 401, { error: 'Unauthorized' });
          return;
        }
        const reply = this.captureReplies.shift() ?? {
          kind: 'response',
          status: 200,
          body: {
            duplicate: false,
            problemPageId: 'problem-page',
            attemptPageId: 'attempt-page',
            review: reviewFor(body),
          },
        };
        this.respond(response, reply, body);
        return;
      }

      send(response, 404, { error: 'Not found' });
    });

    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(8787, '127.0.0.1');
      });
    } catch (error) {
      this.server = null;
      const detail = error instanceof Error ? ` (${error.message})` : '';
      throw new Error(
        `Playwright mock bridge could not claim 127.0.0.1:8787${detail}. Stop the real bridge or other process using port 8787, then rerun npm run test:browser.`,
      );
    }
  }

  reset(): void {
    this.requests.length = 0;
    this.captureReplies.length = 0;
    this.statusReply = { kind: 'response', status: 200, body: { found: false } };
    for (const pending of this.deferred.splice(0)) {
      pending.response.destroy();
    }
  }

  posts(): RecordedBridgeRequest[] {
    return this.requests.filter((request) => request.method === 'POST');
  }

  async waitForPosts(count: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (this.posts().length < count) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${count} capture POST request(s).`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  resolveDeferred(options: { duplicate?: boolean } = {}): void {
    const pending = this.deferred.shift();
    if (!pending) throw new Error('No deferred capture response is waiting.');
    send(pending.response, 200, {
      duplicate: options.duplicate ?? false,
      problemPageId: 'problem-page',
      attemptPageId: 'attempt-page',
      review: reviewFor(pending.body),
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    for (const pending of this.deferred.splice(0)) pending.response.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }

  private respond(response: ServerResponse, reply: BridgeReply, body: string | null): void {
    if (reply.kind === 'disconnect') {
      response.destroy();
      return;
    }
    if (reply.kind === 'deferred') {
      if (body === null) throw new Error('Only capture responses can be deferred.');
      this.deferred.push({ response, body });
      return;
    }
    send(response, reply.status, reply.body);
  }
}
