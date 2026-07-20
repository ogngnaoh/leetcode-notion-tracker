import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'extension');
const output = resolve(root, 'dist', 'extension');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await build({
  entryPoints: {
    background: resolve(source, 'src/background.ts'),
    content: resolve(source, 'src/content.ts'),
    sidepanel: resolve(source, 'src/sidepanel.ts'),
    options: resolve(source, 'src/options.ts'),
  },
  outdir: output,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome114',
  sourcemap: true,
  logLevel: 'info',
});

for (const file of ['manifest.json', 'sidepanel.html', 'options.html', 'styles.css']) {
  await cp(resolve(source, file), resolve(output, file));
}
await cp(resolve(source, 'icons'), resolve(output, 'icons'), { recursive: true });
await cp(resolve(source, 'vendor'), resolve(output, 'vendor'), { recursive: true });

console.log(`Extension built at ${output}`);
