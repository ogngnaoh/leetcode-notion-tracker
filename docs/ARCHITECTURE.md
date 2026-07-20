# Architecture

## Runtime

```text
LeetCode problem page
  → read-only content script
  → Chrome side panel
  → POST /api/capture
  → local Hono bridge
  → Notion REST API
  → Problems + Attempts
```

The extension does not call Notion directly. It stores a low-scope bridge token, while the bridge alone stores the Notion integration token.

## Provisioning

```text
.env + src/notion/schema.ts
  → npm run notion:setup
  → Notion REST API
  → two databases + relation
  → build/notion-manifest.json
```

The setup operation is intentionally one-time. This is not a general migration system.

## Data flow for one capture

1. The content script returns visible current-problem metadata.
2. The user supplies interview-quality context in the side panel.
3. The extension creates a UUID `Client Event ID`.
4. The bridge checks Attempts for that event ID.
5. When already present, the bridge returns the existing attempt and reapplies its stored review state.
6. Otherwise, the bridge finds or creates the Problem by `leetcode:<slug>`.
7. It computes the review transition.
8. It creates one immutable Attempt containing the resulting state.
9. It updates the Problem's current mastery, Green Count, Last Attempt, and Next Review.

The resulting review state is stored on the Attempt so a retry can reconcile a partially completed write without incrementing mastery twice.

## Trust boundaries

### Content script

Can read the currently displayed LeetCode problem page. It cannot access the Notion token or bridge token.

### Side panel

Can access extension storage and call the configured bridge. It creates the capture event only after explicit submission.

### Bridge

Can read and write only the Notion resources exposed by the integration. Its public surface is intentionally limited to `/health` and `/api/capture`.

### Notion

Is the canonical store. No second application database is used.
