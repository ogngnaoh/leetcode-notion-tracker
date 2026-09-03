# Direct Notion cutover and rollback

This is a manual user operation after the implementation and release checks pass. Building,
committing, or pushing the code does not install it, move credentials, or modify Notion.

## Before reloading the extension

1. Resolve every old per-tab pending save using the installed bridge version. A reload/update can
   clear that version's session-only retry body. Do not rely on it surviving the update.
2. Stop the legacy bridge/menu-bar launcher and any other tracker writers. Use one normal Chrome
   profile for the tracker. Notion supplies no atomic uniqueness constraint across installations.
3. Retain a copy of the known working release and the token-free v4 manifest. Preserve the optional
   `build/dashboard-settings.json` so the goal and exact reset boundary can be imported.
4. Build the new extension and reload it from the existing `dist/extension` path. Keeping that path
   preserves the unpacked extension identity, Daily Reps data, and user-assigned shortcut. Loading a
   different folder creates a separate extension. Do not uninstall or clear extension storage.

## Connect from the sidebar

Open Settings. Select the v4 manifest and optional preferences file. Review the goal/counting-period
preview; if preferences are absent, explicitly confirm the displayed default. Use a dedicated Notion
internal integration with read, insert, and update capabilities, shared only with Problems/Attempts
and their contents. Enter the token in Settings; do not paste `.env` or credentials into a document,
test, source file, or chat.

Choose a passphrase of at least 16 characters, preferably several random words. There is no password
recovery or token export service. Connect checks database bindings and the required schema using
read-only requests. It cannot prove write capability or that you shared no unrelated pages. The
first live save is your own deliberate outcome click, not a setup test write.

Unlock is retained through worker retirement but lost after a full Chrome exit, extension reload,
update, or disable. **Lock now** clears session authority and private views. Closing a window may
leave Chrome running in the background. A failed Lock must be retried or followed by a full Chrome
exit; do not assume the remaining session key is safe merely because the panel looks locked.

## Interrupted saves

One global pending event stays encrypted across restarts. Unlocking never retries it automatically.
**Check saved result** sends no mutations; **Retry same attempt** uses the original frozen event.
Lock or cancellation of a network request cannot undo a write already accepted by Notion.

If discovery is empty, conflicting, or incomplete, preserve recovery and inspect the existing
Notion pages. Do not repeatedly confirm the same attempt with fresh IDs. Reset/disconnect cannot
undo Notion writes and requires an explicit warning when unresolved work exists. Discarding local
recovery records a persistent reconciliation requirement; a fresh connection remains unable to
capture until you explicitly confirm that the uncertain result has been inspected and reconciled.

## Rollback

Resolve direct pending recovery positively before changing writers. If positive automated recovery
is impossible, inspect and manually reconcile the exact uncertain event first. Allow already
dispatched requests to settle. Keep the direct encrypted journal for inspection until that is done.
Never start the old bridge merely because you have reloaded an older build.

Once reconciled, lock direct mode, stop all direct writers, and restore the retained older release
at the same path. Use its compatible legacy bridge and settings. The old extension does not know
the encrypted direct vault or checkpoints and cannot finish them. Keep newer vault records intact;
do not clear all Chrome storage. The two Notion databases and existing page IDs are unchanged.

Token revocation/rotation is performed separately in Notion. Changing a vault passphrase does not
invalidate older copied vaults or the integration token.
