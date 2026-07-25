# Full code capture from the Monaco model

## Problem

The extension reconstructs captured code from Monaco's rendered DOM lines. Monaco virtualizes its
view: lines outside the editor viewport do not exist in the DOM. When a solution is longer than the
editor box, the snapshot silently contains only the visible fragment.

`sidepanel-controller.ts` gates capture on `codeAvailable && code.trim().length > 0` and never
consults `codeRange.complete`. The side panel displays `visible lines X–Y`, but nothing blocks the
outcome click, so truncated solutions are written to Notion as if whole.

## Evidence

Measured on a live `leetcode.com/problems/two-sum/` page, 2026-07-25:

- `window.monaco` is exposed. `monaco.editor.getEditors()` returns two editors: the code editor
  (`getLanguageId()` = `python3`) and a 0×0 `plaintext` editor.
- With the code editor laid out at 80px height, the DOM exposed gutter lines `1, 2, 3` while
  `getModel().getValue()` returned all 11 lines / 496 characters. The truncation and its fix were
  observed in the same measurement.
- `getLanguageId()` returns LeetCode's own language slug, not a Monaco-generic id.
- LeetCode's Monaco emits no `aria-valuemax`, and its scrollbar carries `aria-hidden="true"
role="presentation"`. `entireFileRendered()` therefore always falls through to comparing slider
  and track pixel heights. The completeness flag rests entirely on the geometry of a decorative
  element.
- Four seconds after load, the code editor's DOM node measured 5×5 with zero rendered lines while
  its model already held the full 11 lines. A DOM read landing in that window captures nothing.
- `codeRange` never reaches the bridge. `CaptureEvent` carries only `language` and `code`, so
  `codeRange` is extension-local presentation state.

## Decision

Read code and language from the Monaco model through a MAIN-world content script. When the model
cannot be read, report code unavailable and block capture. Do not fall back to DOM reconstruction.

The model is the editor's source of truth and is independent of what the view has rendered, so this
removes truncation as a failure mode rather than detecting it.

## Architecture

**`extension/src/leetcode-model-reader.ts` (new, pure).** Exports a function taking a Monaco-shaped
namespace and returning `{ code, languageId } | null`. It selects the editor whose DOM node is in
the document and whose model language is not `plaintext`, preferring the largest bounding rect when
several qualify. It returns `null` when the namespace, its `editor` property, or a qualifying editor
is absent. Holding no DOM or Chrome dependency, it is unit-testable against fake namespaces.

**`extension/src/leetcode-model-bridge.ts` (new, MAIN world).** Declared as a second content script
with `"world": "MAIN"`, the same `https://leetcode.com/problems/*` match, and `run_at:
document_idle`. No new permissions; `minimum_chrome_version` is already 116. It:

- answers `{ __lctrack: 'request', id }` with `{ __lctrack: 'response', id, payload }`, where
  `payload` is the reader's result;
- posts `{ __lctrack: 'changed' }` when the active model's content or language changes, via
  `model.onDidChangeContent()` and `editor.onDidChangeModelLanguage()`;
- rediscovers editors on a 250ms interval, matching the cadence already used for location polling.
  Re-attachment is idempotent through a `WeakSet`, so the same loop covers both a late-arriving
  `window.monaco` and the new model Monaco creates when the user switches language;
- announces every transition between readable and unreadable on that same interval. This is what
  makes a timed-out first request recoverable. LeetCode hydrates the editor after the content
  scripts run, so the first read can legitimately find no reachable model; without this signal
  nothing would ask again and the panel would stay blocked until the user happened to edit the
  code. A browser test installs `window.monaco` after the timeout and asserts recovery.

**`content.ts` (ISOLATED, unchanged role).** Continues to own title, difficulty, and topics, which
are ordinary DOM and unaffected. It requests code and language from the bridge and treats a
malformed reply, a mismatched nonce, or a 500ms timeout as unavailable. Messages are ignored unless
`event.source === window` and the shape matches.

The bridge runs in the page's world, so the page can forge these messages. This is not a regression:
the page already controls the DOM the extension reads today. It is recorded in `SECURITY.md` rather
than defended against.

**Change signal.** `onDidChangeContent` replaces the `input`/`change` listeners and the `value`
attribute filter in `observeLeetCodePageChanges` for the code path. The MutationObserver remains for
SPA navigation and problem metadata.

## Contract changes

`AvailableLeetCodeSnapshot` drops `codeRange` entirely. `UnavailableLeetCodeSnapshot`'s reason
becomes `NO_READABLE_EDITOR_MODEL`, replacing `NO_VISIBLE_CODE_EDITOR`.

`sidepanel.ts` always renders `${lines} lines` from `exactLineCount(code)`; the `visible lines X–Y`
branch is removed. The blocked message becomes: `Open the LeetCode code editor with non-blank code,
then try again. Reload the page if it stays unavailable.`

Language flows from `getLanguageId()` into the existing `normalizeLanguage`/`LANGUAGES` map, which
already maps `python3` to `Python` and yields `Unknown` for unrecognized ids. The shared
`CaptureEvent` contract is untouched.

## Deletions

From `leetcode-extraction.ts`: `reconstructMonacoCode`, `MonacoGutterCandidate`,
`MonacoRenderedLineCandidate`, `RenderedCodeCandidate`, `CodeCandidate`, `codeCandidates`,
`nearbyLanguageCandidates`, `languageCandidates`, and `codeRange`.

From `leetcode-dom-adapter.ts`: `renderedCodeCandidates`, `positionedTop`, `entireFileRendered`,
`nearbyLanguageCandidates`, `languageValues`, and the language and code editor selector lists.

The non-Monaco textarea fallback goes with them. Keeping a second code source would reintroduce the
source-switching that this design exists to remove.

## Failure modes

| Condition                         | Behavior                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `window.monaco` absent            | `codeAvailable: false`, capture blocked, bridge keeps polling                |
| Only a `plaintext` editor present | `codeAvailable: false`, capture blocked                                      |
| Bridge silent for 500ms           | `codeAvailable: false`, retried when the bridge announces the model readable |
| Model present but empty           | `codeAvailable: true`, blocked by the existing non-blank check               |

## Risks

**Fingerprints shift once.** Model text will not be byte-identical to DOM-reconstructed text, mainly
in trailing whitespace and tabs. The first capture per problem after upgrade may present as changed
code. `lastSuccess` records are session-scoped, so this resolves on its own.

**A LeetCode change that removes `window.monaco` disables capture** with no degraded mode. This is
the accepted cost of not carrying a second code path. The failure is loud — capture blocks with a
message — rather than silent truncation.

## Testing

Unit tests cover the reader against fake namespaces (absent namespace, no editors, plaintext-only,
several editors, detached node, language mapping) and the message protocol (nonce matching, timeout,
malformed replies, foreign `event.source`).

The Playwright fixtures serve synthetic public-DOM HTML containing no real Monaco. They need an
inline stub defining `window.monaco.editor.getEditors()` before content scripts run.

`docs/MANUAL_TEST.md` gains a step: open a problem whose solution is longer than the editor viewport,
scroll the editor to the middle, and confirm the side panel reports the true total line count and
that the captured code contains both the first and last lines.

This change rewrites the tests that would judge it. The Playwright fixtures and unit tests are part
of the work, not evidence for it. The manual step above is the check that decides completion, and it
must be reviewed and run by the user.

## Non-goals

Reading submission history or the submissions tab. Scrolling or focusing the page. Reading
LeetCode's `localStorage`. Calling LeetCode APIs. Changing the bridge, the Notion schema, or the
`CaptureEvent` contract.

## Exit criteria

A solution longer than the editor viewport is captured in full, verified by the manual step. No code
path can produce a truncated snapshot. `codeRange` and the DOM code reconstruction are gone.
`SECURITY.md` describes MAIN-world model reads, including the forgeable-message note.
