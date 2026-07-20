import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProblemStatus, sendCapture } from '../extension/src/api.js';
import {
  CaptureRequestError,
  CaptureSubmissionCoordinator,
} from '../extension/src/capture-submission.js';
import type { CaptureEvent, CaptureResult } from '../src/shared/contract.js';

const settings = {
  bridgeUrl: 'http://127.0.0.1:8787',
  bridgeToken: 'a-very-long-personal-bridge-token',
};

function captureEvent(clientEventId = 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6'): CaptureEvent {
  return {
    clientEventId,
    problem: {
      slug: 'two-sum',
      title: 'Two Sum',
      number: 1,
      url: 'https://leetcode.com/problems/two-sum/',
      difficulty: 'Easy',
      topics: ['Array', 'Hash Table'],
    },
    attempt: {
      attemptedAt: '2026-07-20T08:30:00-04:00',
      attemptedOn: '2026-07-20',
      language: 'Python',
      code: 'def twoSum(nums, target):\n    return []',
      result: 'Solved',
    },
  };
}

const captureResult: CaptureResult = {
  duplicate: false,
  problemPageId: 'problem-page-id',
  attemptPageId: 'attempt-page-id',
  review: {
    practiceState: 'Solved',
    solvedStreak: 1,
    nextReview: '2026-07-21',
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CaptureSubmissionCoordinator', () => {
  it('clears the pending event after a successful submission', async () => {
    const coordinator = new CaptureSubmissionCoordinator();
    const event = captureEvent();
    const buildEvent = vi.fn(() => event);
    const sendEvent = vi.fn(async () => captureResult);

    await expect(coordinator.submit(buildEvent, sendEvent)).resolves.toEqual(captureResult);

    expect(buildEvent).toHaveBeenCalledOnce();
    expect(sendEvent).toHaveBeenCalledWith(event);
    expect(coordinator.hasPending).toBe(false);
  });

  it('reuses the exact pending event after an uncertain failure', async () => {
    const coordinator = new CaptureSubmissionCoordinator();
    const event = captureEvent();
    const buildEvent = vi.fn(() => event);
    const sendEvent = vi
      .fn<(event: CaptureEvent) => Promise<CaptureResult>>()
      .mockRejectedValueOnce(new CaptureRequestError('Bridge unavailable.', null, 'uncertain'))
      .mockResolvedValueOnce(captureResult);

    await expect(coordinator.submit(buildEvent, sendEvent)).rejects.toMatchObject({
      disposition: 'uncertain',
    });
    expect(coordinator.hasPending).toBe(true);

    await expect(coordinator.submit(buildEvent, sendEvent)).resolves.toEqual(captureResult);

    expect(buildEvent).toHaveBeenCalledOnce();
    expect(sendEvent.mock.calls[0]![0]).toBe(event);
    expect(sendEvent.mock.calls[1]![0]).toBe(event);
    expect(coordinator.hasPending).toBe(false);
  });

  it('clears the pending event after a definitive rejection', async () => {
    const coordinator = new CaptureSubmissionCoordinator();
    const first = captureEvent();
    const second = captureEvent('d83d5722-13dd-4b2f-8d60-115613364ed4');
    const buildEvent = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const sendEvent = vi
      .fn<(event: CaptureEvent) => Promise<CaptureResult>>()
      .mockRejectedValueOnce(new CaptureRequestError('Invalid capture event.', 400, 'definitive'))
      .mockResolvedValueOnce(captureResult);

    await expect(coordinator.submit(buildEvent, sendEvent)).rejects.toMatchObject({
      status: 400,
      disposition: 'definitive',
    });
    expect(coordinator.hasPending).toBe(false);

    await coordinator.submit(buildEvent, sendEvent);

    expect(buildEvent).toHaveBeenCalledTimes(2);
    expect(sendEvent.mock.calls[1]![0]).toBe(second);
  });
});

describe('sendCapture', () => {
  it('classifies a network failure as uncertain without an HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(sendCapture(settings, captureEvent())).rejects.toEqual(
      new CaptureRequestError(
        'Could not reach the local bridge. Retry the same attempt.',
        null,
        'uncertain',
      ),
    );
  });

  it('classifies a 4xx response as a definitive rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid capture event' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(sendCapture(settings, captureEvent())).rejects.toEqual(
      new CaptureRequestError('Invalid capture event', 400, 'definitive'),
    );
  });

  it('classifies a 5xx response as uncertain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Capture failed. Retry the same attempt.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(sendCapture(settings, captureEvent())).rejects.toEqual(
      new CaptureRequestError('Capture failed. Retry the same attempt.', 503, 'uncertain'),
    );
  });

  it('classifies a malformed success response as uncertain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ duplicate: false }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(sendCapture(settings, captureEvent())).rejects.toEqual(
      new CaptureRequestError(
        'The local bridge returned an invalid success response. Retry the same attempt.',
        201,
        'uncertain',
      ),
    );
  });

  it('returns a validated capture result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(captureResult), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(sendCapture(settings, captureEvent())).resolves.toEqual(captureResult);
  });

  it('rejects a legacy review response as malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...captureResult,
            review: { mastery: 'Green', greenCount: 1, nextReview: '2026-07-23T12:00:00Z' },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(sendCapture(settings, captureEvent())).rejects.toMatchObject({
      message: 'The local bridge returned an invalid success response. Retry the same attempt.',
      disposition: 'uncertain',
    });
  });
});

describe('getProblemStatus', () => {
  it.each([
    [{ found: false }],
    [
      {
        found: true,
        practiceState: 'Solved',
        solvedStreak: 2,
        nextReview: '2026-07-23',
        lastAttempt: '2026-07-20T08:30:00-04:00',
      },
    ],
  ])('returns a validated exact status union', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(status), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProblemStatus(settings, 'two-sum')).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/problems/two-sum/status',
      expect.objectContaining({ method: 'GET', headers: { Authorization: expect.any(String) } }),
    );
  });

  it('rejects malformed or non-exact status responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ found: false, lastAttempt: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(getProblemStatus(settings, 'two-sum')).rejects.toMatchObject({
      message: 'The local bridge returned an invalid problem status.',
    });
  });

  it.each([
    '2026-07-20Z',
    '2026-07-20 08:30:00Z',
    '2026-02-30T08:30:00Z',
    '2026-07-20T24:30:00Z',
    '2026-07-20T08:30:00+24:00',
  ])(
    'rejects lastAttempt outside the shared ISO timestamp-with-offset contract: %s',
    async (lastAttempt) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              found: true,
              practiceState: 'Solved',
              solvedStreak: 1,
              nextReview: '2026-07-21',
              lastAttempt,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      );

      await expect(getProblemStatus(settings, 'two-sum')).rejects.toMatchObject({
        message: 'The local bridge returned an invalid problem status.',
      });
    },
  );
});
