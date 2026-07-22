import 'dotenv/config';
import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readBridgeEnv } from '../bridge/env.js';
import {
  isTcpPortOccupied,
  portInspectionHint,
  probeExpectedBridge,
  runBridgeLauncher,
} from './bridge-launcher.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  if (!(await exists(resolve(root, '.env')))) {
    throw new Error('Missing .env. Copy .env.example to .env and configure it first.');
  }

  let environment: ReturnType<typeof readBridgeEnv>;
  try {
    environment = readBridgeEnv();
  } catch {
    throw new Error(
      'Bridge configuration is invalid. Check .env without sharing its secret values.',
    );
  }

  process.exitCode = await runBridgeLauncher(
    {
      root,
      port: environment.PORT,
      manifestPath: environment.NOTION_MANIFEST_PATH,
    },
    {
      exists,
      probeHealth: probeExpectedBridge,
      isPortOccupied: isTcpPortOccupied,
      spawnBridge: (spec) => spawn(spec.command, spec.args, spec.options),
      signals: process,
      log: console.log,
      nodeExecutable: process.execPath,
      openDashboard: async (url) => {
        await new Promise<void>((resolveOpen, rejectOpen) => {
          execFile('/usr/bin/open', [url], (error) => (error ? rejectOpen(error) : resolveOpen()));
        });
      },
    },
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Could not start the bridge.';
  console.error(message);
  const inspectionHint = portInspectionHint(message);
  if (inspectionHint) console.error(inspectionHint);
  process.exitCode = 1;
});
