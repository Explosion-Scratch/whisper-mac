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

// MARK: - Clipboard Backup/Restore
func backupClipboard() -> [(NSPasteboard.PasteboardType, Data)] {
    let pasteboard = NSPasteboard.general
    var savedContents: [(NSPasteboard.PasteboardType, Data)] = []
    let currentItems = pasteboard.pasteboardItems ?? []
    for item in currentItems {
        for type in item.types {
            if let data = item.data(forType: type) {
                savedContents.append((type, data))
            }
        }
    }
    return savedContents
}

func restoreClipboard(_ saved: [(NSPasteboard.PasteboardType, Data)]) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    for (type, data) in saved {
        pasteboard.setData(data, forType: type)
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

// MARK: - Get Selection Logic
func getSelectedText() -> String? {
    guard AXIsProcessTrusted() else {
        fputs("Accessibility permissions required!\n", stderr)
        return nil
    }
    
    // Backup current clipboard
    let backup = backupClipboard()
    
    // Clear clipboard and set a marker to detect if copy actually happened
    let marker = "SELECTION_MARKER_\(UUID().uuidString)"
    _ = ClipboardManager.copyToClipboard(marker)
    
    // Small delay to ensure clipboard is set
    usleep(50000)
    
    let source = CGEventSource(stateID: .hidSystemState)
    let cmdDown = CGEvent(keyboardEventSource: source, virtualKey: 0x37, keyDown: true)
    let cDown = CGEvent(keyboardEventSource: source, virtualKey: 0x08, keyDown: true)
    let cUp = CGEvent(keyboardEventSource: source, virtualKey: 0x08, keyDown: false)
    let cmdUp = CGEvent(keyboardEventSource: source, virtualKey: 0x37, keyDown: false)
    
    cmdDown?.flags = .maskCommand
    cDown?.flags = .maskCommand
    cUp?.flags = .maskCommand
    
    cmdDown?.post(tap: .cghidEventTap)
    usleep(10000)
    cDown?.post(tap: .cghidEventTap)
    cUp?.post(tap: .cghidEventTap)
    cmdUp?.post(tap: .cghidEventTap)
    
    usleep(100000)
    
    // Get the clipboard content after copy attempt
    let clipboardAfterCopy = ClipboardManager.getClipboardContent() ?? ""
    
    // Restore original clipboard
    restoreClipboard(backup)
    
    // Check if the clipboard changed (indicating a successful copy)
    if clipboardAfterCopy != marker && !clipboardAfterCopy.isEmpty {
        return clipboardAfterCopy
    } else {
        // No selection or copy failed
        return ""
    }
}

// MARK: - Window and App Details Logic
func getWindowAppDetails() -> String? {
    guard let frontmostApp = NSWorkspace.shared.frontmostApplication else {
        return nil
    }
    
    let appName = frontmostApp.localizedName ?? ""
    
    // Get the frontmost window using Accessibility API
    let appElement = AXUIElementCreateApplication(frontmostApp.processIdentifier)
    
    var windowList: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowList)
    
    guard result == .success, let windows = windowList as? [AXUIElement] else {
        return "|\(appName)"
    }
    
    // Find the frontmost window
    for window in windows {
        var windowTitle: CFTypeRef?
        let titleResult = AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &windowTitle)
        
        if titleResult == .success, let title = windowTitle as? String, !title.isEmpty {
            return "\(title)|\(appName)"
        }
    }
    
    return "|\(appName)"
}

// MARK: - Argument Parsing
enum Mode {
    case inject(String)
    case copy(String)
    case paste
    case getSelection
    case windowAppDetails
    case checkPerms
    case help
}

func parseArguments() -> Mode {
    let args = CommandLine.arguments
    if args.count == 2 {
        if args[1] == "--paste" {
            return .paste
        }
        if args[1] == "--get-selection" {
            return .getSelection
        }
        if args[1] == "--window-app-details" {
            return .windowAppDetails
        }
        if args[1] == "--check-perms" {
            return .checkPerms
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

// MARK: - Permission Check
func checkAccessibilityPermissions() -> Bool {
    return AXIsProcessTrusted()
}

// MARK: - Main Execution
func showHelp() {
    print("""
    Usage:
      injectUtil "text to inject"   - Copy text to clipboard, paste at cursor, restore clipboard
      injectUtil --copy "text"      - Copy text to clipboard only
      injectUtil --paste            - Paste clipboard contents at cursor
      injectUtil --get-selection    - Get selected text from active application
      injectUtil --window-app-details - Get active window title and app name
      injectUtil --check-perms      - Check if accessibility permissions are granted (outputs true/false)
      injectUtil --help             - Show this help message

    Note: You must grant Accessibility permissions for pasting and getting selection.
    """)
}

let mode = parseArguments()

switch mode {
case .help:
    showHelp()
    exit(1)
case .checkPerms:
    let hasPermissions = checkAccessibilityPermissions()
    print(hasPermissions ? "true" : "false")
    exit(hasPermissions ? 0 : 1)
case .copy(let text):
    if ClipboardManager.copyToClipboard(text) {
        print("Copied to clipboard.")
        exit(0)
    } else {
        fputs("Failed to copy to clipboard.\n", stderr)
        exit(1)
    }
case .inject(let text):
    let backup = backupClipboard()
    if ClipboardManager.copyToClipboard(text) {
        usleep(100_000)
        pasteUsingCommandV()
        usleep(100_000)
        restoreClipboard(backup)
        print("Injected, pasted, and restored clipboard.")
        exit(0)
    } else {
        fputs("Failed to copy to clipboard.\n", stderr)
        restoreClipboard(backup)
        exit(1)
    }
case .paste:
    pasteUsingCommandV()
    print("Pasted clipboard contents.")
    exit(0)
case .getSelection:
    if let selectedText = getSelectedText() {
        print(selectedText)
        exit(0)
    } else {
        fputs("Failed to get selected text.\n", stderr)
        exit(1)
    }
case .windowAppDetails:
    if let details = getWindowAppDetails() {
        print(details)
        exit(0)
    } else {
        fputs("Failed to get window app details.\n", stderr)
        exit(1)
    }
}