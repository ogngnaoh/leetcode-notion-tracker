import { createHash } from 'node:crypto';
import { access, readlink, symlink, unlink } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type HealthFetch = (
  input: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

interface StartupChecks {
  probeHealth(port: number): Promise<boolean>;
  isPortOccupied(port: number): Promise<boolean>;
}

interface LauncherChild {
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
}

interface SignalSource {
  on(event: NodeJS.Signals, listener: () => void): unknown;
  off(event: NodeJS.Signals, listener: () => void): unknown;
}

interface BridgeLauncherOptions {
  root: string;
  port: number;
  manifestPath: string;
}

interface BridgeLauncherDependencies {
  exists(path: string): Promise<boolean>;
  probeHealth(port: number): Promise<boolean>;
  isPortOccupied(port: number): Promise<boolean>;
  spawnBridge(spec: ReturnType<typeof bridgeSpawnSpec>): LauncherChild;
  signals: SignalSource;
  log(message: string): void;
  nodeExecutable: string;
}

interface PortProbeSocket {
  once(event: 'connect' | 'error' | 'timeout', listener: () => void): unknown;
  setTimeout(milliseconds: number): unknown;
  destroy(): void;
}

type ConnectPort = (options: { host: string; port: number }) => PortProbeSocket;

export interface StartupClaim {
  release(): Promise<void>;
}

interface StartupClaimOptions {
  lockDirectory?: string;
  ownerPid?: number;
  isProcessAlive?: (pid: number) => boolean;
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function probeExpectedBridge(
  port: number,
  fetchHealth: HealthFetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchHealth(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return (
      typeof body === 'object' &&
      body !== null &&
      'ok' in body &&
      body.ok === true &&
      'service' in body &&
      body.service === 'leetcode-notion-bridge'
    );
  } catch {
    return false;
  }
}

export async function decideBridgeStartup(
  port: number,
  checks: StartupChecks,
): Promise<'already-running' | 'start'> {
  if (await checks.probeHealth(port)) return 'already-running';
  if (await checks.isPortOccupied(port)) {
    throw new Error(`Port ${port} is already used by an unexpected process. Nothing was stopped.`);
  }
  return 'start';
}

export function portInspectionHint(message: string): string | undefined {
  const match = /^Port (\d+) is already used by an unexpected process\./.exec(message);
  if (!match) return undefined;
  return `Inspect the listener with: lsof -nP -iTCP:${match[1]} -sTCP:LISTEN`;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function startupClaimPath(root: string, port: number, lockDirectory: string): string {
  const key = createHash('sha256')
    .update(`${resolve(root)}\0${port}`)
    .digest('hex')
    .slice(0, 20);
  return join(lockDirectory, `leetcode-tracker-${key}.lock`);
}

export async function acquireStartupClaim(
  root: string,
  port: number,
  options: StartupClaimOptions = {},
): Promise<StartupClaim | undefined> {
  const ownerPid = options.ownerPid ?? process.pid;
  const owner = String(ownerPid);
  const lockPath = startupClaimPath(root, port, options.lockDirectory ?? tmpdir());
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await symlink(owner, lockPath);
      return {
        release: async () => {
          try {
            if ((await readlink(lockPath)) === owner) await unlink(lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    let existingOwner: string;
    try {
      existingOwner = await readlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!/^\d+$/.test(existingOwner)) return undefined;
    if (isProcessAlive(Number(existingOwner))) return undefined;

    try {
      await unlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  return undefined;
}

export async function validateLauncherFiles(
  root: string,
  manifestPath: string,
  exists: (path: string) => Promise<boolean> = defaultExists,
): Promise<void> {
  if (!(await exists(resolve(root, '.env')))) {
    throw new Error('Missing .env. Copy .env.example to .env and configure it first.');
  }
  const resolvedManifest = resolve(root, manifestPath);
  if (!(await exists(resolvedManifest))) {
    throw new Error(
      `Missing Notion manifest at ${resolvedManifest}. Restore the existing v2 manifest first.`,
    );
  }
  if (!(await exists(resolve(root, 'node_modules/tsx/dist/cli.mjs')))) {
    throw new Error('Dependencies are not installed. Run npm install.');
  }
}

export function bridgeSpawnSpec(root: string, nodeExecutable: string) {
  return {
    command: nodeExecutable,
    args: [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, 'src/bridge/server.ts')],
    options: { cwd: root, stdio: 'inherit' as const },
  };
}

const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

export async function waitForBridgeExit(
  child: LauncherChild,
  signals: SignalSource,
): Promise<number> {
  return await new Promise<number>((resolveExit, rejectExit) => {
    const handlers = new Map<NodeJS.Signals, () => void>();
    for (const signal of FORWARDED_SIGNALS) {
      const handler = () => child.kill(signal);
      handlers.set(signal, handler);
      signals.on(signal, handler);
    }
    const cleanup = () => {
      for (const [name, handler] of handlers) signals.off(name, handler);
    };
    child.once('error', (error) => {
      cleanup();
      rejectExit(error);
    });
    child.once('exit', (code, signal) => {
      cleanup();
      resolveExit(code ?? (signal ? (SIGNAL_EXIT_CODES[signal] ?? 1) : 1));
    });
  });
}

export async function runBridgeLauncher(
  options: BridgeLauncherOptions,
  dependencies: BridgeLauncherDependencies,
): Promise<number> {
  await validateLauncherFiles(options.root, options.manifestPath, dependencies.exists);
  if (await dependencies.probeHealth(options.port)) {
    dependencies.log(
      `LeetCode Tracker bridge is already running on http://127.0.0.1:${options.port}. No second process was started.`,
    );
    return 0;
  }

  const claim = await acquireStartupClaim(options.root, options.port);
  if (!claim) {
    throw new Error(
      'LeetCode Tracker bridge startup is already in progress. Try again in a moment.',
    );
  }

  try {
    const decision = await decideBridgeStartup(options.port, {
      probeHealth: dependencies.probeHealth,
      isPortOccupied: dependencies.isPortOccupied,
    });
    if (decision === 'already-running') {
      dependencies.log(
        `LeetCode Tracker bridge is already running on http://127.0.0.1:${options.port}. No second process was started.`,
      );
      return 0;
    }

    dependencies.log(`Starting LeetCode Tracker bridge on http://127.0.0.1:${options.port}…`);
    const child = dependencies.spawnBridge(
      bridgeSpawnSpec(options.root, dependencies.nodeExecutable),
    );
    const exitCode = await waitForBridgeExit(child, dependencies.signals);
    dependencies.log('LeetCode Tracker bridge stopped.');
    return exitCode;
  } finally {
    await claim.release();
  }
}

export async function isTcpPortOccupied(
  port: number,
  connect: ConnectPort = createConnection,
): Promise<boolean> {
  return await new Promise<boolean>((resolveOccupied) => {
    const socket = connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (occupied: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveOccupied(occupied);
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}
