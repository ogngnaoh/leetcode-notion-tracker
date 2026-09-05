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

  it('color-codes outcomes semantically and uses a result-neutral log confirmation', async () => {
    const [styles, runtime] = await Promise.all([
      readFile(resolve(root, 'extension/styles.css'), 'utf8'),
      readFile(resolve(root, 'extension/src/notion-panel.ts'), 'utf8'),
    ]);

    expect(styles).toContain(".outcome[data-result='Needed help']");
    expect(styles).toContain(".outcome[data-result='Solved']");
    expect(styles).not.toContain(".outcome[data-result='Couldn’t solve']");
    expect(runtime).toContain('Saved to Notion');
    expect(runtime).not.toContain('logged for this exact code');
  });

  it('uses compact Layout A order, one masthead title, expanded code, and selectable outcomes', async () => {
    const html = await readFile(resolve(root, 'extension/sidepanel.html'), 'utf8');

    expect([...html.matchAll(/<h1\b/g)]).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>[\s\S]*<span>LC TRACK<\/span>[\s\S]*<\/h1>/);
    expect(html).not.toContain('PERSONAL PRACTICE LOG');
    expect(html.indexOf('class="problem-panel"')).toBeLessThan(
      html.indexOf('class="capture-section"'),
    );
    expect(html.indexOf('id="code-disclosure"')).toBeLessThan(
      html.indexOf('class="capture-section"'),
    );
    expect(html).toMatch(/<details[^>]*id="code-disclosure"[^>]*\bopen\b/);
    expect([...html.matchAll(/aria-pressed="false"/g)]).toHaveLength(2);
  });

  it('pairs the decorative square-terminal mark with the spaced LC TRACK wordmark', async () => {
    const [html, styles] = await Promise.all([
      readFile(resolve(root, 'extension/sidepanel.html'), 'utf8'),
      readFile(resolve(root, 'extension/styles.css'), 'utf8'),
    ]);

    expect(html).toMatch(
      /<h1 class="tracker-title">[\s\S]*<img[^>]*src="icons\/square-terminal-32\.png"[^>]*alt=""[^>]*>[\s\S]*<span>LC TRACK<\/span>[\s\S]*<\/h1>/,
    );
    expect(styles).toMatch(/\.tracker-title\s*{[\s\S]*display:\s*inline-flex/);
    expect(styles).toMatch(/\.tracker-title\s*{[\s\S]*gap:\s*var\(--space-2\)/);
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

  it('uses square hairlines, equal columns, self-contained fonts, focus, disabled, and reduced motion', async () => {
    const [styles, tokens, base, fonts] = await Promise.all([
      readFile(resolve(root, 'extension/styles.css'), 'utf8'),
      readFile(resolve(root, 'extension/vendor/tokens.css'), 'utf8'),
      readFile(resolve(root, 'extension/vendor/base.css'), 'utf8'),
      readFile(resolve(root, 'extension/vendor/fonts/fonts.css'), 'utf8'),
    ]);

    expect(styles).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(styles).toMatch(/background:\s*var\(--color-pink\)/);
    expect(styles).not.toMatch(/box-shadow|linear-gradient|radial-gradient/);
    expect(tokens).toContain('--radius:');
    expect(tokens).toContain('0px');
    expect(base).toContain(':focus-visible');
    expect(base).toContain('prefers-reduced-motion: reduce');
    expect(fonts).toContain('url("./inter-400.woff2")');
    expect(fonts).toContain('url("./inter-500.woff2")');
    expect(fonts).toContain('url("./ibm-plex-mono-400.woff2")');
    expect(styles).toContain(':disabled');
    expect(styles).toMatch(/\.outcome\[aria-pressed=['"]true['"]\]/);
  });

  it('gives Daily Reps actions a legible primary, secondary, and disabled hierarchy', async () => {
    const [html, styles] = await Promise.all([
      readFile(resolve(root, 'extension/sidepanel.html'), 'utf8'),
      readFile(resolve(root, 'extension/styles.css'), 'utf8'),
    ]);

    expect(html).toMatch(
      /id="edit-daily-goal"[^>]*aria-controls="daily-goal-editor"[^>]*aria-expanded="false"/,
    );
    expect(html).toMatch(/id="save-daily-goal"[^>]*class="[^"]*btn--dark/);
    expect(html).toMatch(/id="cancel-daily-goal"[^>]*class="[^"]*btn--outline/);
    expect(styles).toMatch(/\.daily-goal-action\s*{[\s\S]*border-color:\s*var\(--color-black\)/);
    expect(styles).toMatch(/\.btn--outline\s*{[\s\S]*border-color:\s*var\(--color-black\)/);
    expect(styles).toMatch(/\.log-daily-rep:disabled[\s\S]*color:\s*var\(--text-secondary\)/);
    expect(styles).toMatch(
      /\.finish-daily-session:disabled[\s\S]*color:\s*var\(--text-secondary\)/,
    );
    expect(styles).toMatch(/\.daily-reps-panel \.btn\s*{[\s\S]*min-height:\s*36px/);
  });

  it('keeps the daily surface compact and removes controls that do not help daily logging', async () => {
    const [html, styles, runtime] = await Promise.all([
      readFile(resolve(root, 'extension/sidepanel.html'), 'utf8'),
      readFile(resolve(root, 'extension/styles.css'), 'utf8'),
      readFile(resolve(root, 'extension/src/sidepanel.ts'), 'utf8'),
    ]);

    expect(html).not.toContain('daily-problem-link');
    expect(html).not.toContain('Open problem ↗');
    expect(html).not.toContain('current-reps-empty');
    expect(html).not.toContain('daily-history-empty');
    expect(html).toMatch(/class="current-reps"[^>]*hidden/);
    expect(html).toMatch(/class="daily-history-section"[^>]*hidden/);
    expect(html).toContain('class="daily-problem-main"');
    expect(styles).toMatch(/\.shell\s*,[\s\S]*padding:\s*var\(--space-2\)/);
    expect(styles).toMatch(/\.tracker-tab\s*{[\s\S]*min-height:\s*36px/);
    expect(styles).toMatch(/\.daily-progress-bar\s*{[\s\S]*height:\s*6px/);
    expect(styles).toMatch(/\.log-daily-rep\s*{[\s\S]*min-height:\s*44px/);
    expect(styles).toMatch(/\.daily-problem-main\s*{[\s\S]*grid-template-columns/);
    expect(styles).toMatch(/\.history-session > summary\s*{[\s\S]*padding:\s*var\(--space-2\)/);
    expect(runtime).toContain(
      "item.className = target === dailyProblemTopics ? 'daily-topic' : 'chip'",
    );
    expect(runtime).toContain('currentRepsSection.hidden = count === 0');
    expect(runtime).toContain('dailyHistorySection.hidden = count === 0');
    expect(runtime).not.toContain("topicCopy.className = 'rep-topics'");
    expect(runtime).toContain(
      "rep.problem.topics.length > 0 ? ` · ${rep.problem.topics.join(' · ')}` : ''",
    );
    expect(styles).toMatch(/\.tracker-title\s*{[\s\S]*font-size:\s*var\(--font-size-lg\)/);
  });

  it('documents asset hashes and includes the font license beside the files', async () => {
    const [provenance, license] = await Promise.all([
      readFile(resolve(root, 'docs/EXTENSION_ASSETS.md'), 'utf8'),
      readFile(resolve(root, 'extension/vendor/fonts/OFL.txt'), 'utf8'),
    ]);

    for (const hash of [
      '333334d7129799f1963cce6cfa287de888fb98a00ece5dfe0988f7bde191320b',
      'df96025efc9b8303b98942c2f965998ecc17f329205f953e0848baabc7b1c020',
      '8f3c3c52f82e57a508a95b4048de4d678cdd9052a13f61ba24359d8d9b28bcdc',
      '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc',
      'f3779f1efccc4bdcdf9c0a02ab95bf6bd092ed09c48c08cedc725889edd1d19f',
      '08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7',
    ]) {
      expect(provenance).toContain(hash);
    }
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('rebinds the side panel for active-tab, active-tab update, and window-focus changes', async () => {
    const runtime = await readFile(resolve(root, 'extension/src/sidepanel.ts'), 'utf8');

    expect(runtime).toContain('chrome.tabs.onActivated.addListener');
    expect(runtime).toContain('chrome.tabs.onUpdated.addListener');
    expect(runtime).toContain('chrome.windows.onFocusChanged.addListener');
  });

  it('has scripting permission for one-time startup reinjection', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(root, 'extension/manifest.json'), 'utf8'),
    ) as { permissions?: string[] };

    expect(manifest.permissions).toContain('scripting');
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
    const [manifestText, svg, license, provenance] = await Promise.all([
      readFile(resolve(root, 'extension/manifest.json'), 'utf8'),
      readFile(resolve(root, 'extension/square-terminal.svg'), 'utf8'),
      readFile(resolve(root, 'extension/icons/LICENSE-lucide.txt'), 'utf8'),
      readFile(resolve(root, 'docs/EXTENSION_ASSETS.md'), 'utf8'),
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

    expect(svg).toContain('aria-label="LCTrack logo"');
    expect(svg).toContain('d="m7 11 2-2-2-2"');
    expect(svg).toContain('d="M11 13h4"');
    expect(svg).toContain('x="2" y="2" width="20" height="20" rx="5"');
    expect(svg).not.toContain('<rect width="24" height="24" fill="#ffffff"');
    expect(svg).not.toContain('x="3" y="3" width="18" height="18"');
    expect(license).toContain('ISC License');
    expect(provenance).toContain('Lucide SquareTerminal');
  });
});
