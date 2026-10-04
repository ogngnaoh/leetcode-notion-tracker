import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('one-click side panel artifact', () => {
  it('opens on an accessible standalone Daily Reps tab with Log secondary', async () => {
    const html = await readFile(resolve(root, 'extension/sidepanel.html'), 'utf8');

    expect(html).toMatch(/role="tablist"[\s\S]*id="daily-reps-tab"[\s\S]*Daily Reps/);
    expect(html).toMatch(/id="daily-reps-tab"[\s\S]*aria-selected="true"/);
    expect(html).toMatch(/id="notion-log-tab"[\s\S]*aria-selected="false"/);
    expect(html).toMatch(/id="daily-reps-panel"[^>]*role="tabpanel"/);
    expect(html).toMatch(/id="notion-log-panel"[^>]*role="tabpanel"[^>]*hidden/);
    expect(html).toContain('id="daily-goal-input"');
    expect(html).toContain('id="log-daily-rep"');
    expect(html).toContain('id="finish-daily-session"');
    expect(html).toContain('id="daily-history"');
  });

  it('ships synchronized LCTrack versions with consistent user-facing identity', async () => {
    const [manifestText, packageText, lockfileText, sidePanel, options] = await Promise.all([
      readFile(resolve(root, 'extension/manifest.json'), 'utf8'),
      readFile(resolve(root, 'package.json'), 'utf8'),
      readFile(resolve(root, 'package-lock.json'), 'utf8'),
      readFile(resolve(root, 'extension/sidepanel.html'), 'utf8'),
      readFile(resolve(root, 'extension/options.html'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as {
      name: string;
      version: string;
      description: string;
      action?: { default_title?: string };
    };
    const packageJson = JSON.parse(packageText) as { version: string };
    const lockfile = JSON.parse(lockfileText) as {
      version: string;
      packages: { '': { version: string } };
    };

    expect(manifest).toMatchObject({
      name: 'LCTrack',
      description: 'Daily LeetCode reps with optional Notion capture',
    });
    expect(packageJson.version).toBe(manifest.version);
    expect(lockfile.version).toBe(manifest.version);
    expect(lockfile.packages[''].version).toBe(manifest.version);
    expect(manifest.action?.default_title).toBe('Open LCTrack');
    expect(sidePanel).toMatch(/<title>LCTrack<\/title>/);
    expect(sidePanel).toMatch(/<h1[^>]*>[\s\S]*<span>LC TRACK<\/span>[\s\S]*<\/h1>/);
    expect(options).toMatch(/<title>LCTrack Settings<\/title>/);
    expect(options).toMatch(/<h1>LCTrack<\/h1>/);
  });

  it('keeps exactly two compact outcomes and separates local and credential inputs', async () => {
    const html = await readFile(resolve(root, 'extension/sidepanel.html'), 'utf8');

    const outcomes = [...html.matchAll(/data-result="([^"]+)"/g)].map((match) => match[1]);
    expect(outcomes).toEqual(['Needed help', 'Solved']);
    expect(html).toContain('id="connection-form"');
    expect(html).not.toMatch(/id="reload"/i);
    expect(html).not.toContain('id="review-goal"');
    expect(html).toMatch(/<input[^>]*id="daily-goal-input"[^>]*min="1"[^>]*max="100"/);
    expect(html).not.toContain('id="review-filter"');
    expect(html).not.toMatch(/<textarea\b/i);
    expect(html).toContain('<details');
    expect(html).toContain('id="code-language"');
    expect(html).toContain('id="code-line-count"');
    expect(html).toContain('id="retry-attempt"');
  });

  it('integrates Settings without broad browser permissions', async () => {
    const [html, manifestText] = await Promise.all([
      readFile(resolve(root, 'extension/sidepanel.html'), 'utf8'),
      readFile(resolve(root, 'extension/manifest.json'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as { permissions?: string[] };

    expect(html).not.toContain('id="review-panel"');
    expect(html).toContain('id="settings-panel"');
    expect(html).not.toContain('id="open-dashboard"');
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'sidePanel', 'storage']);
  });

  it('rebinds the side panel for active-tab, active-tab update, and window-focus changes', async () => {
    const runtime = await readFile(resolve(root, 'extension/src/sidepanel.ts'), 'utf8');

    expect(runtime).toContain('chrome.tabs.onActivated.addListener');
    expect(runtime).toContain('chrome.tabs.onUpdated.addListener');
    expect(runtime).toContain('chrome.windows.onFocusChanged.addListener');
  });

  it('opens the side panel per clicked tab instead of enabling global action behavior', async () => {
    const background = await readFile(resolve(root, 'extension/src/background.ts'), 'utf8');

    expect(background).toContain('chrome.action.onClicked.addListener');
    expect(background).not.toContain('openPanelOnActionClick: true');
    expect(background).toContain('configureTabScopedSidePanel');
    expect(background).toContain('openSidePanelForTab');
  });

  it('wires the toggle command to the panel presence events that keep its state honest', async () => {
    const background = await readFile(resolve(root, 'extension/src/background.ts'), 'utf8');

    expect(background).toContain('chrome.commands.onCommand.addListener');
    expect(background).toContain('toggleSidePanelForTab');
    // Without both presence listeners the toggle desyncs the first time the user closes the panel
    // with its own control, and without hydration it desyncs whenever the worker restarts.
    expect(background).toContain('chrome.sidePanel.onOpened.addListener');
    expect(background).toContain('chrome.sidePanel.onClosed.addListener');
    expect(background).toContain('hydrateOpenPanels');
  });

  it('declares a named toggle command Chrome leaves unassigned until the user binds one', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(root, 'extension/manifest.json'), 'utf8'),
    ) as {
      minimum_chrome_version?: string;
      commands?: Record<string, { suggested_key?: Record<string, string>; description?: string }>;
      action?: { default_popup?: string };
    };
    const command = manifest.commands?.['toggle-side-panel'];

    expect(command).toBeDefined();
    // A named command is what puts "Toggle LCTrack side panel" on chrome://extensions/shortcuts;
    // the reserved _execute_action renders as the generic "Activate the extension" and ignores
    // description entirely. Chrome adds that row implicitly, so declaring it here would be noise.
    expect(command?.description).toBe('Toggle LCTrack side panel');
    expect(manifest.commands?.['_execute_action']).toBeUndefined();
    // Shipping no suggested_key is the decision, not an omission: any default we picked would be
    // claimed browser-wide, and Ctrl/Cmd+Shift+L in particular is Monaco's select-all-occurrences
    // on the leetcode.com/problems/* pages this extension targets.
    expect(command?.suggested_key).toBeUndefined();
    // sidePanel.onClosed is Chrome 142+, and the toggle cannot track state without it.
    expect(manifest.minimum_chrome_version).toBe('142');
    // The toolbar icon still routes through chrome.action.onClicked, which a popup would suppress.
    expect(manifest.action).toBeDefined();
    expect(manifest.action?.default_popup).toBeUndefined();
  });

  it('ships Chrome-supported PNG icons at every declared size', async () => {
    const [manifestText, license] = await Promise.all([
      readFile(resolve(root, 'extension/manifest.json'), 'utf8'),
      readFile(resolve(root, 'extension/icons/LICENSE-lucide.txt'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as {
      icons?: Record<string, string>;
      action?: { default_icon?: Record<string, string> };
    };
    const expectedIcons = {
      '16': 'icons/square-terminal-16.png',
      '32': 'icons/square-terminal-32.png',
      '48': 'icons/square-terminal-48.png',
      '128': 'icons/square-terminal-128.png',
    };

    expect(manifest.icons).toEqual(expectedIcons);
    expect(manifest.action?.default_icon).toEqual(expectedIcons);

    for (const [declaredSize, path] of Object.entries(expectedIcons)) {
      const png = await readFile(resolve(root, 'extension', path));
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(png.readUInt32BE(16)).toBe(Number(declaredSize));
      expect(png.readUInt32BE(20)).toBe(Number(declaredSize));
      expect(png[25]).toBe(6);
    }

    expect(license).toContain('ISC License');
  });
});
