# Direct extension benchmark — 2026-09-04

The direct extension needs no always-running bridge, native helper, or cloud service. In an ordinary
Chromium idle observation, the unlocked extension worker retired after **30.1 seconds** and made
**zero Notion requests** during 65 seconds with no panel open. Active saves do more browser work and
take longer than the legacy bridge because the direct transport deliberately serializes requests at
Notion's three-request-per-second budget and durably checkpoints recovery boundaries.

## Method

- Apple M2 Pro, Darwin 25.6.0, Node v22.18.0, Chromium 149.0.7827.55.
- Nine samples of the actual packaged Manifest V3 worker and sidebar code.
- A stateful synthetic Notion implementation with 20 ms delay per request. Worker requests were
  intercepted before network dispatch; no real credential or Notion workspace was used.
- Each sample measured explicit unlock, forced worker retirement and rehydration, first capture,
  same-problem replacement, locally retained duplicate, and older duplicate recovery. The ninth
  sample used 20,000 Unicode characters of code.
- CPU is the delta for the whole isolated browser process group. It is not extension-only CPU.
- The separate idle proof launched ordinary Chromium directly. Its browser target was observed
  without attaching a debugger to the extension worker. A synthetic encrypted vault was unlocked
  through the packaged extension, the panel was closed, and Chromium net logging checked Notion URLs.

The ignored raw outputs are `build/direct-benchmark/results.json` and
`build/direct-benchmark/idle.json`. Reproduce them with the commands in the
[benchmark harness README](../scripts/benchmark/README.md).

## Results

| Measurement                                  |     Median | Largest of 9 |
| -------------------------------------------- | ---------: | -----------: |
| Passphrase unlock                            |    73.3 ms |      78.0 ms |
| Cold worker state rehydration                |    42.7 ms |      52.3 ms |
| First capture, 6 Notion requests             | 1,062.0 ms |   1,140.6 ms |
| Same-problem replacement, 10 requests        | 3,330.6 ms |   3,340.9 ms |
| Locally retained exact duplicate, 0 requests |    13.9 ms |      15.7 ms |
| Historical duplicate recovery, 5 requests    | 1,656.2 ms |   1,665.8 ms |
| Whole-browser CPU for the sample workload    |   719.7 ms |   1,019.3 ms |

Every sample preserved the expected **6 / 10 / 5** request counts. The 20,000-character Unicode
sample completed within the observed bounds. Unminified production bundle sizes were 774,268 bytes
for the worker, 603,544 for the sidebar, 14,921 for the content script, 5,935 for editor discovery,
and 661 for the options launcher. Source maps are separate and excluded from these bundle-size
figures.

The ordinary idle run observed:

| Observation                      | Result |
| -------------------------------- | -----: |
| Observation window               | 65.0 s |
| Worker retirement                | 30.1 s |
| Notion network events while idle |      0 |
| Debugger attached to worker      |     No |

## Compute decision

The direct design removes the legacy launcher's continuously resident Node/tsx process tree. The
historical bridge benchmark measured a 317.9 MiB peak host process tree for its fixed workload and
left processes resident while idle; that host tree does not exist in direct mode. This does not
establish an extension memory saving because incremental browser memory was not measured.

For active work, direct mode trades latency for bounded traffic and crash recovery. The historical
already-running bridge completed first/replacement/duplicate operations in roughly 144/237/122 ms
with the same 20 ms fixture delay; direct mode measured roughly 1,062/3,331/1,656 ms for operations
that reached Notion. Most of the difference is the direct scheduler's intentional request spacing,
not PBKDF2 unlock or cold-worker startup. Whole-browser CPU in direct mode and combined host/browser
CPU in the historical test were in the same broad range for this small synthetic workload, but the
instruments and process boundaries differ, so this is not a claim of CPU improvement or regression.

For a personal tracker used in short bursts, the result supports direct connection as the simplest
choice: no service to start, host, monitor, or pay for; modest unlock/rehydration cost; zero observed
idle Notion traffic; and predictable user-visible save pacing. A hosted service would add credential
custody, authentication, deployment, and recurring operations without solving a measured compute
problem in this scope.

These results are directional synthetic measurements, not live Notion latency, battery testing, or
a population p95. Browser CPU includes unrelated browser work during the isolated run. Worker
retirement timing is controlled by Chromium and may vary. The idle result proves the observed run,
not a guarantee that every Chrome version retires at exactly 30 seconds.
