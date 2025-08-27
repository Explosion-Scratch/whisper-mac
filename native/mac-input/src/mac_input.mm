// N-API addon for macOS input and clipboard helpers
#include <napi.h>
#import <ApplicationServices/ApplicationServices.h>
#import <AppKit/AppKit.h>

namespace {

void postCmdV() {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) return;

  CGEventRef cmdDown = CGEventCreateKeyboardEvent(source, (CGKeyCode)0x37, true);
  CGEventRef vDown = CGEventCreateKeyboardEvent(source, (CGKeyCode)0x09, true);
  CGEventRef vUp = CGEventCreateKeyboardEvent(source, (CGKeyCode)0x09, false);
  CGEventRef cmdUp = CGEventCreateKeyboardEvent(source, (CGKeyCode)0x37, false);

  if (cmdDown) CGEventSetFlags(cmdDown, kCGEventFlagMaskCommand);
  if (vDown) CGEventSetFlags(vDown, kCGEventFlagMaskCommand);
  if (vUp) CGEventSetFlags(vUp, kCGEventFlagMaskCommand);

  if (cmdDown) CGEventPost(kCGHIDEventTap, cmdDown);
  usleep(15000);
  if (vDown) CGEventPost(kCGHIDEventTap, vDown);
  usleep(15000);
  if (vUp) CGEventPost(kCGHIDEventTap, vUp);
  usleep(15000);
  if (cmdUp) CGEventPost(kCGHIDEventTap, cmdUp);

  if (cmdDown) CFRelease(cmdDown);
  if (vDown) CFRelease(vDown);
  if (vUp) CFRelease(vUp);
  if (cmdUp) CFRelease(cmdUp);
  CFRelease(source);
}

void postCmdC() {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) return;

  CGEventRef cmdDown = CGEventCreateKeyboardEvent(source, (CGKeyCode)0x37, true);
  CGEventRef cDown = CGEventCreateKeyboardEvent(source, (CGKeyCode)0x08, true);
  CGEventRef cUp = CGEventCreateKeyboardEvent(source, (CGKeyCode)0x08, false);
  CGEventRef cmdUp = CGEventCreateKeyboardEvent(source, (CGKeyCode)0x37, false);

  if (cmdDown) CGEventSetFlags(cmdDown, kCGEventFlagMaskCommand);
  if (cDown) CGEventSetFlags(cDown, kCGEventFlagMaskCommand);
  if (cUp) CGEventSetFlags(cUp, kCGEventFlagMaskCommand);

  if (cmdDown) CGEventPost(kCGHIDEventTap, cmdDown);
  usleep(15000);
  if (cDown) CGEventPost(kCGHIDEventTap, cDown);
  usleep(15000);
  if (cUp) CGEventPost(kCGHIDEventTap, cUp);
  usleep(15000);
  if (cmdUp) CGEventPost(kCGHIDEventTap, cmdUp);

  if (cmdDown) CFRelease(cmdDown);
  if (cDown) CFRelease(cDown);
  if (cUp) CFRelease(cUp);
  if (cmdUp) CFRelease(cmdUp);
  CFRelease(source);
}

Napi::Value PasteCommandV(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  postCmdV();
  return env.Undefined();
}

Napi::Value CopyToClipboard(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected text string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string text = info[0].As<Napi::String>().Utf8Value();
  @autoreleasepool {
    NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
    [pasteboard clearContents];
    NSString* nsText = [NSString stringWithUTF8String:text.c_str()];
    BOOL ok = [pasteboard setString:nsText forType:NSPasteboardTypeString];
    return Napi::Boolean::New(env, ok ? true : false);
  }
}

Napi::Value GetClipboardText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  @autoreleasepool {
    NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
    NSString* content = [pasteboard stringForType:NSPasteboardTypeString];
    if (content == nil) {
      return env.Null();
    }
    return Napi::String::New(env, [content UTF8String]);
  }
}

Napi::Value CheckPermissions(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Boolean trusted = AXIsProcessTrusted();
  return Napi::Boolean::New(env, trusted ? true : false);
}

Napi::Value InjectText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected text string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string text = info[0].As<Napi::String>().Utf8Value();

  @autoreleasepool {
    // Backup clipboard
    NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
    NSArray<NSPasteboardItem*>* items = [pasteboard pasteboardItems];
    NSMutableArray<NSPasteboardItem*>* backupItems = [NSMutableArray array];
    for (NSPasteboardItem* item in items) {
      NSPasteboardItem* newItem = [[NSPasteboardItem alloc] init];
      for (NSPasteboardType type in [item types]) {
        NSData* data = [item dataForType:type];
        if (data) {
          [newItem setData:data forType:type];
        }
      }
      [backupItems addObject:newItem];
    }

    // Copy requested text
    [pasteboard clearContents];
    NSString* nsText = [NSString stringWithUTF8String:text.c_str()];
    BOOL ok = [pasteboard setString:nsText forType:NSPasteboardTypeString];
    if (!ok) {
      Napi::Error::New(env, "Failed to set clipboard").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    usleep(200000);
    NSString* verify = [pasteboard stringForType:NSPasteboardTypeString];
    if (verify == nil || ![verify isEqualToString:nsText]) {
      // restore then throw
      [pasteboard clearContents];
      if ([backupItems count] > 0) {
        [pasteboard writeObjects:backupItems];
      }
      Napi::Error::New(env, "Clipboard verification failed").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    // Paste and restore
    postCmdV();
    usleep(300000);
    [pasteboard clearContents];
    if ([backupItems count] > 0) {
      [pasteboard writeObjects:backupItems];
    }

    return env.Undefined();
  }
}

Napi::Value GetWindowAppDetails(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  @autoreleasepool {
    NSRunningApplication* frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (!frontApp) {
      return env.Null();
    }
    NSString* appName = [frontApp localizedName] ?: @"";
    AXUIElementRef appElem = AXUIElementCreateApplication(frontApp.processIdentifier);
    if (!appElem) {
      std::string result = std::string("|") + [appName UTF8String];
      return Napi::String::New(env, result);
    }
    CFTypeRef windowList = nullptr;
    AXError res = AXUIElementCopyAttributeValue(appElem, kAXWindowsAttribute, &windowList);
    if (res != kAXErrorSuccess || windowList == nullptr) {
      CFRelease(appElem);
      std::string result = std::string("|") + [appName UTF8String];
      return Napi::String::New(env, result);
    }
    NSString* title = nil;
    if (CFGetTypeID(windowList) == CFArrayGetTypeID()) {
      CFArrayRef windows = (CFArrayRef)windowList;
      CFIndex count = CFArrayGetCount(windows);
      for (CFIndex i = 0; i < count; i++) {
        AXUIElementRef window = (AXUIElementRef)CFArrayGetValueAtIndex(windows, i);
        CFTypeRef titleRef = nullptr;
        if (AXUIElementCopyAttributeValue(window, kAXTitleAttribute, &titleRef) == kAXErrorSuccess && titleRef) {
          if (CFGetTypeID(titleRef) == CFStringGetTypeID()) {
            title = [(__bridge NSString*)titleRef copy];
          }
          CFRelease(titleRef);
          if (title != nil && [title length] > 0) break;
        }
      }
    }
    if (windowList) CFRelease(windowList);
    CFRelease(appElem);
    std::string result;
    if (title && [title length] > 0) {
      result = std::string([title UTF8String]) + "|" + [appName UTF8String];
    } else {
      result = std::string("|") + [appName UTF8String];
    }
    return Napi::String::New(env, result);
  }
}

Napi::Value GetSelectedText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  @autoreleasepool {
    NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
    // Backup clipboard (as string best-effort)
    NSString* original = [pasteboard stringForType:NSPasteboardTypeString];
    NSString* originalString = original ? [original copy] : nil;

    // Issue Cmd+C
    postCmdC();
    usleep(200000);

    NSString* copied = [pasteboard stringForType:NSPasteboardTypeString];
    std::string originalOut = originalString ? [originalString UTF8String] : "";
    std::string copiedOut = copied ? [copied UTF8String] : "";
    bool hasSelection = copied && [copied length] > 0;

    // Restore original clipboard
    [pasteboard clearContents];
    if (originalString) {
      [pasteboard setString:originalString forType:NSPasteboardTypeString];
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("text", Napi::String::New(env, copiedOut));
    result.Set("hasSelection", Napi::Boolean::New(env, hasSelection));
    result.Set("originalClipboard", Napi::String::New(env, originalOut));
    return result;
  }
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "pasteCommandV"), Napi::Function::New(env, PasteCommandV));
  exports.Set(Napi::String::New(env, "copyToClipboard"), Napi::Function::New(env, CopyToClipboard));
  exports.Set(Napi::String::New(env, "getClipboardText"), Napi::Function::New(env, GetClipboardText));
  exports.Set(Napi::String::New(env, "checkPermissions"), Napi::Function::New(env, CheckPermissions));
  exports.Set(Napi::String::New(env, "injectText"), Napi::Function::New(env, InjectText));
  exports.Set(Napi::String::New(env, "getWindowAppDetails"), Napi::Function::New(env, GetWindowAppDetails));
  exports.Set(Napi::String::New(env, "getSelectedText"), Napi::Function::New(env, GetSelectedText));
  return exports;
}

}  // namespace

NODE_API_MODULE(mac_input, Init)


