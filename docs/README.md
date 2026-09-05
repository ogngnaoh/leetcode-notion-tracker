# Documentation

## Current guides

- [Setup and daily use](../README.md): direct Notion connection and the Daily Reps/Log sidebar.
- [Architecture](ARCHITECTURE.md): runtime, capture, recovery and trust boundaries.
- [Notion schema](NOTION_SCHEMA.md): exact two-database contract and managed views.
- [Security and privacy](SECURITY-MODEL.md): encrypted vault, session authority and recovery limits.
- [Cutover and rollback](DIRECT_NOTION_CUTOVER.md): preserve installation identity and unresolved saves.
- [Notion maintenance](NOTION_MAINTENANCE.md): migrations, backups, retention cleanup and Grind links.
- [Manual QA](MANUAL_TEST.md): installed-profile checks, distinct from synthetic automated coverage.
- [Legacy bridge tools](LEGACY_BRIDGE.md): optional maintenance/rollback tools and their manual QA.
- [Asset provenance](EXTENSION_ASSETS.md): bundled design assets and licenses.

## Historical implementation records

These record earlier decisions and verification at the time; they are not current setup steps or
fresh release evidence. Historical sidebar concepts include the now-removed Review tab.

- [Original bridge implementation plan](IMPLEMENTATION_PLAN.md)
- [Latest Attempt retention](LATEST_ATTEMPT_PLAN.md)
- [Solution page chips](SOLUTION_PEEK_CHANGE.md)
- [Capture performance change](CAPTURE_PERFORMANCE_PLAN.md)
- [Native helper proposal](NATIVE_HELPER_AND_SIDEBAR_PLAN.md) and [benchmark](NATIVE_HELPER_BENCHMARK.md)
- [Direct Notion release specification](DIRECT_NOTION_SPEC.md),
  [implementation plan](DIRECT_NOTION_IMPLEMENTATION_PLAN.md),
  [0.3.0 acceptance evidence](DIRECT_NOTION_IMPLEMENTATION_STATUS.md), and
  [dated synthetic benchmark](DIRECT_NOTION_BENCHMARK.md)

The direct specification retains detailed security/recovery rationale. Current runtime and UI
behavior are summarized in Architecture and Security; historical test counts are not a substitute
for running `npm run check` on the current build.

## Personal study material

[Summer 2027 focused second-pass checklist](SUMMER_2027_SECOND_PASS.md) is a personal study artifact,
independent of implementation and release cleanup.
