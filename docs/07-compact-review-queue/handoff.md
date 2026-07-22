# Start here next session

Milestone 07 is shipped. Start any new Sustain work by creating the next numbered milestone and use
LCTrack `0.1.5` as the current release baseline.

# Current state

The local dashboard keeps every Problem whose `Next Review` is today or earlier and defensively
excludes future rows. Its compact queue combines title search with `All due`, `Today`, `Overdue`,
`Needed help`, and `Hard` local views, reveals matches in batches of 50, and never mutates Notion.
Fresh release evidence is formatting, TypeScript, 341 Vitest tests, 24 Playwright scenarios, the
extension build, the security scan, and clean diff checks.

# Open concerns

Tests changed during milestone 07, including the approved `0.1.5` manifest-version assertion, are
development evidence rather than independent verification. No live Notion or Chrome rollout was
required for this local presentation release, and no milestone 07 implementation work remains.
