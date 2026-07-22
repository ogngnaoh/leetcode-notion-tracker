import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { promisify } from 'node:util';
import * as launcher from '../src/launcher/bridge-launcher.js';

const root = resolve(import.meta.dirname, '..');
const execFileAsync = promisify(execFile);

describe('visible bridge launcher', () => {
  it('provides an importable launcher coordinator', async () => {
    await expect(access(resolve(root, 'src/launcher/bridge-launcher.ts'))).resolves.toBeUndefined();
  });

  it('recognizes only the expected bridge health response', async () => {
    const probe = launcher.probeExpectedBridge;
    const exactFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, service: 'leetcode-notion-bridge' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const unrelatedFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, service: 'other-service' }), { status: 200 }),
    );

    await expect(probe(8787, exactFetch)).resolves.toBe(true);
    await expect(probe(8787, unrelatedFetch)).resolves.toBe(false);
    await expect(
      probe(
        8787,
        vi.fn(async () => Promise.reject(new Error('offline'))),
      ),
    ).resolves.toBe(false);
    expect(exactFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('does not start another process when the expected bridge is already healthy', async () => {
    const isPortOccupied = vi.fn(async () => true);

    await expect(
      launcher.decideBridgeStartup(8787, {
        probeHealth: vi.fn(async () => true),
        isPortOccupied,
      }),
    ).resolves.toBe('already-running');
    expect(isPortOccupied).not.toHaveBeenCalled();
  });

  it('opens the dashboard once for an already healthy bridge', async () => {
    const openDashboard = vi.fn(async () => undefined);
    await expect(
      launcher.runBridgeLauncher(
        { root: '/tracker', port: 8787, manifestPath: 'build/notion-manifest.json' },
        {
          exists: vi.fn(async () => true),
          probeHealth: vi.fn(async () => true),
          isPortOccupied: vi.fn(async () => true),
          spawnBridge: vi.fn(),
          signals: new EventEmitter(),
          log: vi.fn(),
          nodeExecutable: '/node',
          openDashboard,
        },
      ),
    ).resolves.toBe(0);
    expect(openDashboard).toHaveBeenCalledOnce();
    expect(openDashboard).toHaveBeenCalledWith('http://127.0.0.1:8787/dashboard');
  });

  it('logs the dashboard URL and remains successful when macOS open fails', async () => {
    const log = vi.fn();
    await expect(
      launcher.runBridgeLauncher(
        { root: '/tracker', port: 8787, manifestPath: 'build/notion-manifest.json' },
        {
          exists: vi.fn(async () => true),
          probeHealth: vi.fn(async () => true),
          isPortOccupied: vi.fn(),
          spawnBridge: vi.fn(),
          signals: new EventEmitter(),
          log,
          nodeExecutable: '/node',
          openDashboard: vi.fn(async () => Promise.reject(new Error('open failed'))),
        },
      ),
    ).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(
      'Could not open the browser. Open http://127.0.0.1:8787/dashboard manually.',
    );
  });

  it('refuses an unexpected listener without terminating it', async () => {
    await expect(
      launcher.decideBridgeStartup(8787, {
        probeHealth: vi.fn(async () => false),
        isPortOccupied: vi.fn(async () => true),
      }),
    ).rejects.toThrow('Port 8787 is already used by an unexpected process. Nothing was stopped.');
  });

  it('turns an unexpected-listener error into an exact inspection command', () => {
    expect(
      launcher.portInspectionHint(
        'Port 9797 is already used by an unexpected process. Nothing was stopped.',
      ),
    ).toBe('Inspect the listener with: lsof -nP -iTCP:9797 -sTCP:LISTEN');
    expect(launcher.portInspectionHint('Missing .env.')).toBeUndefined();
  });

  it('permits startup only when the configured port is free', async () => {
    await expect(
      launcher.decideBridgeStartup(9797, {
        probeHealth: vi.fn(async () => false),
        isPortOccupied: vi.fn(async () => false),
      }),
    ).resolves.toBe('start');
  });

  it('reports each missing local prerequisite without exposing environment values', async () => {
    const exists = vi.fn(async (path: string) => !path.endsWith('.env'));
    await expect(
      launcher.validateLauncherFiles(root, 'build/notion-manifest.json', exists),
    ).rejects.toThrow('Missing .env. Copy .env.example to .env and configure it first.');

    exists.mockImplementation(async (path: string) => !path.endsWith('notion-manifest.json'));
    await expect(
      launcher.validateLauncherFiles(root, 'build/notion-manifest.json', exists),
    ).rejects.toThrow(
      `Missing Notion manifest at ${join(root, 'build/notion-manifest.json')}. Restore the existing v2 manifest first.`,
    );

    exists.mockImplementation(async (path: string) => !path.endsWith('cli.mjs'));
    await expect(
      launcher.validateLauncherFiles(root, 'build/notion-manifest.json', exists),
    ).rejects.toThrow('Dependencies are not installed. Run npm install.');
  });

  it('constructs one direct foreground bridge command relative to the repository', () => {
    expect(launcher.bridgeSpawnSpec('/tracker', '/node')).toEqual({
      command: '/node',
      args: ['/tracker/node_modules/tsx/dist/cli.mjs', '/tracker/src/bridge/server.ts'],
      options: { cwd: '/tracker', stdio: 'inherit' },
    });
  });

  it('forwards terminal shutdown to the bridge and returns the signal exit status', async () => {
    const kill = vi.fn<(signal: NodeJS.Signals) => boolean>(() => true);
    const child = Object.assign(new EventEmitter(), { kill });
    const signals = new EventEmitter();

    const completion = launcher.waitForBridgeExit(child, signals);
    signals.emit('SIGINT');
    expect(kill).toHaveBeenCalledWith('SIGINT');
    child.emit('exit', null, 'SIGINT');

    await expect(completion).resolves.toBe(130);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGHUP')).toBe(0);
  });

  it('propagates an ordinary bridge exit code', async () => {
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn<(signal: NodeJS.Signals) => boolean>(() => true),
    });

    const completion = launcher.waitForBridgeExit(child, new EventEmitter());
    child.emit('exit', 7, null);

    await expect(completion).resolves.toBe(7);
  });

  it('reports a bridge process that cannot be spawned and removes signal listeners', async () => {
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn<(signal: NodeJS.Signals) => boolean>(() => true),
    });
    const signals = new EventEmitter();

    const completion = launcher.waitForBridgeExit(child, signals);
    child.emit('error', new Error('spawn failed'));

    await expect(completion).rejects.toThrow('spawn failed');
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGHUP')).toBe(0);
  });

  it('starts one foreground bridge and reports its visible lifecycle', async () => {
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn<(signal: NodeJS.Signals) => boolean>(() => true),
    });
    const spawnBridge = vi.fn(() => child);
    const log = vi.fn();

    const completion = launcher.runBridgeLauncher(
      { root: '/tracker', port: 8787, manifestPath: 'build/notion-manifest.json' },
      {
        exists: vi.fn(async () => true),
        probeHealth: vi.fn(async () => false),
        isPortOccupied: vi.fn(async () => false),
        spawnBridge,
        signals: new EventEmitter(),
        log,
        nodeExecutable: '/node',
      },
    );
    await vi.waitFor(() => expect(spawnBridge).toHaveBeenCalledOnce());
    child.emit('exit', 0, null);

    await expect(completion).resolves.toBe(0);
    expect(spawnBridge).toHaveBeenCalledWith({
      command: '/node',
      args: ['/tracker/node_modules/tsx/dist/cli.mjs', '/tracker/src/bridge/server.ts'],
      options: { cwd: '/tracker', stdio: 'inherit' },
    });
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      'Starting LeetCode Tracker bridge on http://127.0.0.1:8787…',
      'LeetCode Tracker bridge stopped.',
    ]);
  });

  it('waits for health, opens once, and stops polling when the child exits', async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
    const spawnBridge = vi.fn(() => child);
    const probeHealth = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const openDashboard = vi.fn(async () => undefined);
    const completion = launcher.runBridgeLauncher(
      { root: '/tracker', port: 8787, manifestPath: 'build/notion-manifest.json' },
      {
        exists: vi.fn(async () => true),
        probeHealth,
        isPortOccupied: vi.fn(async () => false),
        spawnBridge,
        signals: new EventEmitter(),
        log: vi.fn(),
        nodeExecutable: '/node',
        openDashboard,
      },
    );
    await vi.waitFor(() => expect(spawnBridge).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(100);
    expect(openDashboard).toHaveBeenCalledOnce();
    child.emit('exit', 0, null);
    await expect(completion).resolves.toBe(0);
    const callsAtExit = probeHealth.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(probeHealth).toHaveBeenCalledTimes(callsAtExit);
    vi.useRealTimers();
  });

  it('atomically suppresses two concurrent launchers before the bridge binds', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'leetcode-launcher-race-'));
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn<(signal: NodeJS.Signals) => boolean>(() => true),
    });
    const spawnBridge = vi.fn(() => child);
    const dependencies = {
      exists: vi.fn(async () => true),
      probeHealth: vi.fn(async () => false),
      isPortOccupied: vi.fn(async () => false),
      spawnBridge,
      signals: new EventEmitter(),
      log: vi.fn(),
      nodeExecutable: '/node',
    };

    try {
      const first = launcher.runBridgeLauncher(
        { root: testRoot, port: 8787, manifestPath: 'build/notion-manifest.json' },
        dependencies,
      );
      await vi.waitFor(() => expect(spawnBridge).toHaveBeenCalledOnce());

      await expect(
        launcher.runBridgeLauncher(
          { root: testRoot, port: 8787, manifestPath: 'build/notion-manifest.json' },
          dependencies,
        ),
      ).rejects.toThrow('bridge startup is already in progress');
      expect(spawnBridge).toHaveBeenCalledOnce();

      child.emit('exit', 0, null);
      await expect(first).resolves.toBe(0);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it('recovers an atomic startup claim owned by a dead process', async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), 'leetcode-launcher-lock-'));
    try {
      const stale = await launcher.acquireStartupClaim('/tracker', 8787, {
        lockDirectory,
        ownerPid: 999_999,
        isProcessAlive: () => false,
      });
      expect(stale).toBeDefined();

      const recovered = await launcher.acquireStartupClaim('/tracker', 8787, {
        lockDirectory,
        ownerPid: process.pid,
        isProcessAlive: () => false,
      });
      expect(recovered).toBeDefined();
      await recovered?.release();
      await stale?.release();
    } finally {
      await rm(lockDirectory, { recursive: true, force: true });
    }
  });

  it('detects a listening TCP port and closes its probe socket', async () => {
    const destroy = vi.fn<() => void>();
    const setTimeout = vi.fn<(milliseconds: number) => unknown>();
    const socket = Object.assign(new EventEmitter(), { destroy, setTimeout });
    const connect = vi.fn(() => socket);

    const occupied = launcher.isTcpPortOccupied(8787, connect);
    socket.emit('connect');

    await expect(occupied).resolves.toBe(true);
    expect(connect).toHaveBeenCalledWith({ host: '127.0.0.1', port: 8787 });
    expect(setTimeout).toHaveBeenCalledWith(1_000);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('treats a refused or timed-out TCP probe as a free port', async () => {
    for (const event of ['error', 'timeout']) {
      const destroy = vi.fn<() => void>();
      const setTimeout = vi.fn<(milliseconds: number) => unknown>();
      const socket = Object.assign(new EventEmitter(), { destroy, setTimeout });

      const occupied = launcher.isTcpPortOccupied(8787, () => socket);
      socket.emit(event, new Error(event));

      await expect(occupied).resolves.toBe(false);
      expect(destroy).toHaveBeenCalledOnce();
    }
  });

  it('ships an executable repository-relative iTerm2 command launcher', async () => {
    const path = resolve(root, 'Start LeetCode Tracker.command');
    const [metadata, source] = await Promise.all([stat(path), readFile(path, 'utf8')]);

    expect(metadata.mode & 0o111).not.toBe(0);
    expect(source).toContain('TERM_PROGRAM');
    expect(source).toContain('iTerm.app');
    expect(source).toContain('src/launcher/start-bridge.ts');
    expect(source).toMatch(/cd .*dirname/);
    expect(source).not.toMatch(/^\s*status=/m);
    expect(source).toContain('bridge_exit_code=$?');
    expect(source).not.toContain('bridge is no longer running');
    expect(source).toContain("print 'Launcher finished.'");
    expect(source).not.toMatch(/NOTION_TOKEN\s*=|BRIDGE_TOKEN\s*=/);
  });

  it('keeps the importable coordinator free of dotenv side effects', async () => {
    const expression = [
      '(async () => { delete process.env.NOTION_TOKEN;',
      "await import('./src/launcher/bridge-launcher.ts');",
      "process.stdout.write(process.env.NOTION_TOKEN ? 'loaded' : 'clean');",
      '})()',
    ].join('');
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', expression],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
      },
    );

    expect(stdout).toBe('clean');
  });
});
