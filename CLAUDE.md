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
npm run build:menu-bar   # compile the on-demand native macOS menu-bar app into build/
npm run start:bridge     # Hono bridge on http://127.0.0.1:8787
npm run format           # prettier --write .
```

`npm run check` is the completion gate — AGENTS.md requires it before claiming work is done.

## Layout

```
extension/src/*.ts   esbuild (scripts/build-extension.mjs) -> dist/extension/*.js
extension/           manifest.json, *.html, styles.css, icons/, vendor/ copied verbatim
src/tracker/         shared capture, repository, review scheduling, and retry receipts
src/bridge/          optional legacy Hono server on :8787 and maintenance dashboard
src/notion/          setup, migration, and verification CLIs
src/launcher/        shared bridge-launcher lifecycle
macos/               native on-demand menu-bar controller source
test/*.ts            vitest unit and route tests (Node, no browser)
test/browser/*.ts    packaged direct-extension and legacy dashboard Playwright suites
docs/                ARCHITECTURE, NOTION_SCHEMA, SECURITY-MODEL, MANUAL_TEST
```

Load `dist/extension` unpacked — never `extension/`, which has no compiled JS. Preserve the existing
load path when updating: loading another checkout creates a new extension identity. The current
extension connects directly to Notion and keeps its token in the encrypted local vault. See
`docs/SECURITY-MODEL.md` for the approved direct-connection boundary and session-key limits.

## Gotchas

**Browser tests use synthetic services.** The direct extension suite intercepts Notion requests
in a disposable Chromium profile; it does not use the legacy bridge or real credentials. The
separate dashboard fixture suite binds `127.0.0.1:8791`, so that port must be free.

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
Check `test/extension-sidepanel-static.test.ts` for version coherence assertions when bumping.

**Do not regenerate `package-lock.json` to bump a version** — edit the two version fields textually.
Regenerating it in a sandboxed environment has pulled in non-npmjs registry URLs. Before committing a
lockfile change, confirm every `resolved` URL still points at `registry.npmjs.org`.

## Verification

The packaged browser suite uses synthetic Notion responses and editor fixtures. It verifies
recovery and worker/browser restart flows, but cannot establish real Notion write permissions or
compatibility with the user's current LeetCode editor. The manual guide covers those checks and
the real keyboard entry point: Chrome delivers extension accelerators above the page and requires
a user gesture for `sidePanel.open()`. Test the toggle after a real side-panel worker retirement
as well. A green `npm run check` does not prove those installed-profile behaviors; report live and
synthetic verification separately. See [manual QA](docs/MANUAL_TEST.md).
