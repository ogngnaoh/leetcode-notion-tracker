import { describe, expect, it } from 'vitest';
import { createApp } from '../src/bridge/app.js';
import { CaptureService } from '../src/bridge/capture-service.js';
import { MemoryCaptureRepository } from '../src/bridge/memory-repository.js';

const payload = {
  clientEventId: 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
  problem: {
    slug: 'two-sum',
    title: '1. Two Sum',
    number: 1,
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'Easy',
  },
  attempt: {
    attemptedAt: '2026-07-20T12:00:00.000Z',
    language: 'Python',
    submissionResult: 'Accepted',
    outcome: 'Green',
    coldAttempt: true,
    helpUsed: 'None',
    failureCode: null,
    totalMinutes: 12,
    primaryPattern: 'Arrays & Hashing',
    notes: 'One-pass hash map.',
    code: null,
  },
};

describe('bridge app', () => {
  it('exposes an unauthenticated health endpoint', async () => {
    const app = createApp({
      bridgeToken: 'a-very-long-personal-bridge-token',
      captureService: new CaptureService(new MemoryCaptureRepository()),
    });
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'leetcode-notion-bridge' });
  });

  it('rejects a capture without the bridge token', async () => {
    const app = createApp({
      bridgeToken: 'a-very-long-personal-bridge-token',
      captureService: new CaptureService(new MemoryCaptureRepository()),
    });
    const response = await app.request('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(401);
  });

  it('accepts a valid capture with the bridge token', async () => {
    const app = createApp({
      bridgeToken: 'a-very-long-personal-bridge-token',
      captureService: new CaptureService(new MemoryCaptureRepository()),
    });
    const response = await app.request('/api/capture', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer a-very-long-personal-bridge-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ duplicate: false });
  });
});
