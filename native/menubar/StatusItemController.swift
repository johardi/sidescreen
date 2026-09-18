import AppKit
import Foundation

/// What the item knows about the server on its port.
enum ServerState: Equatable {
    case unknown
    case stopped
    case running(version: String, pid: Int)
    /// A command is running; the label is what the status line says.
    case busy(String)
    /// A command failed; the message is the first line of its error output.
    case failed(String)
}

final class StatusItemController: NSObject {
    private let options: Options
    private let item: NSStatusItem
    private let session: URLSession
    private var timer: Timer?

    private var state: ServerState = .unknown {
        didSet { if state != oldValue { render() } }
    }
    /// The last state a poll observed, whatever the item shows.
    private var lastObserved: ServerState = .unknown
    /// What the poll had observed when a command failed; the failure yields
    /// once the observation changes.
    private var observedAtFailure: ServerState = .unknown

    init(options: Options) {
        self.options = options
        self.item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 1.5
        configuration.timeoutIntervalForResource = 1.5
        self.session = URLSession(configuration: configuration)
        super.init()
    }

    func start() {
        render()
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    private var serverURL: URL {
        URL(string: "http://127.0.0.1:\(options.port)/")!
    }

    // MARK: Observing

    private func poll() {
        let task = session.dataTask(with: serverURL.appendingPathComponent("api/health")) { [weak self] data, response, _ in
            var observed = ServerState.stopped
            if let data,
               let http = response as? HTTPURLResponse, http.statusCode == 200,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               json["name"] as? String == "sidescreen",
               let version = json["version"] as? String,
               let pid = json["pid"] as? Int {
                observed = .running(version: version, pid: pid)
            }
            DispatchQueue.main.async { self?.observe(observed) }
        }
        task.resume()
    }

    private func observe(_ observed: ServerState) {
        lastObserved = observed
        switch state {
        case .busy:
            return
        case .failed:
            if observed != observedAtFailure { state = observed }
        default:
            state = observed
        }
    }

    // MARK: Acting

    @objc private func openServer() {
        NSWorkspace.shared.open(serverURL)
    }

    @objc private func showLog() {
        let logPath = (options.stateDir as NSString).appendingPathComponent("server.log")
        NSWorkspace.shared.open(URL(fileURLWithPath: logPath))
    }

    @objc private func startServer() {
        run(action: "start", label: "Starting SideScreen")
    }

    @objc private func stopServer() {
        run(action: "stop", label: "Stopping SideScreen")
    }

    /// Run `node <bin> <action> --port <n>` with this process's environment,
    /// which is the environment `sidescreen start` launched the item with.
    private func run(action: String, label: String) {
        if case .busy = state { return }
        state = .busy(label)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: options.node)
        process.arguments = [options.bin, action, "--port", String(options.port)]
        process.environment = ProcessInfo.processInfo.environment
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        process.terminationHandler = { [weak self] finished in
            _ = output.fileHandleForReading.readDataToEndOfFile()
            let text = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let firstLine = text
                .split(whereSeparator: \.isNewline)
                .map { String($0).trimmingCharacters(in: .whitespaces) }
                .first { !$0.isEmpty }
            DispatchQueue.main.async {
                guard let self else { return }
                if finished.terminationStatus == 0 {
                    self.state = .unknown
                } else {
                    self.observedAtFailure = self.lastObserved
                    self.state = .failed(firstLine ?? "sidescreen \(action) exited with status \(finished.terminationStatus)")
                }
                self.poll()
            }
        }
        do {
            try process.run()
        } catch {
            observedAtFailure = lastObserved
            state = .failed("cannot run \(options.node): \(error.localizedDescription)")
        }
    }

    // MARK: Rendering

    private func render() {
        let effective: ServerState
        if case .failed = state { effective = lastObserved } else { effective = state }
        var running = false
        if case .running = effective { running = true }
        let settled: Bool
        switch effective {
        case .unknown, .busy: settled = false
        default: settled = true
        }

        let symbol: String
        let status: String
        var tooltip: String
        switch state {
        case .unknown:
            symbol = "macwindow.on.rectangle"
            status = "Checking SideScreen (port: \(options.port))…"
            tooltip = status
        case .stopped:
            symbol = "rectangle.on.rectangle.slash"
            status = "SideScreen is stopped"
            tooltip = "SideScreen is stopped (port: \(options.port))"
        case .running(let version, let pid):
            symbol = "macwindow.on.rectangle"
            status = "SideScreen is running"
            tooltip = "SideScreen \(version) is running (port: \(options.port), pid: \(pid))"
        case .busy(let label):
            symbol = "macwindow.on.rectangle"
            status = "\(label)…"
            tooltip = "\(label) (port: \(options.port))…"
        case .failed(let message):
            symbol = "rectangle.on.rectangle.slash"
            status = message
            tooltip = message
        }

        if let button = item.button {
            let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "SideScreen")
            image?.isTemplate = true
            button.image = image
            button.toolTip = tooltip
        }

        let menu = NSMenu()
        menu.autoenablesItems = false
        let statusLine = NSMenuItem(title: status, action: nil, keyEquivalent: "")
        statusLine.isEnabled = false
        menu.addItem(statusLine)
        menu.addItem(.separator())
        menu.addItem(makeItem("Open SideScreen", #selector(openServer), enabled: running))
        menu.addItem(makeItem("Start", #selector(startServer), enabled: settled && !running))
        menu.addItem(makeItem("Stop", #selector(stopServer), enabled: settled && running))
        menu.addItem(.separator())
        menu.addItem(makeItem("Show log", #selector(showLog), enabled: true))
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        quit.isEnabled = true
        menu.addItem(quit)
        item.menu = menu
    }

    /// A menu entry with no keyboard shortcut.
    private func makeItem(_ title: String, _ action: Selector, enabled: Bool) -> NSMenuItem {
        let menuItem = NSMenuItem(title: title, action: action, keyEquivalent: "")
        menuItem.target = self
        menuItem.isEnabled = enabled
        return menuItem
    }
}
