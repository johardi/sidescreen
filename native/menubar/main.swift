// sidescreen-menubar: a menu bar item for the background server, compiled.
//
// NOT SHIPPED. The item sidescreen ships is menubar/sidescreen-menubar.js, a
// JavaScript for Automation script run by /usr/bin/osascript. This Swift
// helper does the same job in 62 MB and 290 KB, but a freshly built, ad-hoc
// signed binary is quarantined on first execution by endpoint agents such as
// CrowdStrike Falcon, which happened on the developer's own Mac. It stays here
// for the day a Developer ID is available: build it with scripts/build-menubar.sh
// (npm run build:menubar), sign and notarize the result, and point
// SIDESCREEN_MENUBAR_BIN at it. Its command line already matches the script's.
//
// It is a controller, not an owner. It asks the server's health endpoint
// whether a server answers on its port and runs `sidescreen start` or
// `sidescreen stop` when asked. Quitting it leaves the server alone.

import AppKit
import Foundation

struct Options {
    var port: Int
    var stateDir: String
    var node: String
    var bin: String
}

func fail(_ message: String, status: Int32 = 2) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(status)
}

func parseOptions(_ arguments: [String]) -> Options {
    var port: Int?
    var stateDir: String?
    var node: String?
    var bin: String?
    var index = 0
    while index < arguments.count {
        let flag = arguments[index]
        let value = index + 1 < arguments.count ? arguments[index + 1] : nil
        switch flag {
        case "--port":
            port = value.flatMap { Int($0) }
        case "--state-dir":
            stateDir = value
        case "--node":
            node = value
        case "--bin":
            bin = value
        default:
            fail("sidescreen-menubar: unknown option \(flag)\nusage: sidescreen-menubar --port <n> --state-dir <dir> --node <path> --bin <path>")
        }
        index += 2
    }
    guard let port, let stateDir, let node, let bin else {
        fail("usage: sidescreen-menubar --port <n> --state-dir <dir> --node <path> --bin <path>")
    }
    return Options(port: port, stateDir: stateDir, node: node, bin: bin)
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.contains("--version") {
    print("sidescreen-menubar \(menubarVersion)")
    exit(0)
}
let options = parseOptions(arguments)

// One item per store. The kernel releases the lock when the holder dies, so
// there is no stale state to reconcile; a second item finds the lock held and
// leaves before touching AppKit.
try? FileManager.default.createDirectory(atPath: options.stateDir, withIntermediateDirectories: true)
let lockPath = (options.stateDir as NSString).appendingPathComponent("menubar.lock")
let lockDescriptor = open(lockPath, O_CREAT | O_RDWR, 0o644)
if lockDescriptor < 0 {
    fail("sidescreen-menubar: cannot open \(lockPath): \(String(cString: strerror(errno)))", status: 1)
}
if flock(lockDescriptor, LOCK_EX | LOCK_NB) != 0 {
    print("sidescreen-menubar: another item already runs for \(options.stateDir)")
    exit(0)
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let controller = StatusItemController(options: options)
controller.start()
application.run()
