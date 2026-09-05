# Latest Attempt change

> Historical implementation record. For current operation, use the [documentation index](README.md).

## Agreed scope

- Keep the existing two databases; one stable current Attempt page per Problem.
- Newest `Attempted At` wins, including Needed help; keep user notes on retained pages.
- Keep compact event receipts in Notion for retry safety, without historical code copies.
- Preserve first-attempt dates, review state, Grind schedules, checkboxes and reset controls.
- Change shared Grind Open to the latest Attempt, with the LeetCode URL as fallback.
- Back up all Attempt contents and properties and preview older pages before any trash operation.
- Older pages must not be trashed until the user approves the preview separately.

## Implementation / verification

1. Add failing tests for stable page IDs, old retries, late events and partial saves.
2. Implement in-place capture with durable pending-write recovery and compact receipts.
3. Add read-only cleanup inventory/backup and narrow backed-up Grind formula update.
4. Run focused tests and `npm run check`; bump synchronized package/extension patch versions.
5. Run live inventory, apply/verify only the formula change, and report cleanup candidates.

## Preserved state

The checkout already contains unrelated extension/model-reader and menu-bar changes, including
modified README, architecture/security docs and version files. Preserve all of them. Do not commit,
deploy or restart the user's bridge. The user subsequently approved the exact 15-page cleanup.

## Progress

- Implemented and tested in-place latest captures, compact retry receipts, recovery of interrupted
  writes, canonical relations, and late-event protection. Version is 0.2.10.
- `npm run check` passed: 450 unit tests, 36 browser tests, formatting, TypeScript and secret scan.
- The separate live `npm run notion:verify` stops at the pre-existing Problems database lock
  (`LeetCode Problems must not be locked.`). The lock was intentionally preserved; do not claim this
  live verifier passed. Targeted source read-back and before/after data comparisons passed.
- Live Grind Open formula now links directly to the newest Attempt. The Notion API rejected the
  relation formula, so it was saved with the Notion editor and verified through the API. The original
  database lock was restored. Subsequent maintenance runs recognize the saved formula.
- All 20 Grind-only duplicate rows now have a one-way solution link. Day 6 renders 20 Solution links.
  Day 1 renders 18 Solution links and 2 LeetCode fallbacks for problems without attempts. Clicking a
  Solution link opened the Attempt page with nonempty captured code.
- Before/after comparison verified all 144 Attempt pages and nested bodies unchanged; all 151
  Problem rows unchanged except Grind Open / Grind Attempt; all other property schemas unchanged.
- Bridge has NOT been restarted. Restart it explicitly before relying on new capture behavior.
- User approved the 15-page cleanup. Fresh backup confirmed the same targets and no additional body
  notes on candidates. Cleanup implementation is version 0.2.11; `npm run check` passed with 459 unit
  tests, 36 browser tests, type/format checks and the secret scan.
- Cleanup completed at 2026-09-02 17:51:58 Singapore time: 15 approved pages moved to recoverable
  Notion Trash; 129 latest Attempts retained. All original Attempt properties and current code were
  preserved. Historical receipts were verified before removal; Problem review state, first-attempt
  dates and Grind settings were verified unchanged (only reciprocal relations shed trashed pages).
  Audit: `build/notion-latest-cleanup-1788342603686.json` (`status: complete`).
- Final fresh inventory: 129 Attempts / 129 problem keys / zero duplicate candidates. A read-only
  lookup of a trashed page's Client Event ID correctly resolved to its retained Attempt as superseded.

## Approved cleanup

Keep 129 current Attempt pages; move 15 older pages across these 12 problems to Notion Trash.
Before moving anything, re-inventory, verify the exact candidates, and merge their compact event
receipts into the retained page so retries remain idempotent. Preserve first-attempt dates and review
state. Stop if user notes or conflicting changes need a preservation decision. The dedicated
`notion:latest:cleanup` command requires the approved backup and SHA-256 and supports safe retries.

| Problem                         | Older pages to trash |
| ------------------------------- | -------------------: |
| Detect Squares                  |                    1 |
| Palindromic Substrings          |                    2 |
| Cheapest Flights Within K Stops |                    1 |
| Graph Valid Tree                |                    2 |
| Surrounded Regions              |                    1 |
| Valid Parenthesis String        |                    1 |
| Last Stone Weight               |                    1 |
| Kth Largest Element in a Stream |                    1 |
| Balanced Binary Tree            |                    2 |
| Maximum Depth of Binary Tree    |                    1 |
| Min Stack                       |                    1 |
| Valid Sudoku                    |                    1 |

Five groups have tied latest timestamps: Cheapest Flights, Valid Parenthesis String, Balanced Binary
Tree, Maximum Depth, and Min Stack. Prefer the newer creation time; equal creation times only use
stable page ID when captured bodies agree. No unresolved inventory blockers were found.

Full properties, nested Attempt bodies, exact survivor/candidate IDs and receipt plans are in these
ignored, mode-0600 local backups (contain captured solutions; do not publish):

- Before live changes: `build/notion-latest-preview-1788340780999.json`.
  SHA-256: `6d8a17e09c3313f78f14bb9b9c1a9b9f6acc56c6f5c7a30a711517e1fb6c803a`.
- After verified Grind changes: `build/notion-latest-preview-1788341616626.json`.
  SHA-256: `b758889fa0124e3cf387534df9322a150cb84b0f26507303f277ebb6b4344e89`.
- Fresh pre-cleanup backup: `build/notion-latest-preview-1788342227016.json`.
  SHA-256: `85c8e733463240ff1bccb32a84d8293b89691a93316147befa0a37238a73f060`.
- Final post-cleanup snapshot: `build/notion-latest-preview-1788342750886.json`.
  SHA-256: `97c3f8ba4dcee24010fd1ee69f13a18cb03be0541699bbb3aa44a6c375ee9241`.
