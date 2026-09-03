# Legacy bridge tools

These tools remain available for maintenance and rollback to a compatible older extension. The
direct extension does not use them. Stop all other writers before using a legacy bridge, and never
switch writers while a direct save is unresolved. See [cutover and rollback](DIRECT_NOTION_CUTOVER.md).

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
