import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  isTcpPortOccupied,
  probeExpectedBridge,
  runBridgeLauncher,
} from '../../src/launcher/bridge-launcher.js';

const config = JSON.parse(readFileSync(process.env.LCTRACK_BENCH_CONFIG!, 'utf8'));
if (config.synthetic !== true) throw new Error('Synthetic benchmark only');
process.exitCode = await runBridgeLauncher(
  {
    root: process.cwd(),
    port: config.port,
    manifestPath: config.manifest,
  },
  {
    exists: async () => true,
    probeHealth: probeExpectedBridge,
    isPortOccupied: isTcpPortOccupied,
    spawnBridge: (spec) => spawn(spec.command, spec.args, spec.options),
    signals: process,
    log: console.log,
    nodeExecutable: process.execPath,
    // Exercise dashboard opening without opening any real app or browser window.
    openDashboard: async (url) => {
      await fetch(url);
    },
  },
);
