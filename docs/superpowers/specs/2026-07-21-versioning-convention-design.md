# Release Versioning Convention Design

## Goal

Make every shipped code change visibly update LCTrack so the installed extension and repository
metadata identify the code revision being rolled out.

## Convention

- Increment the patch version for every shipped code change.
- Keep `package.json`, the root package entry in `package-lock.json`, and
  `extension/manifest.json` on the same version.
- Documentation-only commits do not require a version bump.
- Choose a minor or major increment deliberately when a release adds a broader feature or makes a
  breaking change; the three files must still remain synchronized.
- Record the convention in the project `AGENTS.md` so future implementation sessions apply it before
  release verification.

## Current release

Milestone 06 changes the runtime contract, Notion schema, extension capture choices, and dashboard, so
the release increments from `0.1.2` to `0.1.3`. The extension must be rebuilt after the bump and Chrome
must reload the unpacked extension before live acceptance testing.

## Verification

- Confirm the three version fields are exactly `0.1.3`.
- Build the extension and confirm `dist/extension/manifest.json` is also `0.1.3`.
- Run the existing project checks; no test contract is changed solely to prove the version bump.
