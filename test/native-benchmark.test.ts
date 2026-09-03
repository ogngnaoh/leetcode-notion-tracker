import { describe, expect, it } from 'vitest';
import { Client } from '@notionhq/client';
import { CaptureService } from '../src/bridge/capture-service.js';
import { NotionCaptureRepository } from '../src/bridge/notion-repository.js';
import { FrameReader, frame } from '../scripts/benchmark/protocol.js';
import { SyntheticNotion, manifest, captureEvent } from '../scripts/benchmark/fixture.js';

describe('isolated native benchmark', () => {
  it('decodes split UTF-8 frames and coalesced messages without losing bytes', () => {
    const values: unknown[] = [];
    const reader = new FrameReader((value) => values.push(value));
    const bytes = Buffer.concat([frame({ text: 'λ🙂' }), frame({ id: 2 })]);
    for (const byte of bytes) reader.push(Buffer.from([byte]));
    expect(values).toEqual([{ text: 'λ🙂' }, { id: 2 }]);
  });

  it('rejects oversized frames from their header before buffering the payload', () => {
    const reader = new FrameReader(() => undefined);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(1_048_577);
    expect(() => reader.push(header)).toThrow(/size/i);
  });

  it('exercises real repository writes and counts capture and dashboard calls separately', async () => {
    const fake = new SyntheticNotion();
    const client = new Client({
      auth: 'benchmark-synthetic',
      fetch: async (url, init) => fake.respond(String(url), init),
    });
    const repository = new NotionCaptureRepository(client, manifest);
    const service = new CaptureService(repository);
    const first = await service.capture(captureEvent(0));
    expect(fake.counts).toEqual({ capture: 6, dashboard: 0 });
    fake.resetCounts();
    const second = await service.capture(captureEvent(1));
    expect(second.attemptPageId).toBe(first.attemptPageId);
    expect(fake.counts).toEqual({ capture: 10, dashboard: 0 });
    fake.resetCounts();
    expect((await service.capture(captureEvent(1))).duplicate).toBe(true);
    expect(fake.counts).toEqual({ capture: 5, dashboard: 0 });
    fake.resetCounts();
    expect(await repository.loadDashboard('2026-09-03')).toMatchObject({ newProblemCount: 1 });
    expect(fake.counts).toEqual({ capture: 0, dashboard: 2 });
  });

  it('retains fixture data across helper recreation and concurrent same-problem captures', async () => {
    const fake = new SyntheticNotion();
    const service = () =>
      new CaptureService(
        new NotionCaptureRepository(
          new Client({
            auth: 'benchmark-synthetic',
            fetch: async (url, init) => fake.respond(String(url), init),
          }),
          manifest,
        ),
      );
    const first = await service().capture(captureEvent(0));
    expect((await service().capture(captureEvent(0))).duplicate).toBe(true);
    const shared = service();
    const results = await Promise.all([
      shared.capture(captureEvent(1)),
      shared.capture(captureEvent(2)),
    ]);
    expect(results.every((result) => result.attemptPageId === first.attemptPageId)).toBe(true);
    expect(await shared.getProblemStatus('two-sum')).toMatchObject({ solvedStreak: 3 });
  });

  it('rejects fixture routes it does not explicitly implement', async () => {
    const fake = new SyntheticNotion();
    await expect(fake.respond('https://api.notion.com/v1/users', {})).rejects.toThrow(
      /unsupported/i,
    );
  });
});
