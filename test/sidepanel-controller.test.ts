import { describe, expect, it, vi } from 'vitest';
import type {
  AttemptResult,
  CaptureEvent,
  CaptureResult,
  ProblemStatus,
} from '../src/shared/contract.js';
import { CaptureRequestError } from '../extension/src/capture-submission.js';
import {
  SidePanelController,
  type SidePanelControllerDependencies,
} from '../extension/src/sidepanel-controller.js';
import {
  CaptureSessionStore,
  type CaptureSessionStorageArea,
} from '../extension/src/capture-session.js';
import type {
  AvailableLeetCodeSnapshot,
  LeetCodeSnapshot,
} from '../extension/src/leetcode-extraction.js';

const settings = {
  bridgeUrl: 'http://127.0.0.1:8787',
  bridgeToken: 'a-very-long-personal-bridge-token',
};

const success: CaptureResult = {
  duplicate: false,
  problemPageId: 'problem-page-id',
  attemptPageId: 'attempt-page-id',
  review: {
    practiceState: 'Solved',
    solvedStreak: 1,
    nextReview: '2026-07-21',
  },
};

function snapshot(overrides: Partial<AvailableLeetCodeSnapshot> = {}): AvailableLeetCodeSnapshot {
  return {
    codeAvailable: true,
    problem: {
      slug: 'two-sum',
      title: 'Two Sum',
      number: 1,
      url: 'https://leetcode.com/problems/two-sum/',
      difficulty: 'Easy',
      topics: ['Array', 'Hash Table'],
    },
    language: 'Python',
    code: 'def twoSum(nums, target):\n    return []',
    fingerprint: 'fingerprint-two-sum',
    ...overrides,
  };
}

class FakeSessionArea implements CaptureSessionStorageArea {
  readonly values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return Object.hasOwn(this.values, key) ? { [key]: this.values[key] } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(key: string): Promise<void> {
    delete this.values[key];
  }
}

function harness(
  options: {
    area?: FakeSessionArea;
    initial?: LeetCodeSnapshot | null;
    fresh?: LeetCodeSnapshot | null;
    token?: string;
    status?: ProblemStatus;
    send?: SidePanelControllerDependencies['sendCaptureBody'];
    uuids?: string[];
  } = {},
) {
  const area = options.area ?? new FakeSessionArea();
  const initial = options.initial === undefined ? snapshot() : options.initial;
  const fresh = options.fresh === undefined ? initial : options.fresh;
  const getFreshSnapshot = vi.fn(async () => fresh);
  const sendCaptureBody = vi.fn(options.send ?? (async (_settings, _body: string) => success));
  const getProblemStatus = vi.fn(async () => options.status ?? ({ found: false } as ProblemStatus));
  const ids = options.uuids ?? [
    'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
    'd83d5722-13dd-4b2f-8d60-115613364ed4',
  ];
  const randomUUID = vi.fn(() => ids.shift() ?? 'be05a539-9e1e-4056-a30c-978d870c3640');
  const store = new CaptureSessionStore(area, 41);
  const controller = new SidePanelController({
    store,
    getSettings: vi.fn(async () => ({
      ...settings,
      bridgeToken: options.token ?? settings.bridgeToken,
    })),
    getFreshSnapshot,
    getProblemStatus,
    sendCaptureBody,
    randomUUID,
    now: () => new Date(2026, 6, 20, 8, 30, 0),
  });
  return {
    area,
    controller,
    getFreshSnapshot,
    getProblemStatus,
    randomUUID,
    sendCaptureBody,
    store,
  };
}

async function initialize(h: ReturnType<typeof harness>, context = snapshot()): Promise<void> {
  await h.controller.initialize(context);
}

describe('CaptureSessionStore', () => {
  it('namespaces one bounded session record per tab and removes empty state', async () => {
    const area = new FakeSessionArea();
    const store = new CaptureSessionStore(area, 41);
    const pending = {
      version: 1 as const,
      clientEventId: 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
      result: 'Solved' as const,
      fingerprint: 'fingerprint-two-sum',
      body: '{"exact":true}',
    };

    await store.write({ pending, lastSuccess: null });

    expect(area.values).toEqual({
      'leetcodeTracker.capture.tab.41': { pending, lastSuccess: null },
    });
    await store.write({ pending: null, lastSuccess: null });
    expect(area.values).toEqual({});
  });

  it('ignores malformed or mismatched session records', async () => {
    const area = new FakeSessionArea();
    area.values['leetcodeTracker.capture.tab.41'] = {
      pending: { version: 1, result: 'Green', body: 42 },
      lastSuccess: { fingerprint: '', result: 'Solved' },
    };

    await expect(new CaptureSessionStore(area, 41).read()).resolves.toEqual({
      pending: null,
      lastSuccess: null,
    });
  });

  it('does not restore the removed Couldn’t solve result from session storage', async () => {
    const area = new FakeSessionArea();
    area.values['leetcodeTracker.capture.tab.41'] = {
      pending: {
        version: 1,
        clientEventId: 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
        result: 'Couldn’t solve',
        fingerprint: 'fingerprint-two-sum',
        body: JSON.stringify({
          clientEventId: 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
          attempt: { result: 'Couldn’t solve' },
        }),
      },
      lastSuccess: {
        version: 2,
        fingerprint: 'fingerprint-two-sum',
        result: 'Couldn’t solve',
        duplicate: false,
        review: { practiceState: 'Couldn’t solve', solvedStreak: 0, nextReview: '2026-07-20' },
      },
    };

    await expect(new CaptureSessionStore(area, 41).read()).resolves.toEqual({
      pending: null,
      lastSuccess: null,
    });
  });

  it('rejects a pending body whose duplicated ID or result does not match', async () => {
    const area = new FakeSessionArea();
    const body = JSON.stringify({
      clientEventId: 'different-event-id',
      attempt: { result: 'Needed help' },
    });
    area.values['leetcodeTracker.capture.tab.41'] = {
      pending: {
        version: 1,
        clientEventId: 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
        result: 'Solved',
        fingerprint: 'fingerprint-two-sum',
        body,
      },
      lastSuccess: null,
    };

    expect((await new CaptureSessionStore(area, 41).read()).pending).toBeNull();
  });

  it('backward-reads the version-1 success lock as a version-2 last-success presentation', async () => {
    const area = new FakeSessionArea();
    area.values['leetcodeTracker.capture.tab.41'] = {
      pending: null,
      success: {
        version: 1,
        fingerprint: 'fingerprint-two-sum',
        result: 'Solved',
        duplicate: false,
        review: success.review,
      },
    };

    await expect(new CaptureSessionStore(area, 41).read()).resolves.toEqual({
      pending: null,
      lastSuccess: {
        version: 2,
        fingerprint: 'fingerprint-two-sum',
        result: 'Solved',
        duplicate: false,
        review: success.review,
      },
    });
  });
});

describe('SidePanelController capture flow', () => {
  it('loads status without posting before an outcome click', async () => {
    const h = harness();

    await initialize(h);

    expect(h.getProblemStatus).toHaveBeenCalledWith(settings, 'two-sum');
    expect(h.sendCaptureBody).not.toHaveBeenCalled();
    expect(h.controller.view).toMatchObject({ mode: 'ready', reviewLabel: 'New' });
  });

  it.each<AttemptResult>(['Needed help', 'Solved'])(
    'builds and sends the exact visible %s event after fresh revalidation',
    async (result) => {
      const h = harness();
      await initialize(h);

      await h.controller.selectResult(result);

      expect(h.getFreshSnapshot).toHaveBeenCalledOnce();
      expect(h.sendCaptureBody).toHaveBeenCalledOnce();
      const [, body] = h.sendCaptureBody.mock.calls[0]!;
      expect(JSON.parse(body)).toEqual({
        clientEventId: 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
        problem: snapshot().problem,
        attempt: {
          attemptedAt: new Date(2026, 6, 20, 8, 30, 0).toISOString(),
          attemptedOn: '2026-07-20',
          language: 'Python',
          code: snapshot().code,
          result,
        },
      } satisfies CaptureEvent);
      expect(h.controller.view).toMatchObject({
        mode: 'ready',
        loggedResult: result,
        message: 'Logged. Solved. Next review: 2026-07-21.',
      });
    },
  );

  it('refreshes a changed click-time snapshot and requires another outcome click', async () => {
    const changed = snapshot({ code: 'changed code', fingerprint: 'changed-fingerprint' });
    const h = harness({ fresh: changed });
    await initialize(h);

    await h.controller.selectResult('Solved');

    expect(h.sendCaptureBody).not.toHaveBeenCalled();
    expect(h.controller.view).toMatchObject({
      mode: 'ready',
      busy: false,
      snapshot: changed,
      message: 'The problem or code changed. Review it, then choose an outcome again.',
    });

    await h.controller.selectResult('Needed help');

    expect(h.sendCaptureBody).toHaveBeenCalledOnce();
    expect(JSON.parse(h.sendCaptureBody.mock.calls[0]![1] as string)).toMatchObject({
      problem: changed.problem,
      attempt: { code: 'changed code', result: 'Needed help' },
    });
  });

  it('clears click-time busy after unavailable code and permits a later readable click', async () => {
    const unavailable: LeetCodeSnapshot = {
      codeAvailable: false,
      problem: snapshot().problem,
      language: 'Python',
      codeUnavailable: { reason: 'NO_READABLE_EDITOR_MODEL' },
      fingerprint: null,
    };
    const h = harness({ fresh: unavailable });
    await initialize(h);

    await h.controller.selectResult('Solved');
    expect(h.controller.view).toMatchObject({ mode: 'blocked', busy: false });

    const readableAgain = snapshot({
      code: 'readable again',
      fingerprint: 'readable-again-fingerprint',
    });
    h.getFreshSnapshot.mockResolvedValue(readableAgain);
    await h.controller.acceptSnapshot(readableAgain);
    expect(h.controller.view).toMatchObject({ mode: 'ready', busy: false });

    await h.controller.selectResult('Solved');
    expect(h.sendCaptureBody).toHaveBeenCalledOnce();
  });

  it.each<LeetCodeSnapshot>([
    snapshot({ code: '   ' }),
    {
      codeAvailable: false,
      problem: snapshot().problem,
      language: 'Unknown',
      codeUnavailable: { reason: 'NO_READABLE_EDITOR_MODEL' },
      fingerprint: null,
    },
  ])('blocks blank or unreadable code without posting', async (unreadable) => {
    const h = harness({ initial: unreadable, fresh: unreadable });
    await h.controller.initialize(unreadable);

    await h.controller.selectResult('Solved');

    expect(h.sendCaptureBody).not.toHaveBeenCalled();
    expect(h.controller.view).toMatchObject({
      mode: 'blocked',
      message:
        'Open the LeetCode code editor with non-blank code, then try again. Reload the page if it stays unavailable.',
    });
  });

  it('does not post and exposes Settings when the bridge token is missing', async () => {
    const h = harness({ token: '' });
    await initialize(h);

    await h.controller.selectResult('Solved');

    expect(h.getProblemStatus).not.toHaveBeenCalled();
    expect(h.sendCaptureBody).not.toHaveBeenCalled();
    expect(h.controller.view).toMatchObject({
      mode: 'blocked',
      showSettings: true,
      message: 'Open Bridge settings and save your bridge token first.',
    });
  });

  it('prevents concurrent double-click submissions', async () => {
    let resolveSend!: (value: CaptureResult) => void;
    const send = vi
      .fn<() => Promise<CaptureResult>>()
      .mockImplementationOnce(
        () =>
          new Promise<CaptureResult>((resolve) => {
            resolveSend = resolve;
          }),
      )
      .mockResolvedValue(success);
    const h = harness({ send });
    await initialize(h);

    const first = h.controller.selectResult('Solved');
    const second = h.controller.selectResult('Needed help');
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(h.controller.view).toMatchObject({
      mode: 'retry',
      busy: true,
      loggedResult: 'Solved',
    });
    resolveSend(success);
    await Promise.all([first, second]);

    expect(h.randomUUID).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not let an earlier status response overwrite the successful capture review label', async () => {
    let resolveStatus!: (status: ProblemStatus) => void;
    const h = harness();
    h.getProblemStatus.mockImplementationOnce(
      () =>
        new Promise<ProblemStatus>((resolve) => {
          resolveStatus = resolve;
        }),
    );

    const initialization = h.controller.initialize(snapshot());
    await vi.waitFor(() => expect(h.controller.view.mode).toBe('ready'));
    await h.controller.selectResult('Solved');
    resolveStatus({
      found: true,
      practiceState: 'Solved',
      solvedStreak: 2,
      nextReview: '2026-07-23',
      lastAttempt: '2026-07-19T12:00:00Z',
    });
    await initialization;

    expect(h.controller.view).toMatchObject({
      reviewLabel: 'Review on 2026-07-21',
      message: 'Logged. Solved. Next review: 2026-07-21.',
    });
  });

  it('does not expose a concurrent retry when context changes during a submission', async () => {
    let resolveSend!: (value: CaptureResult) => void;
    const send = vi
      .fn<() => Promise<CaptureResult>>()
      .mockImplementationOnce(
        () =>
          new Promise<CaptureResult>((resolve) => {
            resolveSend = resolve;
          }),
      )
      .mockResolvedValue(success);
    const h = harness({ send });
    await initialize(h);

    const submission = h.controller.selectResult('Solved');
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await h.controller.acceptSnapshot(
      snapshot({ code: 'changed code', fingerprint: 'changed-fingerprint' }),
    );
    await h.controller.retryPending();

    expect(send).toHaveBeenCalledOnce();
    expect(h.controller.view.busy).toBe(true);
    resolveSend(success);
    await submission;
  });

  it('keeps the click lock while a context update arrives during fresh extraction', async () => {
    let resolveFresh!: (value: LeetCodeSnapshot) => void;
    const h = harness();
    h.getFreshSnapshot.mockImplementationOnce(
      () =>
        new Promise<LeetCodeSnapshot>((resolve) => {
          resolveFresh = resolve;
        }),
    );
    await initialize(h);

    const first = h.controller.selectResult('Solved');
    await vi.waitFor(() => expect(h.getFreshSnapshot).toHaveBeenCalledOnce());
    await h.controller.acceptSnapshot(snapshot());
    const second = h.controller.selectResult('Needed help');
    resolveFresh(snapshot());
    await Promise.all([first, second]);

    expect(h.randomUUID).toHaveBeenCalledOnce();
    expect(h.sendCaptureBody).toHaveBeenCalledOnce();
  });

  it('does not post after the controller is deactivated during click-time extraction', async () => {
    let resolveFresh!: (snapshot: LeetCodeSnapshot) => void;
    const h = harness();
    h.getFreshSnapshot.mockImplementationOnce(
      () =>
        new Promise<LeetCodeSnapshot>((resolve) => {
          resolveFresh = resolve;
        }),
    );
    await initialize(h);

    const selection = h.controller.selectResult('Solved');
    await vi.waitFor(() => expect(h.getFreshSnapshot).toHaveBeenCalledOnce());
    h.controller.deactivate();
    resolveFresh(snapshot());
    await selection;

    expect(h.sendCaptureBody).not.toHaveBeenCalled();
  });
});

describe('SidePanelController retry and lock state', () => {
  it.each([
    ['network', new CaptureRequestError('Could not reach the local bridge.', null, 'uncertain')],
    ['server', new CaptureRequestError('Bridge failed.', 503, 'uncertain')],
    ['invalid success', new CaptureRequestError('Invalid success.', 201, 'uncertain')],
  ])('retains the exact body after an uncertain %s response', async (_label, error) => {
    const area = new FakeSessionArea();
    const first = harness({ area, send: vi.fn().mockRejectedValue(error) });
    await initialize(first);
    await first.controller.selectResult('Solved');
    const stored = await first.store.read();
    expect(stored.pending?.body).toContain('eb9fdc89-8098-4f76-9a68-26e94dc75fc6');
    expect(first.controller.view.mode).toBe('retry');

    const retrySend = vi.fn(async () => success);
    const reopened = harness({ area, send: retrySend });
    await reopened.controller.initialize(snapshot());
    await reopened.controller.retryPending();

    expect(reopened.getFreshSnapshot).not.toHaveBeenCalled();
    expect(retrySend).toHaveBeenCalledWith(settings, stored.pending!.body);
    expect(reopened.controller.view.mode).toBe('ready');
  });

  it('retains an exact retry in memory when clearing storage fails after a successful POST', async () => {
    const area = new FakeSessionArea();
    const write = vi.spyOn(area, 'set');
    write
      .mockImplementationOnce(async (items) => {
        Object.assign(area.values, items);
      })
      .mockRejectedValueOnce(new Error('session storage unavailable'))
      .mockImplementation(async (items) => {
        Object.assign(area.values, items);
      });
    const send = vi
      .fn()
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce({
        ...success,
        duplicate: true,
      });
    const h = harness({ area, send });
    await initialize(h);

    await h.controller.selectResult('Solved');
    expect(h.controller.view.mode).toBe('retry');
    const stored = await h.store.read();
    expect(stored.pending).not.toBeNull();

    await h.controller.retryPending();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![1]).toBe(send.mock.calls[0]![1]);
    expect(h.controller.view).toMatchObject({ mode: 'ready', loggedResult: 'Solved' });
  });

  it('keeps retry as the only action when the page fingerprint changes', async () => {
    const area = new FakeSessionArea();
    const first = harness({
      area,
      send: vi.fn().mockRejectedValue(new CaptureRequestError('Bridge failed.', 500, 'uncertain')),
    });
    await initialize(first);
    await first.controller.selectResult('Needed help');

    await first.controller.acceptSnapshot(
      snapshot({ code: 'brand new code', fingerprint: 'brand-new-fingerprint' }),
    );

    expect(first.controller.view).toMatchObject({ mode: 'retry', loggedResult: 'Needed help' });
    expect((await first.store.read()).pending?.fingerprint).toBe('fingerprint-two-sum');
  });

  it('preserves an uncertain pending event when its tab controller is deactivated and rebound', async () => {
    const area = new FakeSessionArea();
    const first = harness({
      area,
      send: vi.fn().mockRejectedValue(new CaptureRequestError('Bridge failed.', 500, 'uncertain')),
    });
    await initialize(first);
    await first.controller.selectResult('Needed help');
    first.controller.deactivate();

    const rebound = harness({ area });
    await initialize(rebound);

    expect(rebound.controller.view).toMatchObject({
      mode: 'retry',
      loggedResult: 'Needed help',
    });
    expect((await rebound.store.read()).pending?.clientEventId).toBe(
      'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
    );
  });

  it.each([400, 401, 403])('clears pending after definitive HTTP %s', async (status) => {
    const area = new FakeSessionArea();
    const first = harness({
      area,
      send: vi.fn().mockRejectedValue(new CaptureRequestError('Rejected.', status, 'definitive')),
    });
    await initialize(first);
    await first.controller.selectResult('Solved');

    expect((await first.store.read()).pending).toBeNull();
    expect(first.controller.view).toMatchObject({
      mode: status === 401 || status === 403 ? 'blocked' : 'ready',
      showSettings: status === 401 || status === 403,
    });
  });

  it('builds a new event after a definitive validation reset', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new CaptureRequestError('Rejected.', 400, 'definitive'))
      .mockResolvedValueOnce(success);
    const h = harness({ send });
    await initialize(h);

    await h.controller.selectResult('Solved');
    await h.controller.selectResult('Solved');

    const firstBody = send.mock.calls[0]![1] as string;
    const secondBody = send.mock.calls[1]![1] as string;
    expect(JSON.parse(firstBody).clientEventId).not.toBe(JSON.parse(secondBody).clientEventId);
  });

  it('presents duplicate success across reopen and clears it only when the fingerprint changes', async () => {
    const area = new FakeSessionArea();
    const duplicate = { ...success, duplicate: true };
    const first = harness({ area, send: vi.fn(async () => duplicate) });
    await initialize(first);
    await first.controller.selectResult('Solved');
    expect(first.controller.view.message).toBe('Already logged. Solved. Next review: 2026-07-21.');

    const reopened = harness({ area });
    await initialize(reopened);
    expect(reopened.controller.view).toMatchObject({ mode: 'ready', loggedResult: 'Solved' });
    expect(reopened.sendCaptureBody).not.toHaveBeenCalled();

    await reopened.controller.acceptSnapshot(snapshot({ fingerprint: 'changed-fingerprint' }));
    expect(reopened.controller.view.mode).toBe('ready');
    expect((await reopened.store.read()).lastSuccess).toBeNull();
  });

  it('logs two deliberate same-fingerprint clicks with distinct Client Event IDs', async () => {
    const h = harness();
    await initialize(h);

    await h.controller.selectResult('Solved');
    await h.controller.selectResult('Needed help');

    expect(h.sendCaptureBody).toHaveBeenCalledTimes(2);
    const first = JSON.parse(h.sendCaptureBody.mock.calls[0]![1] as string) as CaptureEvent;
    const second = JSON.parse(h.sendCaptureBody.mock.calls[1]![1] as string) as CaptureEvent;
    expect(first.clientEventId).not.toBe(second.clientEventId);
    expect(first.attempt.code).toBe(second.attempt.code);
    expect(h.controller.view).toMatchObject({ mode: 'ready', loggedResult: 'Needed help' });
  });

  it('keeps the last successful result selected when a later deliberate capture is rejected', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(success)
      .mockRejectedValueOnce(new CaptureRequestError('Rejected.', 422, 'definitive'));
    const h = harness({ send });
    await initialize(h);

    await h.controller.selectResult('Solved');
    await h.controller.selectResult('Needed help');

    expect(h.controller.view).toMatchObject({ mode: 'ready', loggedResult: 'Solved' });
    expect((await h.store.read()).lastSuccess?.result).toBe('Solved');
  });

  it('does not unlock success when code becomes temporarily unreadable', async () => {
    const area = new FakeSessionArea();
    const first = harness({ area });
    await initialize(first);
    await first.controller.selectResult('Solved');

    await first.controller.acceptSnapshot({
      codeAvailable: false,
      problem: snapshot().problem,
      language: 'Python',
      codeUnavailable: { reason: 'NO_READABLE_EDITOR_MODEL' },
      fingerprint: null,
    });

    expect(first.controller.view.loggedResult).toBe('Solved');
    expect((await first.store.read()).lastSuccess?.fingerprint).toBe('fingerprint-two-sum');
  });

  it('unlocks the current code after a changed-page pending attempt resolves', async () => {
    const area = new FakeSessionArea();
    const first = harness({
      area,
      send: vi.fn().mockRejectedValue(new CaptureRequestError('Bridge failed.', 500, 'uncertain')),
    });
    await initialize(first);
    await first.controller.selectResult('Solved');
    await first.controller.acceptSnapshot(
      snapshot({ code: 'brand new code', fingerprint: 'brand-new-fingerprint' }),
    );

    const reopened = harness({ area, send: vi.fn(async () => success) });
    await reopened.controller.initialize(
      snapshot({ code: 'brand new code', fingerprint: 'brand-new-fingerprint' }),
    );
    await reopened.controller.retryPending();

    expect(reopened.controller.view).toMatchObject({
      mode: 'ready',
      message: 'The previous attempt is resolved. Choose an outcome for the current code.',
    });
    expect((await reopened.store.read()).lastSuccess).toBeNull();
  });
});

describe('problem status labels', () => {
  it.each<[ProblemStatus, string]>([
    [{ found: false }, 'New'],
    [
      {
        found: true,
        practiceState: 'New',
        solvedStreak: 0,
        nextReview: null,
        lastAttempt: null,
      },
      'New',
    ],
    [
      {
        found: true,
        practiceState: 'Solved',
        solvedStreak: 1,
        nextReview: '2026-07-20',
        lastAttempt: '2026-07-19T12:00:00Z',
      },
      'Due now',
    ],
    [
      {
        found: true,
        practiceState: 'Solved',
        solvedStreak: 2,
        nextReview: '2026-07-23',
        lastAttempt: '2026-07-20T12:00:00Z',
      },
      'Review on 2026-07-23',
    ],
    [
      {
        found: true,
        practiceState: 'Mastered',
        solvedStreak: 5,
        nextReview: null,
        lastAttempt: '2026-07-20T12:00:00Z',
      },
      'Mastered',
    ],
  ])('renders %# as %s', async (problemStatus, expected) => {
    const h = harness({ status: problemStatus });
    await initialize(h);
    expect(h.controller.view.reviewLabel).toBe(expected);
  });
});
