import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('one-click side panel artifact', () => {
  it('contains exactly three symmetrical outcome controls and no form or reload control', async () => {
    const html = await readFile(resolve(root, 'extension/sidepanel.html'), 'utf8');

    const outcomes = [...html.matchAll(/data-result="([^"]+)"/g)].map((match) => match[1]);
    expect(outcomes).toEqual(['Couldn’t solve', 'Needed help', 'Solved']);
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/id="reload"/i);
    expect(html).not.toMatch(/<input\b|<select\b|<textarea\b/i);
    expect(html).toContain('<details');
    expect(html).toContain('id="code-language"');
    expect(html).toContain('id="code-line-count"');
    expect(html).toContain('id="retry-attempt"');
  });

  it('uses compact Layout A order, one masthead title, expanded code, and selectable outcomes', async () => {
    const html = await readFile(resolve(root, 'extension/sidepanel.html'), 'utf8');

    expect([...html.matchAll(/<h1\b/g)]).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>LeetCode Tracker<\/h1>/);
    expect(html).not.toContain('PERSONAL PRACTICE LOG');
    expect(html.indexOf('class="problem-panel"')).toBeLessThan(
      html.indexOf('class="capture-section"'),
    );
    expect(html.indexOf('class="capture-section"')).toBeLessThan(
      html.indexOf('id="code-disclosure"'),
    );
    expect(html).toMatch(/<details[^>]*id="code-disclosure"[^>]*\bopen\b/);
    expect([...html.matchAll(/aria-pressed="false"/g)]).toHaveLength(3);
  });

  it('uses square hairlines, equal columns, self-contained fonts, focus, disabled, and reduced motion', async () => {
    const [styles, tokens, base, fonts] = await Promise.all([
      readFile(resolve(root, 'extension/styles.css'), 'utf8'),
      readFile(resolve(root, 'extension/vendor/tokens.css'), 'utf8'),
      readFile(resolve(root, 'extension/vendor/base.css'), 'utf8'),
      readFile(resolve(root, 'extension/vendor/fonts/fonts.css'), 'utf8'),
    ]);

    expect(styles).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
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
});
