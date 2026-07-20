# Start here next session

Continue the active bridge slice in `04-bridge-verification.md`. Start the localhost bridge, verify health/authentication/validation, replay the fixed sample twice, and inspect the resulting Problem and Attempt through the API without printing secrets.

# Current state

Baseline, retry safety, and real Notion provisioning are shipped. The workspace has exactly two verified tracker databases with one data source each and reciprocal relations. `.env` is owner-only and ignored; the ID-only manifest is also ignored. No live capture has been sent yet.

# Open concerns

The fixed sample uses a static July 20 timestamp and must produce one Green Problem plus one immutable Attempt on replay. A naturally occurring post-Attempt Problem-update failure cannot be forced during verification. Chrome verification still requires the owner's interactive browser session.
