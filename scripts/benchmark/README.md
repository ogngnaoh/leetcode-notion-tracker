# Native helper benchmark

## Direct extension benchmark

Build the packaged extension, run the nine-sample active benchmark, then run the ordinary-browser
idle observation:

```sh
npm run build
npx playwright test test/browser/direct-performance.spec.ts
node --import tsx scripts/benchmark/direct-idle.ts
```

The active benchmark intercepts worker requests before network dispatch and uses only synthetic
credentials and Notion data. The idle script launches a disposable Chromium profile directly,
unlocks a synthetic encrypted vault through the packaged extension, closes the panel, and observes
the browser target for 65 seconds without attaching to the extension worker. Results are written to
ignored `build/direct-benchmark/`. See
[the direct benchmark report](../../docs/DIRECT_NOTION_BENCHMARK.md) for results and limitations.

## Historical native helper benchmark

Experimental, synthetic tooling only. This does not install a production native host or change
the extension, credentials, Notion data, or existing bridge launchers.

```sh
node scripts/benchmark/run.mjs --quick
node scripts/benchmark/run.mjs
```

Requires the repository's Node dependencies, Playwright Chromium, macOS process-counter access,
and permission to bind temporary localhost ports. The full run takes a few minutes. Results are
written to a timestamped directory under ignored `build/native-benchmark/`. The temporary profile,
host registration, launch wrappers, mock state, and synthetic configuration are removed on completion.

## Compared paths

- **launcher-tsx:** the existing `runBridgeLauncher`, spawning the real `src/bridge/server.ts`
  through the current tsx launch chain. A benchmark adapter replaces opening the dashboard in
  a real app with a localhost fetch. AppKit/Terminal UI and a development file watcher are excluded.
- **prebuilt-http:** the same production HTTP server compiled ahead of time, run directly with Node.
- **native:** a minimal prebuilt stdio host using the same `CaptureService`, `NotionCaptureRepository`,
  and Notion SDK through actual Chromium `connectNative()` in a temporary profile.

The Chromium extension is a small benchmark client, not the real redesigned sidebar. HTTP calls
originate in its page, as they do in the current product; native calls go through a shared worker.
Playwright is used to make these isolated protocol/lifecycle measurements repeatable. This is not
visual QA of the product or a measurement of full LeetCode-page rendering.

All three paths call one stateful synthetic Notion REST server. Its state survives helper restarts.
A child-process bootstrap supplies only synthetic credentials and redirects the SDK's Notion fetches
to that server; it rejects other fetch destinations except the current trial's localhost bridge.
Children run in a temporary working directory with a synthetic `.env`; the real `.env` is never read.
Capture/replacement/retry assertions exercise the production repository, including compact receipts.

## Measurements and limitations

- Nine trials per path at 0 and 20 ms injected delay per Notion request. Order alternates.
- Startup is launch request through an operational ping, including Chromium dispatch for native.
  Prebuilt and launcher HTTP readiness checks may add up to one polling interval (20 ms).
- Save latency is measured after the initial ping. Add startup to the first-save latency to model
  a cold interaction. These are local HTTP synthetic timings, not live Notion/TLS latency.
- Host CPU combines per-process Node counters with sampled OS counters for other observed children.
  Sampling can miss very short-lived children or their final CPU increments; figures are estimates.
  Peak tree RSS is sampled, not a sum of unrelated per-process high-water marks. Shared memory may
  be counted more than once in process-tree RSS. Report it as resident memory, not unique allocation.
- The same Node bootstrap writes counters every 250 ms in each variant. OS sampling runs outside
  the measured host tree approximately every 100 ms. Instrumentation adds wakeups and overhead;
  this is not a battery-life benchmark or an uninstrumented idle-CPU measurement.
- Chromium CPU deltas cover the benchmark browser processes, not an isolated extension worker.
  Retired browser processes may be missing from the ending snapshot. Full browser RSS is deliberately
  not attributed to the extension. These deltas are noisy and should be reported separately.
- Lifecycle observations use target listings rather than worker evaluations. Browser automation
  attachment may still affect worker lifetime; disclose the observed behavior without equating it
  to uninstrumented Chrome or promising that the entire browser has stopped doing work.
- Nine trials support a useful directional comparison; an empirical p95 is the largest observation
  in this small sample, not a reliable population tail estimate.
- Production Keychain access, authentication/code signing, cross-profile writer exclusion, install
  and upgrade behavior, browser-crash recovery, and real internet connection setup are not implemented
  or measured by this prototype. Its synthetic-only `ping` operation is benchmark instrumentation.

The full run additionally exercises bursts, two simultaneous client requests, dashboard reads,
restart with the same event ID, 5-second idle exit, a save longer than its idle timeout, a 30-second
grace period, and a local-only operation that must not spawn a helper.

## Focused validation

```sh
npx vitest run test/native-benchmark.test.ts
```

The fixture tests cover fragmented UTF-8 framing, oversized messages, strict mock routes,
the 6/10/5 capture request budgets, separate dashboard request accounting, retained state after
service recreation, and concurrent same-problem captures. This benchmark is development tooling,
not a shipped extension/runtime release, so it does not change product version numbers.
