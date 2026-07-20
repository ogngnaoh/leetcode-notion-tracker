# Start here next session

Use `Start LeetCode Tracker.command` from the Dock after login, keep its iTerm2 window open while
capturing, and press Ctrl-C when finished. In `chrome://extensions`, reload the unpacked extension
once to activate the LC Log 0.1.2 name and SquareTerminal icon.

# Current state

Milestones 01 and 02 are shipped. The tracked Dock launcher starts the bridge visibly in iTerm2; its
atomic claim suppresses pre-bind double clicks and recovers dead owners. Real Finder launch, exact
health, duplicate refusal, Ctrl-C stop, restart, and unknown-listener refusal passed. Fresh checks
passed 243 Vitest tests and 16 MV3 scenarios; Notion last verified 13 Problems and 13 Attempts
properties. The extension is LC Log 0.1.2 with the `leetcode tracker (notion-powered)` description,
Lucide SquareTerminal source, exact-size Chrome PNGs, and the bundled Lucide ISC notice. No capture,
bridge, Notion, or launcher behavior changed.

# Open concerns

The branding test changed with this work and is development evidence, while the unchanged typecheck,
MV3 suite, and security scan provide regression evidence. The optional Notion `Due now` UI view is
still a manual workspace item. Chrome must be reloaded manually before visually confirming the new
name and icon in the installed extension.
