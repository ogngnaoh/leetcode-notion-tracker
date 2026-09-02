import AppKit
import Foundation

private struct AppConfiguration: Decodable {
    let trackerRoot: String
    let nodeExecutable: String
    let port: Int
}

@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var stateItem: NSMenuItem!
    private var bridgeActionItem: NSMenuItem!
    private var openDashboardItem: NSMenuItem!
    private var viewLogItem: NSMenuItem!
    private var bridgeProcess: Process?
    private var logHandle: FileHandle?
    private var configuration: AppConfiguration?
    private var logURL: URL?
    private var stopWasRequested = false

    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenu()

        do {
            let configuration = try loadConfiguration()
            self.configuration = configuration
            logURL = URL(fileURLWithPath: configuration.trackerRoot)
                .appendingPathComponent("build/lc-menu-bar.log")
            openDashboardItem.isEnabled = true
            viewLogItem.isEnabled = true
            startBridge()
        } catch {
            setState("Setup error — click for details", symbol: "exclamationmark.triangle.fill")
            bridgeActionItem.isEnabled = false
            presentError(error.localizedDescription)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let process = bridgeProcess, process.isRunning {
            process.terminate()
        }
        try? logHandle?.close()
    }

    private func configureMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.toolTip = "LCTrack"
        configureLogo()

        let menu = NSMenu()
        stateItem = NSMenuItem(title: "Bridge is starting…", action: nil, keyEquivalent: "")
        stateItem.isEnabled = false
        menu.addItem(stateItem)
        menu.addItem(.separator())

        openDashboardItem = NSMenuItem(
            title: "Open Dashboard",
            action: #selector(openDashboard),
            keyEquivalent: "o"
        )
        openDashboardItem.target = self
        openDashboardItem.isEnabled = false
        menu.addItem(openDashboardItem)

        bridgeActionItem = NSMenuItem(
            title: "Stop Bridge",
            action: #selector(toggleBridge),
            keyEquivalent: ""
        )
        bridgeActionItem.target = self
        menu.addItem(bridgeActionItem)

        viewLogItem = NSMenuItem(
            title: "View Log",
            action: #selector(viewLog),
            keyEquivalent: "l"
        )
        viewLogItem.target = self
        viewLogItem.isEnabled = false
        menu.addItem(viewLogItem)
        menu.addItem(.separator())

        let quitItem = NSMenuItem(
            title: "Quit LCTrack",
            action: #selector(quitApplication),
            keyEquivalent: "q"
        )
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
        setState("Bridge is starting…", symbol: "ellipsis.circle")
    }

    private func loadConfiguration() throws -> AppConfiguration {
        guard let url = Bundle.main.url(forResource: "config", withExtension: "json") else {
            throw LauncherError("LCTrack configuration is missing. Rebuild the menu-bar app.")
        }
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(AppConfiguration.self, from: data)
    }

    private func configureLogo() {
        guard let url = Bundle.main.url(forResource: "square-terminal", withExtension: "svg"),
              let image = NSImage(contentsOf: url) else {
            statusItem.button?.image = NSImage(
                systemSymbolName: "terminal",
                accessibilityDescription: "LCTrack"
            )
            return
        }
        image.size = NSSize(width: 18, height: 18)
        image.isTemplate = false
        statusItem.button?.image = image
        statusItem.button?.imagePosition = .imageOnly
    }

    private func startBridge() {
        guard bridgeProcess == nil, let configuration else { return }

        stopWasRequested = false
        setState("Bridge is starting…", symbol: "ellipsis.circle")
        bridgeActionItem.title = "Stop Bridge"
        bridgeActionItem.isEnabled = true

        do {
            let rootURL = URL(fileURLWithPath: configuration.trackerRoot)
            let handle = try openLog(at: rootURL.appendingPathComponent("build/lc-menu-bar.log"))
            logHandle = handle

            let process = Process()
            process.executableURL = URL(fileURLWithPath: configuration.nodeExecutable)
            process.arguments = [
                rootURL.appendingPathComponent("node_modules/tsx/dist/cli.mjs").path,
                rootURL.appendingPathComponent("src/launcher/start-bridge.ts").path,
            ]
            process.currentDirectoryURL = rootURL
            process.standardOutput = handle
            process.standardError = handle
            process.terminationHandler = { [weak self] completedProcess in
                DispatchQueue.main.async {
                    self?.bridgeDidExit(completedProcess)
                }
            }

            try process.run()
            bridgeProcess = process
            pollHealth(attemptsRemaining: 30)
        } catch {
            bridgeProcess = nil
            try? logHandle?.close()
            logHandle = nil
            setStoppedState(detail: "Could not start — view log")
            appendFallbackLog("Could not start LCTrack: \(error.localizedDescription)\n")
        }
    }

    private func openLog(at url: URL) throws -> FileHandle {
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: url)
        try handle.seekToEnd()
        let timestamp = ISO8601DateFormatter().string(from: Date())
        handle.write(Data("\n[\(timestamp)] LCTrack menu-bar app starting bridge.\n".utf8))
        return handle
    }

    private func appendFallbackLog(_ message: String) {
        guard let logURL else { return }
        if let data = message.data(using: .utf8),
           let handle = try? FileHandle(forWritingTo: logURL) {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
            try? handle.close()
        }
    }

    private func pollHealth(attemptsRemaining: Int) {
        guard attemptsRemaining > 0, bridgeProcess?.isRunning == true else { return }
        probeHealth { [weak self] healthy in
            guard let self else { return }
            if healthy {
                self.setState("Bridge is running", symbol: "checkmark.circle.fill")
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                self.pollHealth(attemptsRemaining: attemptsRemaining - 1)
            }
        }
    }

    private func probeHealth(completion: @escaping (Bool) -> Void) {
        guard let configuration,
              let url = URL(string: "http://127.0.0.1:\(configuration.port)/health") else {
            completion(false)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let healthy: Bool
            if let response = response as? HTTPURLResponse,
               response.statusCode == 200,
               let data,
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                healthy = object["ok"] as? Bool == true
                    && object["service"] as? String == "leetcode-notion-bridge"
            } else {
                healthy = false
            }
            DispatchQueue.main.async { completion(healthy) }
        }.resume()
    }

    private func bridgeDidExit(_ process: Process) {
        guard bridgeProcess === process else { return }
        bridgeProcess = nil
        try? logHandle?.close()
        logHandle = nil

        if stopWasRequested {
            setStoppedState(detail: "Bridge is stopped")
            return
        }

        probeHealth { [weak self] healthy in
            guard let self else { return }
            if healthy && process.terminationStatus == 0 {
                self.setState("Bridge is running elsewhere", symbol: "checkmark.circle")
                self.bridgeActionItem.title = "Start Bridge"
                self.bridgeActionItem.isEnabled = true
            } else {
                self.setStoppedState(detail: "Bridge stopped — view log")
            }
        }
    }

    private func setStoppedState(detail: String) {
        setState(detail, symbol: "stop.circle")
        bridgeActionItem.title = "Start Bridge"
        bridgeActionItem.isEnabled = true
    }

    private func setState(_ title: String, symbol _: String) {
        stateItem?.title = title
        statusItem?.button?.toolTip = "LCTrack — \(title)"
    }

    private func presentError(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "LCTrack could not start"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    @objc private func openDashboard() {
        guard let configuration,
              let url = URL(string: "http://127.0.0.1:\(configuration.port)/dashboard") else {
            return
        }
        NSWorkspace.shared.open(url)
    }

    @objc private func viewLog() {
        guard let logURL else { return }
        NSWorkspace.shared.open(logURL)
    }

    @objc private func toggleBridge() {
        if let process = bridgeProcess, process.isRunning {
            stopWasRequested = true
            setState("Bridge is stopping…", symbol: "ellipsis.circle")
            bridgeActionItem.isEnabled = false
            process.terminate()
        } else {
            startBridge()
        }
    }

    @objc private func quitApplication() {
        NSApp.terminate(nil)
    }
}

private struct LauncherError: LocalizedError {
    let errorDescription: String?

    init(_ message: String) {
        errorDescription = message
    }
}
