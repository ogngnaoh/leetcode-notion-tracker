import { readFileSync } from 'node:fs';
import { CaptureService } from '../../src/bridge/capture-service.js';
import { NotionCaptureRepository } from '../../src/bridge/notion-repository.js';
import { CaptureEventSchema } from '../../src/shared/contract.js';
import { FrameReader, frame } from './protocol.js';

// Experimental host: synthetic configuration required. This is not an installer or production host.
const config = JSON.parse(readFileSync(process.env.LCTRACK_BENCH_CONFIG!, 'utf8'));
if (config.synthetic !== true) throw new Error('Synthetic benchmark only');
const service = new CaptureService(
  await NotionCaptureRepository.create('benchmark-synthetic', config.manifest),
);
let active = 0;
let timer: ReturnType<typeof setTimeout>;
function scheduleExit() {
  clearTimeout(timer);
  if (!active) timer = setTimeout(() => process.exit(0), config.idleMs);
}
const reader = new FrameReader((request) => {
  clearTimeout(timer);
  active++;
  void (async () => {
    if (!request || request.version !== 1 || typeof request.id !== 'string')
      throw new Error('Invalid request');
    switch (request.op) {
      case 'capture':
        return service.capture(CaptureEventSchema.parse(request.event));
      case 'status':
        if (typeof request.slug !== 'string' || !/^[a-z0-9-]+$/.test(request.slug))
          throw new Error('Invalid slug');
        return service.getProblemStatus(request.slug);
      case 'dashboard': {
        const repository = await NotionCaptureRepository.create(
          'benchmark-synthetic',
          config.manifest,
        );
        return repository.loadDashboard('2026-09-03');
      }
      case 'ping':
        return { pid: process.pid };
      default:
        throw new Error('Unsupported benchmark operation');
    }
  })()
    .then(
      (value) => process.stdout.write(frame({ id: request.id, ok: true, value })),
      () =>
        process.stdout.write(
          frame({ id: request?.id, ok: false, error: 'Benchmark request failed' }),
        ),
    )
    .finally(() => {
      active--;
      scheduleExit();
    });
});
process.stdin.on('data', (chunk: Buffer) => {
  try {
    reader.push(chunk);
  } catch {
    process.exitCode = 1;
    process.stdin.destroy();
  }
});
process.stdin.on('end', () => {
  if (!active) process.exit(0);
});
scheduleExit();
