# Legacy bridge tools

These tools remain available for maintenance and rollback to a compatible older extension. The
direct extension does not use them. Stop all other writers before using a legacy bridge, and never
switch writers while a direct save is unresolved. See [cutover and rollback](DIRECT_NOTION_CUTOVER.md).

## Configuration

These commands read the ignored local `.env`. In addition to the Notion token and manifest path,
set `BRIDGE_TOKEN` to at least 24 random characters and `PORT` to `8787` (or your chosen local port).
`DAILY_NEW_PROBLEM_GOAL=10` supplies the first-run dashboard goal. The direct extension does not
use the bridge token or port. Never import `.env` into Chrome.

## Menu-bar launcher

LCTrack never starts at login. Build the local menu-bar app once, then open it only when you want the
bridge running:

```bash
npm run build:menu-bar
```

Open `build/LCTrack.app` in Finder. You may keep it there, drag it to `/Applications`, or add it to the
Dock. The app bundle records only this repository path, the Node executable path, and the configured
port; it contains no Notion or bridge token. Rebuild it after moving the repository or changing Node
installations.

Opening **LCTrack** is the explicit start action. It starts the localhost bridge, opens the dashboard,
and places the same shadcn/Lucide Square Terminal mark used by the Chrome extension in the macOS menu
bar. The menu provides **Open Dashboard**, **Stop Bridge**, **Start Bridge**, **View Log**, and **Quit
LCTrack**. Stopping or quitting terminates only a bridge started by that app instance. It does not
install a LaunchAgent or login item, start after login, or restart a stopped bridge. Logs stay in
ignored `build/lc-menu-bar.log`.

If the bridge is already running from another launcher, the menu-bar app opens the dashboard and
reports that the bridge is running elsewhere; it does not claim or terminate that process.

### Visible Terminal fallback

To keep using the original visible launcher, configure it once:

1. In Finder, select `lc-log.command` and open **Get Info**.
2. Under **Open with**, choose **Terminal.app**, then select **Change All**.
3. Drag `lc-log.command` to the Dock's document area, to the right of the divider.

When needed, click that Dock item once. A titled Terminal window starts the local bridge and stays
visible for its entire lifetime. Leave it open while using the extension; press Ctrl-C or close the
window to stop the bridge. A second click opens the dashboard from the already-running bridge without
creating another process. An unexpected port owner is reported and never terminated automatically.
Terminal.app is only the documented Finder default: `lc-log.command` also supports direct shell
execution and other terminal hosts.

For development, the direct command remains available:

```bash
npm run dev:bridge
```

Notion remains the only source for new-Problem counts and review rows. The new-problem maximum and
optional session boundary are tracker-wide local bridge preferences stored atomically in ignored
`build/dashboard-settings.json`. `DAILY_NEW_PROBLEM_GOAL` supplies only the first-run maximum. Use
the maximum button in **NEW PROBLEMS THIS SESSION** to choose an integer from 1 through 100. Enter
saves the inline edit, Escape cancels it, and leaving the field saves a changed value. The masthead’s
**Settings** dialog is reset-only: it deliberately restarts the current count after confirmation.
Resetting records only a local timestamp; it never changes Problems, Attempts, solved state, streaks,
or review dates in Notion.

To review the dashboard’s normal, empty, stale, loading, and unavailable design states locally:

```bash
npm run dev:dashboard:fixtures
```

Open `http://127.0.0.1:8791/dashboard/normal` and replace `normal` with another state name.

Verify it:

```bash
curl http://127.0.0.1:8787/health
```

Expected response:

```json
{ "ok": true, "service": "leetcode-notion-bridge" }
```

## Legacy manual QA

These checks apply only to a compatible legacy extension and the optional legacy tools. Resolve
direct pending saves and stop all direct writers before any live legacy operation. Use disposable
fixtures for failure injection; do not change production permissions or create dummy live captures.

### On-demand menu-bar launcher

1. Confirm the bridge is stopped, run `npm run build:menu-bar`, and open `build/LCTrack.app`.
2. Confirm no Dock icon or Terminal window remains and a status icon appears in the menu bar.
3. Confirm the dashboard opens once and the menu reports **Bridge is running**.
4. Confirm **Open Dashboard** opens the configured localhost dashboard and **View Log** opens the
   ignored `build/lc-menu-bar.log`.
5. Choose **Stop Bridge** and confirm the menu reports it stopped and the extension reports the bridge
   unavailable. Choose **Start Bridge** and confirm it returns without restarting automatically.
6. Choose **Quit LCTrack** while it owns the bridge and confirm both the menu icon and bridge stop.
7. Start the bridge with `lc-log.command`, then open `LCTrack.app`. Confirm it reports **Bridge is
   running elsewhere** and offers **Start Bridge**, not **Stop Bridge**, rather than terminating the
   visible process.
8. Log out and back in, and confirm LCTrack does not start by itself and no login item or LaunchAgent
   was installed.

### Visible Terminal fallback

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

### Bridge API

1. Start either explicit daily launcher (or run `npm run dev:bridge` for development).
2. Open `http://127.0.0.1:8787/health`.
3. Confirm the JSON response reports `ok: true`.
4. Only against a separately authorized disposable tracker, run the sample curl request in
   `examples/curl-capture.sh` after exporting `BRIDGE_TOKEN`. This writes to Notion.
5. Confirm one Problem and one Attempt appear in Notion.
6. Run the identical curl request again.
7. Confirm no second Attempt is created.

### Dashboard settings

1. Open the dashboard fixture's normal, empty, stale, loading, and unavailable states and confirm
   **Settings** remains visible.
2. Use the maximum button for inline goal editing. Confirm it accepts 1–100, Escape cancels,
   and Enter or leaving a changed field saves. Confirm the denominator changes.
3. Open the reset-only Settings dialog. Cancel with the button and Escape; confirm focus returns
   to Settings. Confirm resetting the counting period requires confirmation.
4. Against fixture data, exercise failed saves and confirm errors remain visible with the prior
   settings preserved. The automated dashboard suite covers these synthetic failure states.
5. When explicitly checking a live legacy configuration, confirm a deliberate preference change
   survives bridge restart in ignored `build/dashboard-settings.json`.
