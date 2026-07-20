# Start here next session

Use `Start LeetCode Tracker.command` from the Dock after login, keep its iTerm2 window open while
capturing, and press Ctrl-C when finished. Start a new milestone before changing shipped behavior.

# Current state

Milestones 01 and 02 are shipped. The tracked Dock launcher starts the bridge visibly in iTerm2; its
atomic claim suppresses pre-bind double clicks and recovers dead owners. Real Finder launch, exact
health, duplicate refusal, Ctrl-C stop, restart, and unknown-listener refusal passed. Fresh checks
passed 241 Vitest tests and 16 MV3 scenarios; Notion verified 13 Problems and 13 Attempts properties.
Review has no unresolved Critical or Important findings, and no bridge listener remains.

# Open concerns

Tests changed in this milestone and are development evidence. Independent acceptance came from the
real Finder/iTerm/Dock lifecycle and live exact-health checks. The optional Notion `Due now` UI view
remains the only manual workspace item.
