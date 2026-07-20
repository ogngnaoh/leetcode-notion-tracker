# LC Log extension branding

## Goal

Ship the personal Chrome extension under the concise user-facing name **LC Log**, with Lucide's standard `SquareTerminal` icon as used by shadcn/ui.

## Scope

- Set the Chrome extension manifest name to `LC Log` and its action title to `Open LC Log`.
- Change the side-panel document title and sole masthead heading to `LC Log`.
- Change the options document title and product heading to `LC Log Settings` and `LC Log`.
- Keep the description exactly `leetcode tracker (notion-powered)`.
- Bump the extension version from `0.1.1` to `0.1.2`.
- Replace the custom terminal artwork with Lucide's unmodified `SquareTerminal` vector geometry on a white background with black strokes.
- Generate 16, 32, 48, and 128 pixel PNGs for Chrome and include them in the production extension build.
- Document Lucide provenance and its ISC license.

## Boundaries

The repository name, package name, bridge service identity, launcher filename, Notion database names, API, capture behavior, and data model do not change. Existing user changes in the working tree must be preserved.

## Verification

Update the existing static extension test before implementation so it requires the new name, version, icon paths, PNG dimensions, Lucide source geometry, and license/provenance record. Observe that targeted test fail for the missing branding, implement the smallest passing change, build the extension, then run `npm run check` and inspect the source/build diff.
