import Foundation
import ApplicationServices
import AppKit

// ---------- CLI ----------
let args = CommandLine.arguments
let verbose = args.contains("--verbose") || args.contains("-v")

func vprint(_ s: String) {
    if verbose {
        if let data = (s + "\n").data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
    }
}

// ---------- Accessibility trust ----------
func ensureAccessibilityTrusted() -> Bool {
    // Ask the system whether we're trusted to use Accessibility APIs.
    // We do not always prompt automatically; only prompt if not trusted.
    if AXIsProcessTrusted() {
        vprint("AXIsProcessTrusted: YES")
        return true
    } else {
        vprint("AXIsProcessTrusted: NO — prompting the user (will open System Settings -> Privacy).")
        // Prompt the user to grant permission (this will open the Preferences pane on macOS)
        let options = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true] as CFDictionary
        let trusted = AXIsProcessTrustedWithOptions(options)
        // AXIsProcessTrustedWithOptions may return immediately; user may need to grant manually.
        if trusted {
            vprint("AXIsProcessTrustedWithOptions returned YES")
        } else {
            vprint("AXIsProcessTrustedWithOptions returned NO")
        }
        return AXIsProcessTrusted()
    }
}

// ---------- AX helpers ----------
func getFocusedUIElement() -> AXUIElement? {
    let systemWide = AXUIElementCreateSystemWide()
    var focused: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute as CFString, &focused)
    if err == .success, let element = focused {
        return (element as! AXUIElement)
    } else {
        vprint("Failed to get kAXFocusedUIElement: \(err.rawValue)")
        return nil
    }
}

func axCopyStringAttribute(_ element: AXUIElement, _ attr: CFString) -> String? {
    var val: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, attr, &val)
    if err == .success, let s = val as? String {
        vprint("AX attribute \(attr) found (String).")
        return s
    }
    // Sometimes selected text attribute is an AXValue containing a CFString reference; try toll-free bridging
    if err == .success, let cf = val {
        // try converting to String if possible
        if CFGetTypeID(cf) == CFStringGetTypeID() {
            let result = (cf as! CFString) as String
            vprint("AX attribute \(attr) found (CFString).")
            return result
        }
    }
    vprint("AX attribute \(attr) not available or not a string. AXError: \(err.rawValue)")
    return nil
}

// Try to get selection using kAXSelectedTextAttribute
func selectedTextFromAX(_ element: AXUIElement) -> String? {
    // 1) Direct selected text attribute (most apps that expose selection do this)
    if let sel = axCopyStringAttribute(element, kAXSelectedTextAttribute as CFString) {
        return sel
    }

    // 2) For some controls, value contains whole text and selected range attribute tells selection
    if let fullValue = axCopyStringAttribute(element, kAXValueAttribute as CFString) {
        vprint("kAXValueAttribute present (length=\(fullValue.count))")
        // Try to read selected range
        var selRangeRef: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &selRangeRef)
        if err == .success, let axval = selRangeRef {
            // Expect an AXValue holding a CFRange
            if CFGetTypeID(axval) == AXValueGetTypeID() {
                // AXValue -> CFRange extraction
                var cfRange = CFRange(location: 0, length: 0)
                if AXValueGetValue(axval as! AXValue, AXValueType.cfRange, &cfRange) {
                    let location = cfRange.location
                    let length = cfRange.length
                    vprint("kAXSelectedTextRange: location=\(location), length=\(length)")
                    // safety bounds
                    if location >= 0 && length > 0 && location + length <= fullValue.utf16.count {
                        // extract substring by UTF-16 index to handle multi-byte characters
                        if let startIdx = fullValue.utf16.index(fullValue.utf16.startIndex, offsetBy: location, limitedBy: fullValue.utf16.endIndex),
                           let endIdx = fullValue.utf16.index(startIdx, offsetBy: length, limitedBy: fullValue.utf16.endIndex) {
                            if let substr = String(fullValue.utf16[startIdx..<endIdx]), !substr.isEmpty {
                                return substr
                            }
                        }
                    } else {
                        vprint("CFRange out of bounds or empty.")
                    }
                } else {
                    vprint("AXValueGetValue failed for cfRange.")
                }
            } else {
                vprint("kAXSelectedTextRange present but not an AXValue.")
            }
        } else {
            vprint("kAXSelectedTextRange not available. AXError: \(err.rawValue)")
        }
        // If no selected range, maybe whole value is the selection (some single-line fields)
        // But we prefer not to assume; however if the element is editable and focused, returning the whole value may be okay.
        // We'll *not* return fullValue unless absolutely necessary (keep safer behavior).
    } else {
        vprint("kAXValueAttribute not present or not a string.")
    }

    // 3) Some apps expose kAXFocusedWindow or children that actually hold the typed text. Try searching children for selected text quickly.
    var childrenRef: CFTypeRef?
    let childErr = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef)
    if childErr == .success, let children = childrenRef as? [AXUIElement], !children.isEmpty {
        vprint("Searching \(children.count) child elements for selected text...")
        for child in children {
            if let s = axCopyStringAttribute(child, kAXSelectedTextAttribute as CFString) {
                return s
            }
            if let s2 = axCopyStringAttribute(child, kAXValueAttribute as CFString) {
                // check for selected range on child
                var selRangeRef: CFTypeRef?
                let e = AXUIElementCopyAttributeValue(child, kAXSelectedTextRangeAttribute as CFString, &selRangeRef)
                if e == .success, let axval = selRangeRef, CFGetTypeID(axval) == AXValueGetTypeID() {
                    var cfRange = CFRange(location: 0, length: 0)
                    if AXValueGetValue(axval as! AXValue, AXValueType.cfRange, &cfRange) {
                        let loc = cfRange.location
                        let len = cfRange.length
                        if loc >= 0 && len > 0 && loc + len <= s2.utf16.count {
                            if let startIdx = s2.utf16.index(s2.utf16.startIndex, offsetBy: loc, limitedBy: s2.utf16.endIndex),
                               let endIdx = s2.utf16.index(startIdx, offsetBy: len, limitedBy: s2.utf16.endIndex) {
                                if let substr = String(s2.utf16[startIdx..<endIdx]), !substr.isEmpty {
                                    return substr
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
        vprint("No children or failed to get children: AXError \(childErr.rawValue)")
    }

    return nil
}

// ---------- Clipboard fallback (safe) ----------
func copySelectionWithCmdCPreserveClipboard() -> String? {
    // Save current string clipboard (best-effort)
    let pasteboard = NSPasteboard.general
    let originalStrings = pasteboard.pasteboardItems?.map { item -> [NSPasteboard.PasteboardType: Data] in
        var dict: [NSPasteboard.PasteboardType: Data] = [:]
        for type in item.types {
            if let d = item.data(forType: type) {
                dict[type] = d
            }
        }
        return dict
    } ?? []

    vprint("Saved \(originalStrings.count) pasteboard items for restore (best-effort).")

    // Post synthetic Cmd-C. This requires accessibility/assistive access (we already checked).
    guard let src = CGEventSource(stateID: .combinedSessionState) else {
        vprint("Could not create CGEventSource.")
        return nil
    }

    // Virtual keycode for 'c' on ANSI layout is 8. Not fully universal but works on most macs.
    let keyCodeC: CGKeyCode = 8

    if let keyDown = CGEvent(keyboardEventSource: src, virtualKey: keyCodeC, keyDown: true) {
        keyDown.flags = .maskCommand
        keyDown.post(tap: .cghidEventTap)
    } else { vprint("Failed to create keyDown event") }

    if let keyUp = CGEvent(keyboardEventSource: src, virtualKey: keyCodeC, keyDown: false) {
        keyUp.flags = .maskCommand
        keyUp.post(tap: .cghidEventTap)
    } else { vprint("Failed to create keyUp event") }

    // Wait a short moment for the copy to complete
    usleep(120_000) // 120ms

    // Try to read string from pasteboard
    let copied = pasteboard.string(forType: .string)
    vprint("Clipboard after Cmd-C contains: \(copied?.count ?? 0) characters")

    // Restore pasteboard items (best-effort)
    if !originalStrings.isEmpty {
        pasteboard.clearContents()
        var restoredItems: [NSPasteboardItem] = []
        for dict in originalStrings {
            let item = NSPasteboardItem()
            for (type, data) in dict {
                item.setData(data, forType: type)
            }
            restoredItems.append(item)
        }
        let success = pasteboard.writeObjects(restoredItems)
        vprint("Restored original pasteboard items: \(success)")
    }

    return copied
}

// ---------- Main ----------
if !ensureAccessibilityTrusted() {
    // If not trusted, AX APIs will fail; give a clear message.
    let msg = "Error: This tool needs Accessibility (Assistive Devices) permission. Open System Settings → Privacy & Security → Accessibility and allow this app (or Terminal)."
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(2)
}

guard let focused = getFocusedUIElement() else {
    vprint("No focused element found.")
    // Try clipboard fallback anyway (best-effort)
    if let fallback = copySelectionWithCmdCPreserveClipboard() {
        print(fallback)
        exit(0)
    } else {
        exit(1)
    }
}

vprint("Found focused element: \(focused)")

if let selection = selectedTextFromAX(focused) {
    // Print selection to stdout
    print(selection)
    exit(0)
} else {
    vprint("AX failed to get selection. Trying clipboard fallback (Cmd-C).")
    if let fallback = copySelectionWithCmdCPreserveClipboard() {
        if !fallback.isEmpty {
            print(fallback)
            exit(0)
        } else {
            vprint("Clipboard fallback succeeded but returned empty string.")
            exit(1)
        }
    } else {
        vprint("Clipboard fallback failed.")
        exit(1)
    }
}
