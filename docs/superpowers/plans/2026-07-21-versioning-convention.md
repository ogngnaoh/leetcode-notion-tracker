# Release Versioning Convention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Release milestone 06 as LCTrack `0.1.3` and make synchronized version increments a durable
project convention.

**Architecture:** Keep one SemVer value synchronized across the npm package, root lockfile package,
Chrome extension manifest, and built extension manifest. Put the future-agent rule in project
`AGENTS.md`; use the existing static identity test and build output as verification.

**Tech Stack:** JSON, Markdown, Vitest, esbuild, Chrome Manifest V3

## Global Constraints

- Increment the patch version for every shipped code change.
- Documentation-only commits do not require a version bump.
- Minor or major increments are deliberate release decisions.
- `package.json`, the root package entry in `package-lock.json`, and `extension/manifest.json` must stay
  synchronized.
- Do not run the changed version test until its exact diff has been shown to and reviewed by the user.

---

### Task 1: Establish the `0.1.3` release contract

**Files:**

- Modify: `test/extension-sidepanel-static.test.ts`

**Interfaces:**

- Consumes: the parsed `extension/manifest.json` object and side-panel HTML.
- Produces: a reviewed failing assertion that the source extension version is `0.1.3`.

- [x] **Step 1: Change the existing identity test**

Replace the test title and manifest expectation with:

```ts
it('ships LCTrack version 0.1.3 with consistent user-facing identity', async () => {
  // Existing file reads remain unchanged.
  expect(manifest).toMatchObject({
    name: 'LCTrack',
    version: '0.1.3',
    description: 'leetcode tracker (notion-powered)',
  });
});
```

- [x] **Step 2: Present the exact test diff for review**

Run only `git diff -- test/extension-sidepanel-static.test.ts` and wait for approval.

- [x] **Step 3: Run the reviewed test and observe the intended failure**

Run: `npx vitest run test/extension-sidepanel-static.test.ts`

Expected: FAIL because `extension/manifest.json` still reports `0.1.2`.

### Task 2: Synchronize version metadata and record the convention

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `extension/manifest.json`
- Modify: `AGENTS.md`
- Modify: `STATUS.md`
- Modify: `docs/06-first-attempt-tracking/implementation-plan.md`

**Interfaces:**

- Consumes: the `0.1.3` assertion from Task 1.
- Produces: synchronized source metadata, a persistent agent convention, and accurate milestone status.

- [x] **Step 1: Set all source release versions to `0.1.3`**

Set `package.json.version`, the root `package-lock.json.version`,
`package-lock.json.packages[""].version`, and `extension/manifest.json.version` to `0.1.3`. Do not
change dependency versions.

- [x] **Step 2: Add the project convention**

Append this section to `AGENTS.md`:

```markdown
## Release versioning

- Increment the patch version for every shipped code change unless the release intentionally warrants
  a minor or major increment.
- Keep `package.json`, the root package entry in `package-lock.json`, and
  `extension/manifest.json` synchronized.
- Documentation-only commits do not require a version bump.
```

- [x] **Step 3: Update current release records**

Record LCTrack `0.1.3` in `STATUS.md` and mark the versioning task complete in the active milestone
implementation plan without rewriting historical evidence for `0.1.2`.

- [x] **Step 4: Run the focused test**

Run: `npx vitest run test/extension-sidepanel-static.test.ts`

Expected: PASS.

- [x] **Step 5: Build and inspect the distributed version**

Run: `npm run build:extension`

Then run:

```bash
node -e "const p=require('./package.json');const l=require('./package-lock.json');const s=require('./extension/manifest.json');const d=require('./dist/extension/manifest.json');console.log([p.version,l.version,l.packages[''].version,s.version,d.version].join(' '))"
```

Expected: `0.1.3 0.1.3 0.1.3 0.1.3 0.1.3`.

- [x] **Step 6: Commit the release update** (`739b32c`)

```bash
git add AGENTS.md STATUS.md package.json package-lock.json extension/manifest.json \
  test/extension-sidepanel-static.test.ts docs/06-first-attempt-tracking/implementation-plan.md \
  docs/superpowers/plans/2026-07-21-versioning-convention.md
git commit -m "chore: release LCTrack 0.1.3"
```

### Task 3: Verify and resume live rollout

**Files:**

- Modify after live evidence: `docs/06-first-attempt-tracking/handoff.md`
- Modify after live evidence: `docs/06-first-attempt-tracking/milestone.md`
- Modify after live evidence: `docs/milestones.md`

**Interfaces:**

- Consumes: built extension version `0.1.3`, exact Notion v4, and the running localhost bridge.
- Produces: final local verification, observed Chrome/Notion acceptance evidence, and shipped milestone 06.

- [x] **Step 1: Run the final local gates**

Stop the bridge, run `npm run check`, `npm run security:scan`, and `git diff --check`, then restart the
bridge. Expected: every command exits successfully and the bridge listens on `127.0.0.1:8787`.

- [x] **Step 2: Reload and verify Chrome**

Reload LCTrack from `chrome://extensions`, reopen the existing LeetCode tab and side panel, and confirm
the extension details show version `0.1.3` with exactly `Needed help` and `Solved` controls.

- [x] **Step 3: Complete live acceptance captures**

Using two previously untracked Problems, confirm:

1. A new `Needed help` capture increments today’s count once and remains due today.
2. A second capture of that Problem does not increment the count again.
3. A new `Solved` capture increments the count once and schedules tomorrow.

Verify each outcome independently through Notion queries and the refreshed dashboard.

- [x] **Step 4: Ship milestone 06**

Mark the slice and milestone shipped, rewrite the three-section handoff, stop temporary processes,
commit the documentation evidence, and confirm a clean worktree.
