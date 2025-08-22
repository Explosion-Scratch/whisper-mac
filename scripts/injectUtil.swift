import Foundation
import AppKit

// MARK: - ClipboardManager
struct ClipboardManager {
    static func copyToClipboard(_ text: String) -> Bool {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        return pasteboard.setString(text, forType: .string)
    }

    static func getClipboardContent() -> String? {
        return NSPasteboard.general.string(forType: .string)
    }
}

// MARK: - Paste Logic
func pasteUsingCommandV() {
    guard AXIsProcessTrusted() else {
        fputs("Accessibility permissions required!\n", stderr)
        exit(2)
    }
    let source = CGEventSource(stateID: .hidSystemState)
    let cmdDown = CGEvent(keyboardEventSource: source, virtualKey: 0x37, keyDown: true)
    let vDown = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: true)
    let vUp = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: false)
    let cmdUp = CGEvent(keyboardEventSource: source, virtualKey: 0x37, keyDown: false)
    cmdDown?.flags = .maskCommand
    vDown?.flags = .maskCommand
    vUp?.flags = .maskCommand
    cmdDown?.post(tap: .cghidEventTap)
    usleep(10000)
    vDown?.post(tap: .cghidEventTap)
    vUp?.post(tap: .cghidEventTap)
    cmdUp?.post(tap: .cghidEventTap)
}

// MARK: - Argument Parsing
enum Mode {
    case inject(String)
    case copy(String)
    case paste
    case help
}

func parseArguments() -> Mode {
    let args = CommandLine.arguments
    if args.count == 2 {
        if args[1] == "--paste" {
            return .paste
        }
        if args[1] == "--help" || args[1] == "-h" {
            return .help
        }
        return .inject(args[1])
    } else if args.count == 3 {
        if args[1] == "--copy" {
            return .copy(args[2])
        }
        if args[1] == "--inject" {
            return .inject(args[2])
        }
    }
    return .help
}

// MARK: - Main Execution
func showHelp() {
    print("""
    Usage:
      injectUtil "text to inject"   - Copy text to clipboard and paste at cursor
      injectUtil --copy "text"      - Copy text to clipboard only
      injectUtil --paste            - Paste clipboard contents at cursor
      injectUtil --help             - Show this help message

    Note: You must grant Accessibility permissions for pasting.
    """)
}

let mode = parseArguments()

switch mode {
case .help:
    showHelp()
    exit(1)
case .copy(let text):
    if ClipboardManager.copyToClipboard(text) {
        print("Copied to clipboard.")
        exit(0)
    } else {
        fputs("Failed to copy to clipboard.\n", stderr)
        exit(1)
    }
case .inject(let text):
    if ClipboardManager.copyToClipboard(text) {
        usleep(100_000)
        pasteUsingCommandV()
        print("Injected and pasted.")
        exit(0)
    } else {
        fputs("Failed to copy to clipboard.\n", stderr)
        exit(1)
    }
case .paste:
    pasteUsingCommandV()
    print("Pasted clipboard contents.")
    exit(0)
}