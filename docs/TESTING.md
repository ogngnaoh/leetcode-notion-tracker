# Lean test policy

Choose coverage by the kind of change, not by running every tool in the repository. No suite
proves every possible failure; these layers cover the supported MVP's main behavior and risks.

## Commands

| Command                       | When                                                                                                          | Launches Chrome? |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------- |
| `npm run check`               | Every change: format, types, fresh build, unit/integration tests, secret scan                                 | No               |
| `npm test`                    | Fast behavior and packaging regression tests; builds once first                                               | No               |
| `npm run test:browser:list`   | Inspect the current browser cases                                                                             | No               |
| `npm run test:browser`        | Extension UI, extraction/world messaging, storage permissions or worker lifecycle changes; extension releases | Yes              |
| `npm run test:browser:legacy` | Changes to the optional legacy bridge dashboard                                                               | Yes              |
| `npm run benchmark:browser`   | A specific performance question requiring fresh measurements                                                  | Yes              |

The browser suite is explicit, single-worker, with zero retries and a one-failure limit. This
avoids launching the rest of the suite after a broken browser startup or fixture failure. Each
scenario retains a fresh temporary profile to prevent storage, credentials, and pending captures
from leaking between tests. Lifecycle scenarios deliberately restart their own browser. Even
headless Chromium can appear in the macOS Dock; no browser suite runs through `check`.

A successful `check` does not mean browser coverage passed. Report browser tests as unrun when
omitted. Browser fixtures also do not verify the current live LeetCode DOM or Notion service; use
the manual QA guide when those integrations change.

## Retained coverage

| Risk / behavior                                                           | Fast tests                                                                                               | Why retain browser coverage?                                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Daily goals, repetition counting, archives, storage failures              | `daily-reps.test.ts`                                                                                     | One actual UI/storage journey, including reopening the panel                                                                           |
| Capture contract, keys, review scheduling, stable latest Attempt, retries | contract, keys, review, capture-service, latest-attempt and repository tests                             | Both outcome buttons, click-time reconfirmation, duplicate-click suppression, navigation and recovery controls must be wired correctly |
| Full editor capture and stale source rejection                            | DOM adapter, extraction, Monaco/CodeMirror reader, discovery, channel, context and snapshot-reader tests | Both editor types cross real MAIN/ISOLATED worlds; one scenario combines delayed hydration with inactive Accepted-page metadata        |
| Credentials, crypto, locking, caller authorization                        | vault, protocol, connection, transport, private-state and runtime tests                                  | Real Chrome storage access restrictions, multi-panel lock propagation, worker death and full browser restart                           |
| Uncertain saves and duplicate prevention                                  | recovery, runtime-recovery and capture integration tests                                                 | Actual worker termination after a committed write, and recovery after source closure/full restart                                      |
| Keyboard navigation and usable narrow layout                              | Basic markup contracts                                                                                   | One scenario exercises 320px and 480px in the same profile                                                                             |
| Packaging, permissions, asset validity and secret exclusion               | direct-packaging, portability, static manifest/PNG checks, scanner tests                                 | Packaged extension is used by all browser scenarios                                                                                    |
| Grind repair, schema, migrations, historical cleanup                      | Grind, schema, verification, migration and maintenance tests                                             | No browser needed: these use API/CLI behavior, not UI automation                                                                       |
| Supported legacy adapters and dashboard safety                            | bridge routes, settings, launcher, menu-bar and dashboard tests                                          | Separate optional legacy UI suite only when that surface changes                                                                       |

Keep the fast failure-path tests. They exercise different loss, corruption, authorization and
idempotency conditions; test count alone is not a useful cost measure. The full fast suite runs
in seconds. Migration/cleanup tests remain necessary while their write commands are shipped.
The native-helper prototype is not a production runtime.

## October 2026 cleanup

- Current extension browser discovery: **42 → 18 cases**. It names the two current spec files
  explicitly so auxiliary experiments cannot silently join normal runs.
- Moved the **12 legacy dashboard cases** to their own directory/configuration. The dashboard
  remains a supported optional tool, so these were separated rather than deleted.
- Moved the **nine-sample performance measurement** outside the regression directory. It remains
  available as `benchmark:browser`, not a correctness gate.
- Deleted the cosmetic sidebar CSS/color screenshot test and the screenshot-only layout case
  that had no image comparison assertion. Removed repeated options/two-tab/metadata smoke cases
  already covered by current boundary tests and broader journeys.
- Consolidated four editor variants into two editor integration cases; unit tests retain the
  individual extraction variants. Consolidated both outcome cases into one session, and four
  viewport cases into one narrow/wide scenario.
- Removed eight static tests that mainly froze CSS, previous design wording/layout, documentation
  hashes or a duplicate permission assertion. Retained version consistency, accessible default
  tabs, capture outcomes, permission boundaries, event wiring, shortcut declaration and valid PNGs.
- Removed the two framing tests for the unshipped native-helper protocol. Kept its three useful
  synthetic Notion integration tests as `capture-integration.test.ts`.
- Build once before unit tests, then scan that build. Added two workflow guards to keep browser
  launches out of default checks and prevent accidental expansion of browser discovery.

For a new regression, prefer a small test at the lowest layer that reproduces the failure. Add a
browser case when a real browser boundary or UI integration is part of the bug. Do not add another
full-browser launch for a color, a renamed label, or a pure scheduler/validation edge case.
