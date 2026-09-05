# Manual end-to-end test

Use this checklist for the current direct-Notion extension. `npm run check` uses synthetic Notion
and editor fixtures; it does not establish installed-profile behavior or live write permissions.
Legacy launcher/dashboard checks are in [legacy tools](LEGACY_BRIDGE.md).

## Prepare and connect

1. Run `npm run check`, then use the built `dist/extension`. For an existing installation, keep its
   original load path and reload it in `chrome://extensions`; do not load another checkout or clear
   extension data. Resolve old pending saves and stop legacy writers first, following the
   [cutover guide](DIRECT_NOTION_CUTOVER.md). Use one normal Chrome profile.
2. An existing v4 tracker needs no new databases. For a fresh tracker only, follow README setup and
   confirm exactly two databases. Use the [maintenance guide](NOTION_MAINTENANCE.md) for older schemas.
3. Open Settings. If it shows Unlock, use the existing passphrase. Otherwise import the token-free
   v4 `build/notion-manifest.json` and optional `build/dashboard-settings.json`, enter the dedicated
   integration token, and create/confirm a passphrase of at least 16 characters. Review and confirm
   the import preview, then Connect. Never import `.env` or expose credentials in screenshots/logs.
4. Confirm Connect succeeds with read-only checks. This is schema/binding verification, not proof
   of write permission. Confirm Chrome's Extension options page opens sidebar Settings without a
   separate credential form.

## Daily Reps and layout

1. Open a LeetCode problem and LCTrack. Confirm Daily Reps is initially selected, Log is the other
   tab, and Settings is available. There is no Review tab or legacy Dashboard link.
2. With Notion locked and even if the code editor is unavailable, set a goal of 3 and log the same
   problem twice. Confirm two separate local repetitions. Remove a mistaken rep and add it again.
3. Reach/exceed the goal and confirm logging remains enabled. Change the goal, then Finish & reset;
   confirm the dialog includes any shortfall and the goal carries forward after confirmation.
4. Expand History, inspect archived problem metadata and links, then reopen the panel and confirm
   persistence. Archive deletion requires confirmation. Retain an earlier-date session and confirm
   the warning does not reset it automatically or block logging.
5. At normal width and approximately 320 px, confirm readable masthead, tabs, metadata, goal and
   outcome controls, no horizontal overflow, and visible keyboard focus. Empty lists/history stay
   hidden until they contain data; populated rows and collapsed history summaries remain compact.
6. Daily Reps makes no Notion requests. Local repetitions and Notion outcome saves remain separate.

## Recognition and complete code

- Open LCTrack from an Accepted submission page without clicking the editor or Description. Confirm
  the current title, number, difficulty and available mounted-description topics appear.
- Reopen while the editor hydrates. Confirm recognition recovers without scrolling or focusing it.
  Changing Description/submission routes for the same problem must not create repetitions or saves.
- Navigate to a different problem. Hidden old descriptions must not supply its metadata.
- Unlock in Settings and open Log. Confirm title, difficulty, topics, language and complete code.
  Use a solution longer than the editor viewport; scroll so neither first nor last line is visible.
  Confirm both lines and the true total line count appear in the preview. Synthetic editor fixtures
  cannot establish compatibility with the current live LeetCode editor.
- Enter LeetCode focus mode and confirm full code and language remain available. Edit a line and
  confirm the preview updates without focusing or scrolling the editor on the user's behalf.
- Reload the extension while LeetCode remains open, unlock and reopen Log. Confirm the versioned
  handshake recovers recognition without refreshing the page. Missing code must block capture.
- Open a non-LeetCode tab and confirm capture is unavailable.

## User-confirmed live save

Use your own genuine outcome; do not create dummy production attempts to complete this checklist.

1. In Log, inspect the expanded code preview and choose Needed help or Solved. Confirm success only
   after Notion writes finish. Inspect the Problem and Attempt directly in Notion: correct problem,
   code, language, result and attempt timestamp; stable External Key and Client Event ID.
2. When a later genuine attempt is ready, save it and confirm it updates the same retained Attempt
   page/link with a new Client Event ID, preserving unrelated notes. Latest means newest timestamp,
   including Needed help after Solved; it does not mean latest successful solution.
3. Confirm First Attempt remains the earliest recorded capture. Needed help sets streak 0 and
   same-day Next Review; consecutive Solved captures schedule 1, 3, 7, then 14 days, and streak 5
   becomes Mastered with no next review. Check only transitions naturally exercised by your work;
   the synthetic suite covers the full sequence without changing production progress.
4. Check your review queue directly in Notion. Sidebar removal does not remove review-state writes.

## Lock, restart and recovery

1. With no save in flight, select Lock now. Confirm Log's private content disappears and Daily Reps
   still works. A wrong passphrase must leave saved state intact; the correct one unlocks it.
2. Let the idle worker retire and reopen Log during the same Chrome session. Confirm it stays
   unlocked. Fully exit Chrome, then reopen: Settings must require unlock. Extension reload,
   update or disable/re-enable also clears the unlock key. Closing a window alone may not exit Chrome.
3. If a real save is interrupted, preserve its recovery state. Unlock must not automatically submit
   it. Check saved result is read-only; Retry same attempt keeps the original code, timestamp and ID,
   even after navigation or a browser restart. Never create a fresh event to escape uncertainty.
4. Empty/conflicting/incomplete discovery does not prove the previous write failed. Inspect and
   reconcile the exact Notion result before changing writers or discarding recovery. Follow the
   [recovery guide](DIRECT_NOTION_CUTOVER.md#interrupted-saves). Lock or network abort cannot undo an
   accepted remote write. A reported Lock failure requires retry or full Chrome exit.
5. Use the disposable automated suite for deliberate network loss, denied access, vault corruption,
   reset/disconnect and uncertain-write failure injection. Do not clear the user's extension data
   or alter live integration permissions merely for QA. Record which cases were synthetic and
   which were observed live.

## Tab scope and keyboard entry point

These checks require real Chrome gestures; opening the sidebar HTML as a test tab is insufficient.

1. Click the toolbar icon on a problem tab. Switch tabs: LCTrack should not automatically carry over.
   Click the icon there to open that tab's panel, then confirm the original panel remains available.
2. At `chrome://extensions/shortcuts`, assign the initially unbound Toggle LCTrack side panel
   command. Choose a key that does not replace a needed editor command.
3. On a problem tab, press it to open, then close the panel. Open again, close with the panel's own
   control, and confirm the shortcut opens it correctly afterward.
4. Leave an open panel idle until its worker retires, then confirm the shortcut closes the existing
   panel. This checks real side-panel state hydration, distinct from automated worker recovery.
5. Confirm your other LeetCode editor shortcuts still work. Chrome's own restricted pages do not
   deliver extension shortcuts; the toolbar icon remains the entry point there.
