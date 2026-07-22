# Start here next session

Use `Start LeetCode Tracker.command` from the Dock after login, keep its iTerm2 window open while
capturing, and press Ctrl-C when finished. In `chrome://extensions`, reload the unpacked extension
once to activate the LCTrack 0.1.2 name and corrected rounded SquareTerminal icon.

# Current state

Milestones 01 and 02 are shipped. The tracked Dock launcher starts the bridge visibly in iTerm2; its
atomic claim suppresses pre-bind double clicks and recovers dead owners. Real Finder launch, exact
health, duplicate refusal, Ctrl-C stop, restart, and unknown-listener refusal passed. Fresh checks
passed 243 Vitest tests and 16 MV3 scenarios; Notion last verified 13 Problems and 13 Attempts
properties. The extension is LCTrack 0.1.2 with the `leetcode tracker (notion-powered)` description,
Lucide SquareTerminal source, transparent-corner RGBA Chrome PNGs, a single rounded white terminal
frame, and the bundled Lucide ISC notice. No capture, bridge, Notion, or launcher behavior changed.

# Open concerns

The icon regression check changed with this work and is development evidence, while the unchanged
typecheck, MV3 suite, and security scan provide regression evidence. Milestone 03 superseded the
manual `Due now` concern with managed views. Chrome must be reloaded manually before visually
confirming the corrected rounded frame in the installed extension.
