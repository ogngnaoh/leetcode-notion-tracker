# Start here next session

Run and review the live `npm run notion:migrate:v4` dry-run. Apply only after explicit approval, then
run `npm run notion:verify`, rebuild/reload Chrome, and complete the three live acceptance scenarios in
`implementation-plan.md`. Finish by shipping milestone 06 and rewriting this handoff.

# Current state

Baseline `f0bbb49` is followed by core commit `427e8c7` and migration commit `1f0ec7d`; the extension,
dashboard copy, and docs integration commit is next. Local evidence is clean: TypeScript, 341 Vitest
tests, and 21 Playwright scenarios pass. Follow-up review found no Critical or Important issues after
all six migration/runtime safety findings were resolved. The real Notion workspace and loaded Chrome
extension remain on v3 behavior pending the approved rollout.

# Open concerns

Changed tests are development evidence, not independent verification. The v4 apply remains gated on
review of its token-free dry-run backup and operation counts. Any uncertain pending capture must be
resolved before cutover; live Notion/Chrome observations, final checks, process shutdown, and milestone
shipment are still required.
