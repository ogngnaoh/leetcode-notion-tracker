# Start here next session

Milestone 07 is shipped. Reuse its documentation for small follow-ups; create a new milestone only
when future work spans sessions or independently shippable slices. Use LCTrack `0.1.7` as the release baseline.

# Current state

The local dashboard keeps every Problem whose `Next Review` is today or earlier and defensively
excludes future rows. Its compact queue combines title search with `All due`, `Today`, `Overdue`,
and `Needed help`, reveals matches in batches of 50, retains difficulty badges, and never mutates
Notion. The new-Problem card counts First Attempts after a confirmed, locally persisted session
boundary and keeps its maximum configurable; legacy goal-only settings retain calendar-day counting
until the first reset. LCTrack `0.1.7` synchronizes package, lockfile, manifest, and assertion versions.
Fresh release evidence is formatting, TypeScript, 350 Vitest tests, 26 Playwright scenarios, the
extension build, security scan, focused red-green runs, and live desktop/mobile inspection with no
console warnings, framework overlay, or horizontal overflow.

# Open concerns

Tests changed during milestone 07 and its follow-ups are development evidence rather than independent
verification. Resetting writes only ignored local settings; it never changes Problems, Attempts,
capture idempotency, solved state, streaks, review dates, search, batching, or ordering.
