// Run with: node scripts/benchmark/run.mjs [--quick]
// All hosts, profiles, credentials and Notion data are synthetic and temporary.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm, chmod } from 'node:fs/promises';
import { tmpdir, cpus, release } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const exec = promisify(execFile);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const root = resolve('.');
const quick = process.argv.includes('--quick');
const count = quick ? 2 : 9;
const temp = await mkdtemp(join(tmpdir(), 'lctrack-native-benchmark-'));
const output = resolve('build/native-benchmark', new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
let context;
let fixtureServer;
let running;
let cdp;
const summaries = [];
const log = (message) => console.log(message);
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const cleanEnv = { PATH: process.env.PATH, TMPDIR: temp };
const modes = ['launcher-tsx', 'prebuilt-http', 'native'];
let runIndex = 0;

async function waitUntil(check, timeout = 10000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    if (await check()) return;
    await sleep(20);
  }
  throw new Error('Benchmark condition timed out');
}
async function listen(server) {
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  return server.address().port;
}
async function unusedPort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((done) => server.close(done));
  return port;
}
function percentile(values, p) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? null;
}
async function processSnapshot() {
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,rss=,time=']);
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [pid, ppid, rss, time] = line.trim().split(/\s+/);
      const pieces = time.split(':').map(Number);
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        rssMiB: Number(rss) / 1024,
        cpuMs:
          (pieces.length === 3
            ? pieces[0] * 3600 + pieces[1] * 60 + pieces[2]
            : pieces[0] * 60 + pieces[1]) * 1000,
      };
    });
}
function descendants(rows, roots) {
  const ids = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (ids.has(row.ppid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        changed = true;
      }
  }
  return rows.filter((row) => ids.has(row.pid));
}

try {
  await symlink(resolve('node_modules'), join(temp, 'node_modules'), 'dir');
  await symlink(resolve('src'), join(temp, 'src'), 'dir');
  await mkdir(join(temp, 'build'));
  await writeFile(join(temp, '.env'), '# Synthetic benchmark only. No user credentials.\n');
  await writeFile(join(temp, 'package.json'), '{"type":"module"}\n');
  for (const [name, entry] of Object.entries({
    fixture: 'scripts/benchmark/fixture.ts',
    native: 'scripts/benchmark/native-host.ts',
    http: 'src/bridge/server.ts',
  })) {
    await build({
      entryPoints: [entry],
      outfile: join(temp, `${name}.mjs`),
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent',
    });
  }
  const { SyntheticNotion, manifest, captureEvent } = await import(
    pathToFileURL(join(temp, 'fixture.mjs'))
  );
  const fake = new SyntheticNotion();
  const manifestPath = join(temp, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  fixtureServer = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      const result = await fake.respond(`http://127.0.0.1${request.url}`, {
        method: request.method,
        ...(body ? { body } : {}),
      });
      response.writeHead(result.status, { 'Content-Type': 'application/json' });
      response.end(await result.text());
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          object: 'error',
          status: 400,
          code: 'validation_error',
          message: error.message,
        }),
      );
    }
  });
  const fixturePort = await listen(fixtureServer);
  const extension = join(temp, 'extension');
  const profile = join(temp, 'profile');
  const hostName = 'com.lctrack.synthetic_benchmark';
  await mkdir(extension);
  await mkdir(join(profile, 'NativeMessagingHosts'), { recursive: true });
  await writeFile(
    join(extension, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'LCTrack Synthetic Benchmark',
      version: '0.0.1',
      permissions: ['nativeMessaging'],
      host_permissions: ['http://127.0.0.1/*'],
      background: { service_worker: 'worker.js' },
    }),
  );
  await writeFile(
    join(extension, 'page.html'),
    '<!doctype html><title>LCTrack synthetic benchmark</title>',
  );
  await writeFile(
    join(extension, 'worker.js'),
    `
    let port; let sequence = 0; const pending = new Map();
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
      if (message.op === 'daily') { respond({ local: true }); return false; }
      if (message.op === 'disconnect') { port?.disconnect(); port = undefined; respond({ ok: true }); return false; }
      if (!port) {
        port = chrome.runtime.connectNative('${hostName}');
        port.onMessage.addListener(reply => {
          const callback = pending.get(reply.id); pending.delete(reply.id); callback?.(reply);
        });
        port.onDisconnect.addListener(() => {
          const error = chrome.runtime.lastError?.message ?? 'Host disconnected';
          port = undefined;
          for (const callback of pending.values()) callback({ ok: false, error });
          pending.clear();
        });
      }
      const id = String(++sequence); pending.set(id, respond);
      port.postMessage({ ...message, version: 1, id });
      return true;
    });
  `,
  );
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    env: cleanEnv,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/page.html`);
  cdp = await context.browser().newBrowserCDPSession();
  log(`Synthetic Chromium ${context.browser().version()}; ${process.version} ${process.arch}`);

  async function call(mode, config, op, event) {
    return page.evaluate(
      async ({ mode, config, op, event }) => {
        if (mode === 'native' || op === 'daily') {
          const response = await chrome.runtime.sendMessage({ op, event, slug: 'two-sum' });
          if (op === 'daily') return response;
          if (!response?.ok) throw new Error(response?.error ?? 'Empty native response');
          return response.value;
        }
        const path =
          op === 'ping'
            ? '/health'
            : op === 'capture'
              ? '/api/capture'
              : op === 'status'
                ? '/api/problems/two-sum/status'
                : '/dashboard?refresh=1';
        const response = await fetch('http://127.0.0.1:' + config.port + path, {
          method: op === 'capture' ? 'POST' : 'GET',
          headers: {
            Authorization: 'Bearer benchmark-synthetic-bridge-token',
            'Content-Type': 'application/json',
          },
          ...(op === 'capture' ? { body: JSON.stringify(event) } : {}),
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return op === 'dashboard' ? response.text() : response.json();
      },
      { mode, config: { port: config.port }, op, event },
    );
  }
  async function start(mode, idleMs = 5000) {
    const directory = join(temp, `run-${++runIndex}`);
    await mkdir(directory);
    const metrics = join(directory, 'metrics');
    await mkdir(metrics);
    const config = {
      synthetic: true,
      fixtureUrl: `http://127.0.0.1:${fixturePort}`,
      port: await unusedPort(),
      manifest: manifestPath,
      metrics,
      idleMs,
    };
    const configPath = join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify(config));
    const bootstrap = pathToFileURL(resolve('scripts/benchmark/bootstrap.mjs')).href;
    const env = {
      ...cleanEnv,
      LCTRACK_BENCH_CONFIG: configPath,
      NODE_OPTIONS: `--import=${bootstrap}`,
    };
    const osMax = new Map();
    const known = new Set();
    let peakTreeMiB = 0;
    let stopSampling = false;
    let child;
    const browserBefore = await cdp.send('SystemInfo.getProcessInfo');
    if (mode === 'native') {
      const executable = join(directory, 'native-host');
      await writeFile(
        executable,
        '#!/bin/sh\nexec /usr/bin/env -i ' +
          Object.entries(env)
            .map(([key, value]) => quote(`${key}=${value}`))
            .join(' ') +
          ' ' +
          quote(process.execPath) +
          ' ' +
          quote(join(temp, 'native.mjs')) +
          '\n',
      );
      await chmod(executable, 0o700);
      await writeFile(
        join(profile, 'NativeMessagingHosts', `${hostName}.json`),
        JSON.stringify({
          name: hostName,
          description: 'Temporary synthetic LCTrack benchmark',
          path: executable,
          type: 'stdio',
          allowed_origins: [`chrome-extension://${extensionId}/`],
        }),
      );
    }
    async function sample() {
      const rows = await processSnapshot();
      const files = await readdir(metrics);
      for (const file of files) if (file.endsWith('.json')) known.add(Number(file.slice(0, -5)));
      if (child) known.add(child.pid);
      const members = descendants(rows, known);
      for (const member of members) {
        known.add(member.pid);
        osMax.set(member.pid, Math.max(osMax.get(member.pid) ?? 0, member.cpuMs));
      }
      peakTreeMiB = Math.max(
        peakTreeMiB,
        members.reduce((sum, member) => sum + member.rssMiB, 0),
      );
      return members;
    }
    const sampler = (async () => {
      while (!stopSampling) {
        await sample();
        await sleep(100);
      }
    })();
    const started = performance.now();
    const startedAt = Date.now();
    if (mode !== 'native') {
      const args =
        mode === 'launcher-tsx'
          ? [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/benchmark/launcher.ts')]
          : [join(temp, 'http.mjs')];
      child = spawn(process.execPath, args, {
        cwd: temp,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let text = '';
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (chunk) => {
          text += chunk;
        });
      child.on('error', (error) => {
        text += error.message;
      });
      await waitUntil(async () => {
        if (child.exitCode !== null) throw new Error(`Benchmark host exited: ${text}`);
        return text.includes('bridge listening on');
      });
    }
    let ping;
    try {
      if (mode === 'native') ping = await call(mode, config, 'ping');
      else
        await waitUntil(async () => {
          try {
            ping = await call(mode, config, 'ping');
            return true;
          } catch {
            return false;
          }
        });
    } catch (error) {
      stopSampling = true;
      await sampler;
      child?.kill();
      throw error;
    }
    if (ping?.pid) known.add(ping.pid);
    const startupMs = performance.now() - started;
    const run = {
      mode,
      config,
      metrics,
      startupMs,
      known,
      call: (op, event) => call(mode, config, op, event),
      sample,
      async finish() {
        if (mode === 'native') {
          await page.evaluate(() => chrome.runtime.sendMessage({ op: 'disconnect' }));
        } else {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch (error) {
            if (error.code !== 'ESRCH') throw error;
          }
        }
        await waitUntil(async () => (await sample()).length === 0);
        stopSampling = true;
        await sampler;
        const values = [];
        for (const name of await readdir(metrics))
          values.push(JSON.parse(await readFile(join(metrics, name), 'utf8')));
        const cpu = new Map(osMax);
        for (const value of values)
          cpu.set(value.pid, Math.max(cpu.get(value.pid) ?? 0, value.cpuMs));
        const browserAfter = await cdp.send('SystemInfo.getProcessInfo');
        const before = new Map(browserBefore.processInfo.map((p) => [p.id, p.cpuTime]));
        const browserCpuMs = browserAfter.processInfo.reduce(
          (sum, p) => sum + Math.max(0, p.cpuTime - (before.get(p.id) ?? 0)) * 1000,
          0,
        );
        running = undefined;
        return {
          startupMs,
          nodeSpawnDelayMs: Math.min(...values.map((value) => value.processStartedAt)) - startedAt,
          hostCpuMs: [...cpu.values()].reduce((sum, value) => sum + value, 0),
          peakTreeMiB,
          observedHostProcesses: known.size,
          browserCpuMs,
          nodeCounters: values,
          durationMs: performance.now() - started,
        };
      },
    };
    running = run;
    return run;
  }
  const settle = () => waitUntil(() => fake.active === 0);
  async function measured(run, op, event) {
    const before = { ...fake.counts };
    const start = performance.now();
    const value = await run.call(op, event);
    const ms = performance.now() - start;
    await settle();
    return {
      ms,
      value,
      captureCalls: fake.counts.capture - before.capture,
      dashboardCalls: fake.counts.dashboard - before.dashboard,
    };
  }

  // Alternate order to reduce systematic warm-cache/order bias.
  for (const latency of quick ? [20] : [0, 20]) {
    fake.latencyMs = latency;
    for (let iteration = 0; iteration < count; iteration++) {
      for (const mode of iteration % 2 ? [...modes].reverse() : modes) {
        fake.reset();
        const run = await start(mode);
        await settle();
        const prefetchCalls = { ...fake.counts };
        const first = await measured(run, 'capture', captureEvent(0));
        assert.equal(first.captureCalls, 6);
        const replacement = await measured(run, 'capture', captureEvent(1));
        assert.equal(replacement.captureCalls, 10);
        const retry = await measured(run, 'capture', captureEvent(1));
        assert.equal(retry.value.duplicate, true);
        assert.equal(retry.captureCalls, 5);
        const resource = await run.finish();
        summaries.push({
          kind: 'timing',
          mode,
          latency,
          iteration,
          first,
          replacement,
          retry,
          prefetchCalls,
          ...resource,
        });
      }
      log(`Timing: ${latency} ms/Notion call, round ${iteration + 1}/${count} complete`);
    }
  }

  fake.latencyMs = 20;
  for (const mode of modes) {
    fake.reset();
    let run = await start(mode);
    await settle();
    const first = await measured(run, 'capture', captureEvent(0));
    const burst = [];
    for (let index = 1; index <= 6; index++)
      burst.push(await measured(run, 'capture', captureEvent(index)));
    const concurrent = await Promise.all([
      measured(run, 'capture', captureEvent(7)),
      measured(run, 'capture', captureEvent(8)),
    ]);
    assert(concurrent.every((item) => item.value.attemptPageId === first.value.attemptPageId));
    const dashboard = await measured(run, 'dashboard');
    const beforeIdle = await run.sample();
    await sleep(quick ? 5500 : 6500);
    const afterIdle = await run.sample();
    if (mode === 'native') assert.equal(afterIdle.length, 0, 'Native helper did not exit on idle');
    const segmentOne = await run.finish();
    if (mode === 'native') {
      run = await start(mode);
      const retryAfterRestart = await measured(run, 'capture', captureEvent(8));
      assert.equal(retryAfterRestart.value.duplicate, true);
      assert.equal(retryAfterRestart.value.attemptPageId, first.value.attemptPageId);
      const next = await measured(run, 'capture', captureEvent(9));
      assert.equal(next.value.attemptPageId, first.value.attemptPageId);
      const segmentTwo = await run.finish();
      summaries.push({ kind: 'restart', mode, retryAfterRestart, next, ...segmentTwo });
    }
    summaries.push({
      kind: 'session',
      mode,
      burst,
      concurrent,
      dashboard,
      beforeIdleMiB: beforeIdle.reduce((sum, p) => sum + p.rssMiB, 0),
      afterIdleMiB: afterIdle.reduce((sum, p) => sum + p.rssMiB, 0),
      afterIdleProcesses: afterIdle.length,
      ...segmentOne,
    });
    log(`Session: ${mode}: burst, two concurrent clients, dashboard and idle shutdown verified`);
  }

  if (!quick) {
    fake.reset();
    // Prove that a short idle timeout cannot interrupt a save taking longer than that timeout.
    fake.latencyMs = 150;
    let run = await start('native', 300);
    const slowSave = await measured(run, 'capture', captureEvent(0));
    assert(slowSave.ms > 300);
    await sleep(600);
    assert.equal((await run.sample()).length, 0);
    summaries.push({ kind: 'in-flight-safety', slowSave, ...(await run.finish()) });
    log('Native helper: save longer than idle timeout completed before shutdown');

    fake.reset();
    fake.latencyMs = 20;
    run = await start('native', 30000);
    const first = await measured(run, 'capture', captureEvent(0));
    await sleep(6500);
    assert((await run.sample()).length > 0);
    const second = await measured(run, 'capture', captureEvent(1));
    assert.equal(second.value.attemptPageId, first.value.attemptPageId);
    log('30-second grace: helper reused across a 6.5-second gap; observing shutdown');
    await sleep(31000);
    assert.equal((await run.sample()).length, 0);
    summaries.push({ kind: 'grace-30s', first, second, ...(await run.finish()) });
  }

  // Verify Daily Reps doesn't spawn a host; observe worker retirement without attaching a debugger to it.
  const lastConfig = await readFile(
    join(profile, 'NativeMessagingHosts', `${hostName}.json`),
    'utf8',
  );
  const lastMetrics = join(dirname(JSON.parse(lastConfig).path), 'metrics');
  const hostFilesBefore = await readdir(lastMetrics);
  await page.evaluate(() => chrome.runtime.sendMessage({ op: 'daily' }));
  const targetBefore = await cdp.send('Target.getTargets');
  if (!quick) await sleep(35000);
  const targetAfter = await cdp.send('Target.getTargets');
  assert.deepEqual(await readdir(lastMetrics), hostFilesBefore, 'Daily operation spawned a host');
  const workerTargets = (result) =>
    result.targetInfos.filter(
      (target) => target.type === 'service_worker' && target.url.includes(extensionId),
    ).length;
  const lifecycle = {
    observationMs: quick ? 0 : 35000,
    workersBefore: workerTargets(targetBefore),
    workersAfter: workerTargets(targetAfter),
    dailyOperationSpawnedHost: false,
    hostManifestUnchanged:
      lastConfig ===
      (await readFile(join(profile, 'NativeMessagingHosts', `${hostName}.json`), 'utf8')),
  };
  const report = {
    date: new Date().toISOString(),
    synthetic: true,
    machine: cpus()[0]?.model,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    node: process.version,
    chromium: context.browser().version(),
    repetitions: count,
    quick,
    lifecycle,
    samples: summaries,
  };
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  for (const mode of modes) {
    for (const latency of quick ? [20] : [0, 20]) {
      const rows = summaries.filter(
        (row) => row.kind === 'timing' && row.mode === mode && row.latency === latency,
      );
      log(
        JSON.stringify({
          mode,
          latency,
          n: rows.length,
          startupMedianMs: percentile(
            rows.map((r) => r.startupMs),
            0.5,
          ),
          startupP95Ms: percentile(
            rows.map((r) => r.startupMs),
            0.95,
          ),
          firstMedianMs: percentile(
            rows.map((r) => r.first.ms),
            0.5,
          ),
          replacementMedianMs: percentile(
            rows.map((r) => r.replacement.ms),
            0.5,
          ),
          cpuMedianMs: percentile(
            rows.map((r) => r.hostCpuMs),
            0.5,
          ),
          peakTreeMedianMiB: percentile(
            rows.map((r) => r.peakTreeMiB),
            0.5,
          ),
          browserCpuMedianMs: percentile(
            rows.map((r) => r.browserCpuMs),
            0.5,
          ),
        }),
      );
    }
  }
  log(`Results: ${join(output, 'results.json')}`);
} finally {
  if (running) await running.finish().catch((error) => log(`Cleanup: ${error.message}`));
  if (context) await context.close();
  if (fixtureServer) await new Promise((done) => fixtureServer.close(done));
  // Only the mkdtemp-created benchmark directory is removed. Results stay under ignored build/.
  await rm(temp, { recursive: true, force: true });
}
