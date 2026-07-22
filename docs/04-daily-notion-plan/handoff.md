# Start here next session

Milestone 04 is shipped. The bridge is intentionally stopped; start it with the Dock launcher before
the next capture. Change `DAILY_NEW_PROBLEM_GOAL` and run `npm run notion:daily:sync` when needed.

# Current state

The live manifest is version 3. Problems has `First Solved`; its earliest successful Attempt was
backfilled. `Daily plan` has equal first-row number widgets and a full-width direct-link review table.
Live verification passed 14 Problems and 13 Attempts properties plus managed presentation. Independent
queries for 2026-07-21 returned 1 new solve and 5 due rows. Fresh `npm run check` passed 267 unit tests
and 16 MV3 scenarios; security and whitespace checks passed. The v3 recovery journal is absent.

# Open concerns

Tests created or changed in this milestone are development evidence. Live migration/read-back and the
independent counter/row queries are acceptance evidence. The first apply exposed the dashboard's
required database ID; later verification exposed property-ID and hidden-column normalization. The
journaled retries completed safely. Final verification also restored six accidentally visible
technical columns in `Recent attempts` while preserving its view ID and all Attempts data/schema.
