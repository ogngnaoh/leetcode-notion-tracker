// Injected into ONLY synthetic benchmark child processes, never the installed extension/bridge.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const config = JSON.parse(readFileSync(process.env.LCTRACK_BENCH_CONFIG, 'utf8'));
if (config.synthetic !== true || !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.fixtureUrl)) {
  throw new Error('Synthetic benchmark configuration required');
}
// Set synthetic values before dotenv runs; never inherit or read the repository's .env.
process.env.NOTION_TOKEN = 'benchmark-synthetic';
process.env.NOTION_MANIFEST_PATH = config.manifest;
process.env.BRIDGE_TOKEN = 'benchmark-synthetic-bridge-token';
process.env.PORT = String(config.port);
process.env.DAILY_NEW_PROBLEM_GOAL = '10';
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin === 'https://api.notion.com') {
    return originalFetch(`${config.fixtureUrl}${url.pathname}${url.search}`, init);
  }
  if (url.origin === `http://127.0.0.1:${config.port}`) return originalFetch(input, init);
  throw new Error('Benchmark blocked a non-fixture network request');
};
// Each process writes its own counters. Samples include all Node launcher/loader processes.
// The same instrumentation runs in each variant; OS sampling additionally covers non-Node children.
const report = () => {
  const cpu = process.cpuUsage();
  writeFileSync(
    join(config.metrics, `${process.pid}.json`),
    JSON.stringify({
      pid: process.pid,
      ppid: process.ppid,
      processStartedAt: performance.timeOrigin,
      cpuMs: (cpu.user + cpu.system) / 1000,
      rssMiB: process.memoryUsage.rss() / 1048576,
      peakMiB: process.resourceUsage().maxRSS / 1024,
    }),
  );
};
report();
setInterval(report, 250).unref();
process.on('exit', report);
// Let the launcher's synchronous signal forwarding run before terminating this process.
process.on('SIGTERM', () => {
  report();
  setImmediate(() => process.exit(0));
});
globalThis.__benchmarkConfig = config;
