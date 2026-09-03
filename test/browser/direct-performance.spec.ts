import { test, expect } from '@playwright/test';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { DirectExtensionFixture, TEST_PASSPHRASE } from './direct-extension-fixture.js';
import { captureEvent } from '../../scripts/benchmark/fixture.js';

test('measures nine direct MV3 samples separately from unlock and cold-worker work', async () => {
  test.setTimeout(180_000);
  const fixture = new DirectExtensionFixture();
  await fixture.launch();
  try {
    const panel = await fixture.panel();
    await fixture.connect(panel);
    fixture.notion.latencyMs = 20;
    const samples: Array<Record<string, number | null>> = [];
    const timed = async <T>(operation: () => Promise<T>) => {
      const start = performance.now();
      const result = await operation();
      return { ms: performance.now() - start, result };
    };
    for (let index = 0; index < 9; index++) {
      await fixture.rpc(panel, { op: 'connection.lock' });
      const before = await fixture.browserCommand('SystemInfo.getProcessInfo');
      const unlock = await timed(() =>
        fixture.rpc(panel, { op: 'connection.unlock', passphrase: TEST_PASSPHRASE }),
      );
      await fixture.stopWorker();
      const cold = await timed(() => fixture.rpc(panel, { op: 'connection.state' }));
      expect(cold.result.connection.unlocked).toBe(true);
      const first = captureEvent(index * 2);
      first.problem = {
        ...first.problem,
        slug: `benchmark-${index}`,
        title: `Benchmark ${index}`,
        url: `https://leetcode.com/problems/benchmark-${index}/`,
      };
      if (index === 8) first.attempt.code = '界'.repeat(20_000);
      const replacement = captureEvent(index * 2 + 1);
      replacement.problem = first.problem;
      const source = { tabId: 1, fingerprint: `benchmark-${index}` };
      fixture.network.length = 0;
      const initial = await timed(() =>
        fixture.rpc(panel, { op: 'capture.submit', event: first, source }),
      );
      const firstRequests = fixture.network.length;
      expect(firstRequests).toBe(6);
      fixture.network.length = 0;
      const replace = await timed(() =>
        fixture.rpc(panel, { op: 'capture.submit', event: replacement, source }),
      );
      const replacementRequests = fixture.network.length;
      expect(replacementRequests).toBe(10);
      expect(replace.result.completed?.result.attemptPageId).toBe(
        initial.result.completed?.result.attemptPageId,
      );
      fixture.network.length = 0;
      const retained = await timed(() =>
        fixture.rpc(panel, { op: 'capture.submit', event: replacement, source }),
      );
      expect(fixture.network).toHaveLength(0);
      const duplicate = await timed(() =>
        fixture.rpc(panel, { op: 'capture.submit', event: first, source }),
      );
      const duplicateRequests = fixture.network.length;
      expect(duplicateRequests).toBe(5);
      const after = await fixture.browserCommand('SystemInfo.getProcessInfo');
      const previous = new Map<number, number>(
        before.processInfo.map((p: { id: number; cpuTime: number }) => [p.id, p.cpuTime]),
      );
      const browserCpuMs = after.processInfo.reduce(
        (sum: number, p: { id: number; cpuTime: number }) =>
          sum + Math.max(0, p.cpuTime - (previous.get(p.id) ?? 0)) * 1000,
        0,
      );
      samples.push({
        index,
        unicodeCharacters: index === 8 ? 20_000 : null,
        unlockMs: unlock.ms,
        coldWorkerMs: cold.ms,
        firstMs: initial.ms,
        replacementMs: replace.ms,
        retainedDuplicateMs: retained.ms,
        historicalDuplicateMs: duplicate.ms,
        browserCpuMs,
        firstRequests,
        replacementRequests,
        duplicateRequests,
      });
    }
    const summary = Object.fromEntries(
      [
        'unlockMs',
        'coldWorkerMs',
        'firstMs',
        'replacementMs',
        'retainedDuplicateMs',
        'historicalDuplicateMs',
        'browserCpuMs',
      ].map((key) => {
        const values = samples.map((sample) => sample[key] ?? 0).sort((a, b) => a - b);
        return [key, { median: values[4], max: values.at(-1) }];
      }),
    );
    const bundles = Object.fromEntries(
      await Promise.all(
        [
          'background.js',
          'sidepanel.js',
          'content.js',
          'leetcode-model-bridge.js',
          'options.js',
        ].map(async (name) => [name, (await stat(`dist/extension/${name}`)).size]),
      ),
    );
    const manifest = JSON.parse(await readFile('dist/extension/manifest.json', 'utf8'));
    await mkdir('build/direct-benchmark', { recursive: true });
    await writeFile(
      'build/direct-benchmark/results.json',
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          version: manifest.version,
          node: process.version,
          os: release(),
          cpu: cpus()[0]?.model,
          browser: fixture.context.browser()?.version(),
          fixtureLatencyMs: 20,
          scope:
            'Actual packaged MV3 worker with synthetic Notion; whole isolated browser CPU, not extension-only CPU or real Notion latency. No memory-saving claim.',
          samples,
          summary,
          bundles,
        },
        null,
        2,
      ),
    );
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
