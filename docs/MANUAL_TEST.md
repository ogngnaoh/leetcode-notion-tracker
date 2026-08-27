# Manual end-to-end test

## Notion setup

1. Create an internal Notion integration.
2. Create an empty Notion page named `LeetCode Tracker`.
3. Share that page with the integration.
4. Fill `.env`.
5. Run `npm run notion:setup`.
6. Run `npm run notion:verify`.
7. Confirm exactly two child databases exist.

## Visible daily launcher

1. In Finder, set Terminal.app as the **Open with** default for `lc-log.command`, select **Change All**,
   and place `lc-log.command` in the Dock's document area.
2. Click it once and confirm a visibly titled Terminal window reports the bridge listening on the
   configured localhost port.
3. Click it again and confirm it reports the existing healthy bridge without starting another process.
4. Press Ctrl-C in the original window and confirm the bridge stops.
5. Confirm the extension reports the bridge unavailable, then click the Dock launcher once and confirm
   service returns.
6. Temporarily occupy the configured port with a non-tracker process, click the launcher, and confirm
   it refuses startup without terminating that process.
7. Run `./lc-log.command` directly from another terminal host and confirm it starts without a
   terminal-brand restriction.

## Bridge API

1. Start the visible daily launcher (or run `npm run dev:bridge` for development).
2. Open `http://127.0.0.1:8787/health`.
3. Confirm the JSON response reports `ok: true`.
4. Run the sample curl request in `examples/curl-capture.sh` after exporting `BRIDGE_TOKEN`.
5. Confirm one Problem and one Attempt appear in Notion.
6. Run the identical curl request again.
7. Confirm no second Attempt is created.

## Dashboard settings

1. Open `/dashboard` in each normal, empty, stale, loading, and unavailable state and confirm
   **Settings** remains visible.
2. Open Settings and confirm the current target is selected in a number input bounded from 1 to 100.
3. Cancel once with the button and once with Escape; confirm focus returns to **Settings**.
4. Save a new target and confirm the denominator changes immediately without a Notion refresh.
5. Restart the bridge and confirm the target survives in ignored `build/dashboard-settings.json`.
6. Make `build/` temporarily unwritable, attempt a save, and confirm the dialog stays open with a live
   error while the prior target remains displayed.

## Extension

1. Run `npm run build:extension`.
2. Load `dist/extension` as an unpacked extension.
3. Open `https://leetcode.com/problems/two-sum/`.
4. Open the extension side panel.
5. Confirm **Daily Reps** is selected, **Notion Log** is secondary, and no bridge request occurs yet.
6. With bridge settings empty and with the code editor unavailable, set a goal of 3 and confirm the
   current problem can still be logged twice as two distinct repetitions.
7. Remove either current rep, log it again, and confirm the count and newest-first list update.
8. Reach and exceed the goal; confirm completion styling appears and logging remains enabled.
9. Lower or raise the goal so the count is below target, select **Finish & reset**, and confirm the
   dialog states the count and shortfall. Finish and confirm the goal carries forward.
10. Expand the archived session and confirm its problem metadata, topics, time, and link. Reload the
    panel and confirm it persists; delete the archive and confirm deletion requires confirmation.
11. Seed or retain a session from an earlier local date and confirm the warning appears without an
    automatic reset or logging block.
12. Edit the goal and confirm **Save goal** is the black-filled primary action, while **Edit goal**
    and **Cancel** use visible black hairlines. Confirm disabled **Log rep** and **Finish & reset**
    remain readable instead of disappearing into the panel background.
13. Navigate the tabs and goal editor by keyboard. Confirm the blue focus ring remains clearly visible
    on the pink and white surfaces, and no controls clip at a narrow side-panel width.
14. Switch to **Notion Log** and confirm bridge status is requested only now.
15. Save bridge settings in the options page.
16. Switch to another tab and confirm LCTrack is not open there. Click the extension icon on that tab
    and confirm its own panel opens, then return to the original LeetCode tab and confirm its
    tab-scoped panel remains available.
17. In **Notion Log**, without focusing or scrolling the editor, confirm title, difficulty, topics,
    language, and the complete code appear.
18. Open a problem whose solution is longer than the code editor viewport, and scroll the editor so
    that neither the first nor the last line is on screen. Confirm the side panel reports the
    solution's true total line count and that the captured code block contains both the first and the
    last line. This is the check that decides whether full code capture works; the automated suites
    were rewritten alongside the feature and cannot decide it.
19. Confirm the square-terminal logo and spaced `LC TRACK` masthead render above the two accessible
    mode tabs. In **Notion Log**, confirm the compact problem card, exactly two equal outcomes,
    `Needed help` and `Solved`, and then expanded code.
20. Confirm **Dashboard ↗** is visible inside **Notion Log**. Open the dashboard, return to LeetCode,
    click **Dashboard ↗**, and confirm it focuses that exact tab and Chrome window without
    duplicating it.
21. Close the dashboard, click **Dashboard ↗** again, and confirm one replacement tab opens.
22. Open `chrome://extensions/shortcuts`, confirm LCTrack lists **Toggle LCTrack side panel** with an
    empty key field, and assign one. This group of checks decides whether the keyboard entry point
    works: `sidePanel.open()` is rejected without a real user gesture, so neither vitest nor
    Playwright can drive it, and the unit tests exercise the toggle only against fake APIs.
    a. On a LeetCode problem tab with the panel closed, press the key and confirm the panel opens.
    b. Press it again and confirm the panel closes.
    c. Open it with the key, close it with the panel's own close control, then press the key and
    confirm it opens rather than doing nothing — this is what `onClosed` tracking is for.
    d. Open the panel, leave Chrome untouched for a minute or two so the service worker shuts down
    (`chrome://extensions` shows it stop), then press the key and confirm it closes the panel
    rather than reopening it — this is what `hydrateOpenPanels` is for, and it is the one path
    no automated check reaches.
    e. Confirm the key you chose still does whatever it did in the LeetCode editor before.
23. Choose one truthful outcome and confirm all outcomes remain active with that result selected.
24. Choose another outcome for unchanged code and confirm it creates a second Client Event ID.
25. Confirm the Notion Problem and immutable Attempts match both submitted events.
26. For an uncertain write, confirm `Retry same attempt` is the sole action and reuses the exact body.

## First-attempt acceptance

1. Capture `Needed help` for a new Problem and confirm today's dashboard count increases once, solved
   streak is 0, and Next Review is today.
2. Review that Problem and confirm a new Attempt is created without increasing today's count.
3. Capture `Solved` for another new Problem and confirm the count increases once and Next Review is
   tomorrow.

## Failure checks

- Stop the bridge and verify the extension shows a useful error.
- Use a wrong bridge token and verify HTTP 401 is surfaced.
- Open a non-LeetCode tab and verify capture is blocked.
- Reload the extension while LeetCode remains open and verify startup reinjection recognizes it without
  refreshing the page.
- Save an invalid Bridge URL and confirm **Dashboard ↗** points back to Bridge settings with an
  actionable error.
