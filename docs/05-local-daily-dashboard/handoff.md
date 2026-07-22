# Start here next session

Milestone 05 is shipped. Start a new numbered milestone before expanding scope; preserve the two
Notion databases, narrow bridge, and user-confirmed capture boundary.

# Current state

The dashboard reads solve/review data only from Notion and persists only the tracker-wide 1–100 daily
target in ignored `build/dashboard-settings.json`. `.env` is its first-run fallback. Saves are atomic,
serialized, anti-forgery protected, and update the in-memory denominator only after persistence.
The native Settings dialog works in ready, empty, stale, loading, and unavailable states, including
mobile layout, Cancel, Escape, focus restoration, disabled saving, and live errors. The extension
masthead’s **Dashboard ↗** reuses an exact configured dashboard tab and Chrome window or creates one;
it adds no permission or stored setting. Follow-ups fix the settings label/focus-ring clearance and
scope the extension side panel to whichever tab received the click without enabling it globally. The
side-panel configuration and open requests are dispatched together before the first await so Chrome
retains the toolbar click's required user gesture. Fresh `npm run check` passed formatting,
TypeScript, all 326 Vitest tests, all 22 Playwright scenarios, the extension build, and the secret
scan. The development bridge was restarted on `127.0.0.1:8787` after browser verification.

# Open concerns

Tests added or changed during this effort are development evidence, not independent verification.
The prior live Notion verification remains the latest external-system evidence; this slice changed no
Notion schema, query, capture, or scheduling behavior. The restarted bridge remains intentionally
available for local extension use.
