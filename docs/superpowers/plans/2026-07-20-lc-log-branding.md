# LC Log Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship extension version 0.1.2 as LC Log with Lucide's standard SquareTerminal icon.

**Architecture:** Keep branding as static extension assets: manifest and HTML own user-facing copy, one reviewed SVG owns the vector source, and generated PNGs satisfy Chrome's icon requirements. The existing build continues to copy the entire icon directory without adding a runtime dependency.

**Tech Stack:** Chrome Manifest V3, static HTML, SVG, PNG, Node.js 22, Vitest, esbuild, `rsvg-convert`

## Global Constraints

- The extension name is exactly `LC Log`.
- The description remains exactly `leetcode tracker (notion-powered)`.
- The extension and package version is exactly `0.1.2`.
- Icon artwork uses Lucide `SquareTerminal` geometry, black strokes, and a white background.
- Repository/package names, bridge identity, launcher filename, Notion databases, API, capture behavior, and data model remain unchanged.
- Existing working-tree changes belong to the user and must be preserved.

---

### Task 1: LC Log identity and standard icon

**Files:**

- Modify: `test/extension-sidepanel-static.test.ts`
- Modify: `extension/manifest.json`
- Modify: `extension/sidepanel.html`
- Modify: `extension/options.html`
- Replace: `extension/terminal-logo.svg` with `extension/square-terminal.svg`
- Replace: `extension/icons/terminal-{16,32,48,128}.png` with `extension/icons/square-terminal-{16,32,48,128}.png`
- Create: `extension/icons/LICENSE-lucide.txt`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/EXTENSION_ASSETS.md`
- Modify: `STATUS.md`
- Modify: `CODEX_HANDOFF_PROMPT.md`
- Build output: `dist/extension/`

**Interfaces:**

- Consumes: Chrome's manifest `icons` and `action.default_icon` size maps.
- Produces: a loadable `dist/extension` whose visible product identity is LC Log and whose declared PNGs exist at their exact dimensions.

- [x] **Step 1: Write the failing branding test**

Extend `test/extension-sidepanel-static.test.ts` to require:

```ts
it('ships LC Log version 0.1.2 with consistent user-facing identity', async () => {
  const [manifestText, sidePanel, options] = await Promise.all([
    readFile(resolve(root, 'extension/manifest.json'), 'utf8'),
    readFile(resolve(root, 'extension/sidepanel.html'), 'utf8'),
    readFile(resolve(root, 'extension/options.html'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText) as {
    name: string;
    version: string;
    description: string;
    action?: { default_title?: string };
  };

  expect(manifest).toMatchObject({
    name: 'LC Log',
    version: '0.1.2',
    description: 'leetcode tracker (notion-powered)',
  });
  expect(manifest.action?.default_title).toBe('Open LC Log');
  expect(sidePanel).toMatch(/<title>LC Log<\/title>/);
  expect(sidePanel).toMatch(/<h1[^>]*>LC Log<\/h1>/);
  expect(options).toMatch(/<title>LC Log Settings<\/title>/);
  expect(options).toMatch(/<h1>LC Log<\/h1>/);
});
```

Change the existing icon assertion to expect `icons/square-terminal-{size}.png`, read `extension/square-terminal.svg`, and require the Lucide geometry and license:

```ts
expect(svg).toContain('aria-label="LC Log logo"');
expect(svg).toContain('d="m7 11 2-2-2-2"');
expect(svg).toContain('d="M11 13h4"');
expect(svg).toContain('x="3" y="3" width="18" height="18" rx="2"');
expect(license).toContain('ISC License');
expect(provenance).toContain('Lucide SquareTerminal');
```

- [x] **Step 2: Run the targeted test and verify RED**

Run:

```bash
npx vitest run test/extension-sidepanel-static.test.ts
```

Expected: FAIL because the manifest and HTML still contain the old name/version and the SquareTerminal source/assets do not exist.

- [x] **Step 3: Implement the static identity**

Set `extension/manifest.json` to use:

```json
{
  "name": "LC Log",
  "version": "0.1.2",
  "description": "leetcode tracker (notion-powered)"
}
```

Retain all other manifest fields, change `action.default_title` to `Open LC Log`, and point both icon maps at `icons/square-terminal-{size}.png`. Change the side-panel title and masthead to `LC Log`; change the options title and product heading to `LC Log Settings` and `LC Log`. Bump the root package and lockfile versions to `0.1.2` without renaming the package.

- [x] **Step 4: Add the exact Lucide vector and license**

Create `extension/square-terminal.svg` with a white 24×24 background and the unmodified Lucide SquareTerminal drawing commands:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="LC Log logo">
  <rect width="24" height="24" fill="#ffffff" />
  <g fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m7 11 2-2-2-2" />
    <path d="M11 13h4" />
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </g>
</svg>
```

Add the Lucide ISC license text to `extension/icons/LICENSE-lucide.txt`. Document that the SVG geometry comes from Lucide `SquareTerminal`, that Lucide is ISC-licensed, and that the PNGs are generated renderings.

- [x] **Step 5: Generate the four Chrome PNG assets**

Run these commands for sizes 16, 32, 48, and 128:

```bash
rsvg-convert -w 16 -h 16 -f png -o extension/icons/square-terminal-16.png extension/square-terminal.svg
rsvg-convert -w 32 -h 32 -f png -o extension/icons/square-terminal-32.png extension/square-terminal.svg
rsvg-convert -w 48 -h 48 -f png -o extension/icons/square-terminal-48.png extension/square-terminal.svg
rsvg-convert -w 128 -h 128 -f png -o extension/icons/square-terminal-128.png extension/square-terminal.svg
```

Remove only the superseded `extension/terminal-logo.svg` and four `extension/icons/terminal-*.png` files.

- [x] **Step 6: Run the targeted test and verify GREEN**

Run:

```bash
npx vitest run test/extension-sidepanel-static.test.ts
```

Expected: all tests in the file pass with zero failures.

- [x] **Step 7: Build and inspect the production identity**

Run:

```bash
npm run build:extension
```

Inspect `dist/extension/manifest.json`, `dist/extension/sidepanel.html`, `dist/extension/options.html`, and `dist/extension/icons/` to confirm they contain only the LC Log identity and declared SquareTerminal assets.

- [x] **Step 8: Run fresh repository verification**

Run:

```bash
npm run check
git diff --check
```

Expected: both commands exit 0. The edited branding test is development evidence rather than independent acceptance; the unchanged typecheck, browser suite, and security scan provide regression evidence.

- [x] **Step 9: Update sustain handoff and commit the deliverable**

Rewrite `docs/02-daily-launcher/handoff.md` in its existing three-section format, noting LC Log version 0.1.2 and the Chrome reload step. Then stage only the branding, plan, and handoff files and commit:

```bash
git commit -m "feat: ship LC Log extension branding"
```
