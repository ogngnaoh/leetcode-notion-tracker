import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('on-demand macOS menu-bar launcher', () => {
  it('ships a native menu-bar controller and a reproducible app-bundle builder', async () => {
    const sourcePath = resolve(root, 'macos/LCTrackMenuBar.swift');
    const builderPath = resolve(root, 'scripts/build-menu-bar-app.mjs');

    await expect(access(sourcePath)).resolves.toBeUndefined();
    await expect(access(builderPath)).resolves.toBeUndefined();

    const [source, builder, packageText] = await Promise.all([
      readFile(sourcePath, 'utf8'),
      readFile(builderPath, 'utf8'),
      readFile(resolve(root, 'package.json'), 'utf8'),
    ]);
    const packageJson = JSON.parse(packageText) as { scripts: Record<string, string> };

    expect(packageJson.scripts['build:menu-bar']).toBe('node scripts/build-menu-bar-app.mjs');
    expect(source).toContain('NSStatusBar.system.statusItem');
    expect(source).toContain('Open Dashboard');
    expect(source).toContain('View Log');
    expect(source).toContain('Stop Bridge');
    expect(source).toContain('Quit LCTrack');
    expect(source).toContain('src/launcher/start-bridge.ts');
    expect(builder).toContain('<key>LSUIElement</key>');
    expect(builder).toContain('<true/>');
    expect(builder).toContain('<key>CFBundleIconFile</key>');
    expect(builder).toContain('<string>LCTrack.icns</string>');
    expect(builder).toContain("'extension', 'square-terminal.svg'");
    expect(builder).toContain("'macos', 'render-app-icon.swift'");
    expect(source).toContain(
      'Bundle.main.url(forResource: "square-terminal", withExtension: "svg")',
    );
    await expect(access(resolve(root, 'macos/render-app-icon.swift'))).resolves.toBeUndefined();
  });

  it('never installs, registers, or silently restarts a background service', async () => {
    const [source, builder] = await Promise.all([
      readFile(resolve(root, 'macos/LCTrackMenuBar.swift'), 'utf8'),
      readFile(resolve(root, 'scripts/build-menu-bar-app.mjs'), 'utf8'),
    ]);
    const implementation = `${source}\n${builder}`;

    expect(implementation).not.toMatch(
      /SMAppService|ServiceManagement|LaunchAgents|launchctl|RunAtLoad|KeepAlive/,
    );
    expect(implementation).not.toMatch(/NOTION_TOKEN\s*=|BRIDGE_TOKEN\s*=/);
    const exitHandler = source.slice(
      source.indexOf('private func bridgeDidExit'),
      source.indexOf('private func setStoppedState'),
    );
    expect(exitHandler).not.toContain('startBridge(');
    expect(source).toContain('applicationWillTerminate');
    expect(source).toContain('process.terminate()');
  });
});
