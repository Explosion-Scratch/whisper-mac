import Foundation
import ApplicationServices

func getFocusedText() -> String? {
    let systemWideElement = AXUIElementCreateSystemWide()
    
    var focusedElement: AXUIElement?
    let result = AXUIElementCopyAttributeValue(systemWideElement, kAXFocusedUIElementAttribute as CFString, &focusedElement)

    guard result == .success, let element = focusedElement else {
        print("❌ Could not get focused UI element")
        return nil
    }

    // Try getting the AXValue (common for text fields)
    var value: CFTypeRef?
    let valueResult = AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value)

    if valueResult == .success, let val = value as? String {
        return val
    }

    // Try getting selected text if possible
    let selectedTextResult = AXUIElementCopyAttributeValue(element, "AXSelectedText" as CFString, &value)
    if selectedTextResult == .success, let sel = value as? String {
        return sel
    }

    return nil
}

if let text = getFocusedText() {
    print("📝 Focused Text Field Value: \(text)")
} else {
    print("⚠️ Could not read text from the focused element")
}
