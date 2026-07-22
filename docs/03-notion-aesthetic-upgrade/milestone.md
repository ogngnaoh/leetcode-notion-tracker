# Milestone 03: Notion Database Aesthetic Upgrade

Goal: Polish the live Problems and Attempts databases for daily review while keeping setup and
verification capable of reproducing and detecting the same presentation contract.

## Scope

- Safely migrate Difficulty option colors without changing page identity or values.
- Set database icons and descriptions.
- Manage one review queue, one all-problems view, and one recent-attempts view through the API.
- Preserve unrelated views and every non-presentation schema/data invariant.
- Keep the durable setup and verification paths aligned with the upgraded workspace.

## Non-goals

- Extension, bridge-route, capture, review-schedule, or manifest-version changes.
- Additional databases, properties, covers, locking, subtasks, or infrastructure.
- A general-purpose Notion migration framework.

## Slices

1. **One-time Notion aesthetic upgrade** — shipped — add reviewed checks, dry-run and recovery
   tooling, apply and independently inventory the live change, then remove migration-only code.

## Integration notes

- The bridge stays stopped throughout the Difficulty option migration and restarts only after live
  verification.
- Existing default and `Due now` views are reused only when their identity is unambiguous; unrelated
  views remain untouched.
- A token-free backup remains under ignored `build/`; the recovery journal exists only during apply.
- Checks introduced by this slice are development evidence. Original-row inventory and live API
  read-back are the independent acceptance evidence.

## Exit criteria

- Every original Problem page ID and Difficulty value is preserved, including null values.
- Attempts and all non-Difficulty Problem properties are unchanged.
- Icons, descriptions, exact option colors, and managed views match the presentation contract.
- A repeat dry run reports no changes and the temporary migration runner/tests are removed.
- The bridge health and authenticated read-only status route work after restart.
- Fresh Notion verification, project checks, security scan, and whitespace checks pass.
