# CLAUDE.md

The project's rules live in `AGENTS.md` and are imported below — that file stays the single source of
truth for boundaries and versioning. Everything after the import is operational detail for working in
this repo, not a second set of rules.

@AGENTS.md

## Commands

```
npm run check            # the gate: format + typecheck + vitest + playwright + secret scan
npm run test             # vitest only (fast; no browser)
npm run test:browser     # builds the extension, then Playwright against real Chromium
npm run build            # typecheck + build extension into dist/extension
npm run build:extension  # esbuild only, no typecheck
npm run start:bridge     # Hono bridge on http://127.0.0.1:8787
npm run format           # prettier --write .
```

`npm run check` is the completion gate — AGENTS.md requires it before claiming work is done.

## Layout

```
extension/src/*.ts   esbuild (scripts/build-extension.mjs) -> dist/extension/*.js
extension/           manifest.json, *.html, styles.css, icons/, vendor/ copied verbatim
src/bridge/          Hono server on :8787 — the only thing holding the Notion token
src/notion/          setup, migration, and verification CLIs
src/launcher/        lc-log.command daily launcher
test/*.ts            33 vitest files (Node, no browser)
test/browser/*.ts    3 Playwright specs, loaded as an unpacked extension
docs/                ARCHITECTURE, NOTION_SCHEMA, SECURITY-MODEL, MANUAL_TEST, milestones
```

Load `dist/extension` unpacked — never `extension/`, which has no compiled JS.

## Gotchas

**Port 8787 must be free for `npm run test:browser`.** The Playwright mock bridge claims it and
fails hard with `EADDRINUSE` if the real bridge is running. Subtler: a still-open `/dashboard` tab
polling `127.0.0.1:8787` hits the _mock_ bridge, and `expectOnlyStatusPathSince` in
`test/browser/mv3-capture.spec.ts` asserts every GET is the expected status path — so stray polling
surfaces as an unrelated-looking timeout in `SPA publication rebinds status…`, not as a port error.
Check for a running bridge and open dashboard tabs before believing that failure.

**LeetCode's editor is Monaco, and extension accelerators preempt the page.** Any keyboard shortcut
the manifest claims is taken browser-wide before the editor sees it. `Cmd/Ctrl+Shift+L` is Monaco's
select-all-occurrences and `Cmd/Ctrl+Shift+K` is delete-line — both would be silently shadowed on the
exact pages this extension targets. This is why the `toggle-side-panel` command ships with no
`suggested_key`: the user binds a key at `chrome://extensions/shortcuts`, where Chrome shows conflicts
instead of hiding them.

**Use a named command, not `_execute_action`.** Reserved commands ignore `description` and render as
the generic "Activate the extension" row. Chrome adds that row implicitly as soon as any command is
declared, so declaring `_execute_action` is redundant. Note the `chrome.commands` namespace is
`undefined` entirely unless the manifest has a `commands` block.

**Nothing may be awaited before `sidePanel.open()`.** Chrome rejects it outright unless the user
gesture is still active — the error is `may only be called in response to a user gesture`. That is
why `openSidePanelForTab` calls `open()` _before_ awaiting `setOptions()` (pinned by
`test/side-panel-launcher.test.ts`), and why the toggle keeps panel state in an in-memory `Set`
rather than `chrome.storage.session`. It is also why no automated test can open the side panel:
Playwright has no gesture to offer, so the browser specs load `sidepanel.html` as a plain tab.

**The toggle's state can desync in two ways, and both are guarded.** `chrome.sidePanel.onOpened` /
`onClosed` catch the user closing the panel by hand; `hydrateOpenPanels` re-reads
`chrome.runtime.getContexts({contextTypes: ['SIDE_PANEL']})` at worker startup because an idle MV3
worker is torn down while an open panel survives it. Drop either and the key silently stops toggling.
`onClosed` is Chrome 142+, which is what pins `minimum_chrome_version`.

**Version bumps touch four places.** AGENTS.md requires a patch bump for every shipped code change:
`package.json`, both version fields in `package-lock.json`, and `extension/manifest.json`.
`test/extension-sidepanel-static.test.ts` hardcodes the version in its title and its assertion, so it
must change in the same commit.

**Do not regenerate `package-lock.json` to bump a version** — edit the two version fields textually.
Regenerating it in a sandboxed environment has pulled in non-npmjs registry URLs. Before committing a
lockfile change, confirm every `resolved` URL still points at `registry.npmjs.org`.

## Verification

Some behavior cannot be reached by the automated suites, and `docs/MANUAL_TEST.md` marks which steps
decide correctness. Two live examples: full code capture from a scrolled Monaco editor (step 8), and
the keyboard toggle (step 12) — Chrome delivers extension accelerators above the page and rejects
`sidePanel.open()` without a gesture, so the unit tests exercise the toggle only against fake APIs
and the static test cannot tell a registered command from a working one. Step 12d, the worker-restart
path, has no automated coverage at all. A green `npm run check` does not cover these; say so rather
than implying it does.
