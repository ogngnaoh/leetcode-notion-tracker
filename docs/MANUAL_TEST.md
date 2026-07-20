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

1. In Finder, associate `.command` files with `/Applications/iTerm.app` and place
   `Start LeetCode Tracker.command` in the Dock's document area.
2. Click it once and confirm a visibly titled iTerm2 window reports the bridge listening on the
   configured localhost port.
3. Click it again and confirm it reports the existing healthy bridge without starting another process.
4. Press Ctrl-C in the original window and confirm the bridge stops.
5. Confirm the extension reports the bridge unavailable, then click the Dock launcher once and confirm
   service returns.
6. Temporarily occupy the configured port with a non-tracker process, click the launcher, and confirm
   it refuses startup without terminating that process.

## Bridge API

1. Start the visible daily launcher (or run `npm run dev:bridge` for development).
2. Open `http://127.0.0.1:8787/health`.
3. Confirm the JSON response reports `ok: true`.
4. Run the sample curl request in `examples/curl-capture.sh` after exporting `BRIDGE_TOKEN`.
5. Confirm one Problem and one Attempt appear in Notion.
6. Run the identical curl request again.
7. Confirm no second Attempt is created.

## Extension

1. Run `npm run build:extension`.
2. Load `dist/extension` as an unpacked extension.
3. Save bridge settings in the options page.
4. Open `https://leetcode.com/problems/two-sum/`.
5. Open the extension side panel.
6. Without focusing or scrolling the editor, confirm title, difficulty, topics, language, and rendered
   code appear; a partial snapshot must say `visible lines X–Y`.
7. Confirm the compact problem card is followed by three equal outcomes and then expanded code.
8. Choose one truthful outcome and confirm all outcomes remain active with that result selected.
9. Choose another outcome for unchanged code and confirm it creates a second Client Event ID.
10. Confirm the Notion Problem and immutable Attempts match both submitted events.
11. For an uncertain write, confirm `Retry same attempt` is the sole action and reuses the exact body.

## Failure checks

- Stop the bridge and verify the extension shows a useful error.
- Use a wrong bridge token and verify HTTP 401 is surfaced.
- Open a non-LeetCode tab and verify capture is blocked.
- Reload the extension while LeetCode remains open and verify startup reinjection recognizes it without
  refreshing the page.
