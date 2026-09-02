import { execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'macos', 'LCTrackMenuBar.swift');
const iconRendererSource = resolve(root, 'macos', 'render-app-icon.swift');
const logoSource = resolve(root, 'extension', 'square-terminal.svg');
const output = resolve(root, 'build', 'LCTrack.app');
const contents = resolve(output, 'Contents');
const executableDirectory = resolve(contents, 'MacOS');
const resourcesDirectory = resolve(contents, 'Resources');
const executable = resolve(executableDirectory, 'LCTrack');
const moduleCache = resolve(root, 'build', 'swift-module-cache');
const iconRenderer = resolve(root, 'build', 'render-app-icon');
const iconset = resolve(root, 'build', 'LCTrack.iconset');
const appIcon = resolve(resourcesDirectory, 'LCTrack.icns');

if (process.platform !== 'darwin') {
  throw new Error('The LCTrack menu-bar app can only be built on macOS.');
}

for (const requiredPath of [
  resolve(root, '.env'),
  resolve(root, 'build', 'notion-manifest.json'),
  resolve(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  iconRendererSource,
  logoSource,
]) {
  await access(requiredPath);
}

const [packageText, environmentText] = await Promise.all([
  readFile(resolve(root, 'package.json'), 'utf8'),
  readFile(resolve(root, '.env'), 'utf8'),
]);
const packageJson = JSON.parse(packageText);
const environment = parse(environmentText);
const port = Number(environment.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT in .env must be an integer from 1 through 65535.');
}

await rm(output, { recursive: true, force: true });
await mkdir(executableDirectory, { recursive: true });
await mkdir(resourcesDirectory, { recursive: true });
await mkdir(moduleCache, { recursive: true });
await rm(iconset, { recursive: true, force: true });

const configuration = {
  trackerRoot: root,
  nodeExecutable: process.execPath,
  port,
};
await writeFile(
  resolve(resourcesDirectory, 'config.json'),
  `${JSON.stringify(configuration, null, 2)}\n`,
  { mode: 0o600 },
);
await copyFile(logoSource, resolve(resourcesDirectory, 'square-terminal.svg'));

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>LCTrack</string>
  <key>CFBundleIdentifier</key>
  <string>local.lctrack.menu-bar</string>
  <key>CFBundleIconFile</key>
  <string>LCTrack.icns</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>LCTrack</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${packageJson.version}</string>
  <key>CFBundleVersion</key>
  <string>${packageJson.version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`;
await writeFile(resolve(contents, 'Info.plist'), infoPlist, 'utf8');

const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
const sharedSwiftArguments = [
  '-swift-version',
  '5',
  '-module-cache-path',
  moduleCache,
  '-target',
  `${architecture}-apple-macosx13.0`,
  '-framework',
  'AppKit',
];
execFileSync('xcrun', ['swiftc', ...sharedSwiftArguments, iconRendererSource, '-o', iconRenderer], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync(iconRenderer, [logoSource, iconset], { cwd: root, stdio: 'inherit' });
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', appIcon], {
  cwd: root,
  stdio: 'inherit',
});
await rm(iconRenderer, { force: true });
await rm(iconset, { recursive: true, force: true });

execFileSync(
  'xcrun',
  ['swiftc', ...sharedSwiftArguments, '-parse-as-library', '-O', source, '-o', executable],
  { cwd: root, stdio: 'inherit' },
);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', output], {
  cwd: root,
  stdio: 'inherit',
});

console.log(`Menu-bar app built at ${output}`);
