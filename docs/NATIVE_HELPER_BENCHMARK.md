# Native helper benchmark — 2026-09-03

> Historical implementation record. For current operation, use the [documentation index](README.md).

Historical measurement: the subsequent accepted [direct Notion specification](DIRECT_NOTION_SPEC.md)
supersedes this report’s native-helper recommendation. The results below remain an account of the
earlier synthetic experiment, not a performance claim for the direct extension.

The native helper remains the recommended direction for removing manual bridge startup and
releasing helper memory while inactive. In this synthetic benchmark it used less host CPU and
memory than the current launcher, but took longer to start. Most of the active-resource saving
came from compiling JavaScript ahead of time and removing the TypeScript launcher chain.
Native messaging itself was not a startup optimization.

## Method

- Apple M2 Pro, arm64, Darwin 25.6.0; Node v22.18.0; Chromium 149.0.7827.55.
- Actual Chromium native messaging in a temporary profile, using a small extension client.
- Production capture service, Notion repository, and SDK against one stateful synthetic REST fixture.
  No real token or live Notion writes. Fixture state survives helper restarts.
- Nine trials for each of three variants at both 0 and 20 ms injected delay per Notion request:
  54 timing trials total, with alternating order, plus lifecycle scenarios.
- The current-launcher variant uses the existing launcher function and tsx process chain, with
  a localhost fetch replacing opening the dashboard app. AppKit, Terminal, and watch mode are excluded.
- The prebuilt HTTP control compiles the same production HTTP server ahead of time. The native
  prototype also runs prebuilt JavaScript, reusing the capture implementation with a narrow dispatcher.

Reproduce with `node scripts/benchmark/run.mjs`; see the
[harness README](../scripts/benchmark/README.md) for setup and measurement details.
The raw local run is in
[results.json](../build/native-benchmark/2026-09-03T12-36-18.925Z/results.json).
The `build/` directory is ignored by Git; this document preserves the principal results.

## Results

Medians with **20 ms synthetic delay per Notion request**:

| Measurement                                                           | Current launcher | Prebuilt HTTP control | Native helper |
| --------------------------------------------------------------------- | ---------------: | --------------------: | ------------: |
| Start through operational ping                                        |           379 ms |                111 ms |        565 ms |
| Largest observed startup, nine trials                                 |           404 ms |                137 ms |        622 ms |
| First capture after ping                                              |           144 ms |                145 ms |        162 ms |
| Startup plus first capture, per-trial sum                             |           523 ms |                256 ms |        726 ms |
| Same-problem replacement, already running                             |           237 ms |                236 ms |        233 ms |
| Completed-event retry, already running                                |           122 ms |                122 ms |        120 ms |
| Host CPU for startup + first capture + replacement + retry + teardown |           673 ms |                220 ms |        202 ms |
| Sampled peak host process-tree RSS for that workload                  |        317.9 MiB |              88.3 MiB |      83.1 MiB |
| Chromium CPU during that workload, reported separately                |            22 ms |                 26 ms |         27 ms |

Relative to the current launcher, the native prototype used about **74% less peak resident
memory** and **70% less host CPU** for this fixed workload. The prebuilt HTTP control already
achieved about 72% and 67% reductions, respectively. Those percentages compare workload medians;
they are not a prediction of total daily CPU usage or battery life.

The native path added about **0.20 seconds to the cold first-save interaction** compared with
starting the current launcher for that interaction. Compared with an already-running bridge,
an idle-exited helper also pays its roughly 0.56-second startup cost. Repeated replacements
and retries were close across all variants. The first capture after ping was about 18 ms slower
in the native prototype.

In the native trials, the median delay between requesting startup and Node process initialization
was 456 ms, versus 18 ms for the current launcher. This places most of the native startup delay
before the Node runtime begins; this benchmark does not isolate the browser/OS cause.

The zero-delay control supports the same direction:

| Median, no injected network delay | Current launcher | Prebuilt HTTP control | Native helper |
| --------------------------------- | ---------------: | --------------------: | ------------: |
| Startup                           |           385 ms |                116 ms |        570 ms |
| Startup plus first capture        |           402 ms |                131 ms |        602 ms |
| Host CPU, same fixed workload     |           628 ms |                190 ms |        170 ms |
| Sampled peak host tree RSS        |        284.6 MiB |              88.5 MiB |      82.3 MiB |

## Idle behavior and correctness

After a first capture, six burst replacements, two concurrent client requests, and a dashboard read,
the single session trial for each variant showed:

| Observation                     | Current launcher | Prebuilt HTTP control | Native helper |
| ------------------------------- | ---------------: | --------------------: | ------------: |
| Host RSS just before idle       |        328.4 MiB |             104.1 MiB |      95.8 MiB |
| Host RSS after 6.5 seconds idle |        310.9 MiB |              86.8 MiB |         0 MiB |
| Remaining host processes        |                4 |                     1 |             0 |

The native host had a five-second idle timer. Further scenarios passed:

- A request after idle exit started a new helper. Retrying the same event remained a duplicate
  and preserved the Attempt page; the next capture also reused that page.
- A save taking 957 ms completed despite a 300 ms idle timeout. The helper exited afterward.
- A 30-second grace period reused one host across a 6.5-second gap, then exited after inactivity.
- A synthetic browser-local Daily Reps operation did not launch a host during a 35-second observation.
- Two concurrent requests through the shared native connection preserved the same Attempt page.
  This tests one browser profile and one helper, not cross-profile writer exclusion.

The Chrome service-worker target was **still present after 35 seconds**. The helper had exited,
but this run does not demonstrate worker retirement or zero browser-side resource use. Playwright
attachment may affect lifetime. Uninstrumented Chrome remains a production verification gate.

All 54 serial timing trials retained the capture request budgets: **6 first / 10 replacement /
5 duplicate retry**. Dashboard reads were counted separately. The HTTP variants initiated dashboard
prefetch and post-save refreshes; the native prototype performed none while Review was hidden.
An explicit dashboard read issued two fixture queries in each session variant. Asynchronous HTTP
refreshes can straddle individual measurement boundaries; their per-operation count is not a precise
attribution. The shared capture counts stayed stable.

## Recommendation and remaining gates

Proceed with a **prebuilt, on-demand native helper and a five-second idle grace period** as the
initial implementation policy. It fits the requested behavior, avoids a continuously running
helper, and keeps nearby requests on one connection. The 30-second alternative retains roughly
80–100 MiB for longer in exchange for avoiding restarts across pauses of several seconds. The
benchmark establishes this tradeoff, not an optimal timeout for every practice pattern.

Keep Daily Reps browser-local and request dashboard data only when needed. Cache the credential-free
Review snapshot in the extension and coalesce refreshes. Avoid startup prefetch for hidden views.
Do not keep a connection alive merely because the panel is open.

This result does **not** guarantee less CPU under every usage pattern: restarting for widely spaced
saves adds startup work that an already-running bridge avoids. It demonstrates lower CPU for the
tested workloads and zero helper processes after idle, at the cost of cold-interaction latency.
There is no measured reason to add cloud compute or rewrite the helper in Swift for this MVP.
The prebuilt HTTP control is the faster-starting fallback; launchd socket activation itself was
not benchmarked.

Before cutover, verify Keychain lookup and executable access controls, native registration and
upgrade behavior, exclusive writer ownership across profiles and the old bridge, uncertain-save
recovery after crashes, and worker retirement in ordinary Chrome. Benchmark the completed sidebar
and real connection setup separately. This prototype does not establish production security or
full-browser-restart recovery.

CPU uses sampled OS counters plus Node counters; short-lived processes can be undercounted. RSS is
sampled process-tree resident memory and may double-count shared pages. Counter instrumentation
adds periodic work. Chromium CPU covers the temporary browser, not the extension alone. The
synthetic extension omits the full product UI. Nine trials are a directional sample; the reported
largest observation is not a reliable population p95. No battery measurement was made.

The harness and fixture tests are development tooling. The production extension, installed helper
configuration, credentials, and release version were not changed by this benchmark.

## Validation

`npm run check` passed: formatting, TypeScript, 499 unit tests (one skipped), 36 browser tests,
and the repository secret scan. The first sandboxed attempt could not bind the browser-test
localhost ports; the complete check passed when rerun with the required local process permissions.
The full synthetic benchmark also completed with all embedded correctness and lifecycle assertions.
