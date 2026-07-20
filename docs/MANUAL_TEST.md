# Manual end-to-end test

## Notion setup

1. Create an internal Notion integration.
2. Create an empty Notion page named `LeetCode Tracker`.
3. Share that page with the integration.
4. Fill `.env`.
5. Run `npm run notion:setup`.
6. Run `npm run notion:verify`.
7. Confirm exactly two child databases exist.

## Bridge

1. Run `npm run dev:bridge`.
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
6. Confirm title, slug, URL, and difficulty are reasonable.
7. Submit a Green attempt.
8. Confirm the side panel displays the next review date.
9. Confirm the Notion Problem and Attempt match the submitted fields.

## Failure checks

- Stop the bridge and verify the extension shows a useful error.
- Use a wrong bridge token and verify HTTP 401 is surfaced.
- Open a non-LeetCode tab and verify capture is blocked.
- Refresh a LeetCode problem if the content script was installed after the tab opened.
