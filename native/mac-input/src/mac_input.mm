// N-API addon for macOS input and clipboard helpers
#include <napi.h>
#import <ApplicationServices/ApplicationServices.h>
#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#import <dispatch/dispatch.h>

#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace {
void postCmdV() {
  CGEventSourceRef source =
      CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
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
  CGEventSourceRef source =
      CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
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

Napi::Value PasteCommandV(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  postCmdV();
  return env.Undefined();
}

Napi::Value CopyToClipboard(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected text string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string text = info[0].As<Napi::String>().Utf8Value();
  @autoreleasepool {
    NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
    [pasteboard clearContents];
    NSString *nsText = [NSString stringWithUTF8String:text.c_str()];
    BOOL ok = [pasteboard setString:nsText forType:NSPasteboardTypeString];
    return Napi::Boolean::New(env, ok ? true : false);
  }
}

Napi::Value GetClipboardText(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  @autoreleasepool {
    NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
    NSString *content = [pasteboard stringForType:NSPasteboardTypeString];
    if (content == nil) {
      return env.Null();
    }
    return Napi::String::New(env, [content UTF8String]);
  }
}

Napi::Value CheckPermissions(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Boolean trusted = AXIsProcessTrusted();
  return Napi::Boolean::New(env, trusted ? true : false);
}

Napi::Value CheckPermissionsWithPrompt(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  bool shouldPrompt = info.Length() > 0 && info[0].IsBoolean() && info[0].As<Napi::Boolean>().Value();

  @autoreleasepool {
    NSDictionary *options = @{};
    if (shouldPrompt) {
      options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
    }

    Boolean trusted = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
    return Napi::Boolean::New(env, trusted ? true : false);
  }
}

Napi::Value InjectText(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected text string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string text = info[0].As<Napi::String>().Utf8Value();

  @autoreleasepool {
    NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
    NSArray<NSPasteboardItem *> *items = [pasteboard pasteboardItems];
    NSMutableArray<NSPasteboardItem *> *backupItems = [NSMutableArray array];

    for (NSPasteboardItem *item in items) {
      NSPasteboardItem *newItem = [[NSPasteboardItem alloc] init];
      for (NSPasteboardType type in [item types]) {
        NSData *data = [item dataForType:type];
        if (data) {
          [newItem setData:data forType:type];
        }
      }
      [backupItems addObject:newItem];
    }

    [pasteboard clearContents];
    NSString *nsText = [NSString stringWithUTF8String:text.c_str()];
    BOOL ok = [pasteboard setString:nsText forType:NSPasteboardTypeString];
    if (!ok) {
      Napi::Error::New(env, "Failed to set clipboard")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }

    usleep(200000);
    NSString *verify = [pasteboard stringForType:NSPasteboardTypeString];
    if (verify == nil || ![verify isEqualToString:nsText]) {
      [pasteboard clearContents];
      if ([backupItems count] > 0) {
        [pasteboard writeObjects:backupItems];
      }
      Napi::Error::New(env, "Clipboard verification failed")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }

    postCmdV();
    usleep(300000);
    [pasteboard clearContents];
    if ([backupItems count] > 0) {
      [pasteboard writeObjects:backupItems];
    }

    return env.Undefined();
  }
}

Napi::Value GetWindowAppDetails(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  @autoreleasepool {
    NSRunningApplication *frontApp =
        [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (!frontApp) {
      return env.Null();
    }
    NSString *appName = [frontApp localizedName] ?: @"";
    AXUIElementRef appElem =
        AXUIElementCreateApplication(frontApp.processIdentifier);
    if (!appElem) {
      std::string result = std::string("|") + [appName UTF8String];
      return Napi::String::New(env, result);
    }
    CFTypeRef windowList = nullptr;
    AXError res =
        AXUIElementCopyAttributeValue(appElem, kAXWindowsAttribute, &windowList);
    if (res != kAXErrorSuccess || windowList == nullptr) {
      CFRelease(appElem);
      std::string result = std::string("|") + [appName UTF8String];
      return Napi::String::New(env, result);
    }
    NSString *title = nil;
    if (CFGetTypeID(windowList) == CFArrayGetTypeID()) {
      CFArrayRef windows = (CFArrayRef)windowList;
      CFIndex count = CFArrayGetCount(windows);
      for (CFIndex i = 0; i < count; i++) {
        AXUIElementRef window =
            (AXUIElementRef)CFArrayGetValueAtIndex(windows, i);
        CFTypeRef titleRef = nullptr;
        if (AXUIElementCopyAttributeValue(window, kAXTitleAttribute, &titleRef) ==
                kAXErrorSuccess &&
            titleRef) {
          if (CFGetTypeID(titleRef) == CFStringGetTypeID()) {
            title = [(__bridge NSString *)titleRef copy];
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

Napi::Value GetSelectedText(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  @autoreleasepool {
    NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
    NSString *original = [pasteboard stringForType:NSPasteboardTypeString];
    NSString *originalString = original ? [original copy] : nil;

    postCmdC();
    usleep(200000);

    NSString *copied = [pasteboard stringForType:NSPasteboardTypeString];
    std::string originalOut = originalString ? [originalString UTF8String] : "";
    std::string copiedOut = copied ? [copied UTF8String] : "";
    bool hasSelection = copied && [copied length] > 0;

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

// ===== Push-to-talk hotkey (selectively consuming event tap) =====
static std::atomic<bool> g_hotkeyActive(false);
static std::mutex g_tapMutex;
static CFMachPortRef g_eventTap = nullptr;
static CFRunLoopSourceRef g_runLoopSource = nullptr;
static CFRunLoopRef g_runLoop = nullptr;
static CGKeyCode g_targetKeyCode = (CGKeyCode)0;
static std::vector<NSEventModifierFlags> g_allowedModifierMasks;
static Napi::ThreadSafeFunction g_hotkeyCallback;

// PTT state tracking: session is active when combo was triggered
static std::atomic<bool> g_pttSessionActive(false);
// Track if the main key is currently physically pressed
static std::atomic<bool> g_mainKeyDown(false);
// Track the modifier flags that were active when session started
static std::atomic<NSEventModifierFlags> g_sessionModifiers(0);

static NSEventModifierFlags stripIrrelevantModifiers(NSEventModifierFlags flags) {
  const NSEventModifierFlags onlyRelevant = (NSEventModifierFlags)(
      NSEventModifierFlagCommand |
      NSEventModifierFlagControl |
      NSEventModifierFlagOption |
      NSEventModifierFlagShift);
  return (NSEventModifierFlags)(flags & onlyRelevant);
}

static bool modifiersMatch(CGEventRef event) {
  const NSEventModifierFlags flags = stripIrrelevantModifiers(
      (NSEventModifierFlags)CGEventGetFlags(event));

  if (g_allowedModifierMasks.empty()) {
    return flags == 0;
  }

  for (const NSEventModifierFlags mask : g_allowedModifierMasks) {
    if (flags == stripIrrelevantModifiers(mask)) {
      return true;
    }
  }
  return false;
}

static void notifyJS(bool isDown) {
  if (g_hotkeyCallback) {
    bool *isDownPtr = new bool(isDown);
    napi_status s = g_hotkeyCallback.BlockingCall(isDownPtr, [](Napi::Env env, Napi::Function cb, bool *ptr) {
      Napi::Object evt = Napi::Object::New(env);
      evt.Set("type", *ptr ? Napi::String::New(env, "down") : Napi::String::New(env, "up"));
      cb.Call({ evt });
      delete ptr;
    });
    (void)s;
  }
}

static void startPttSession(NSEventModifierFlags modifiers) {
  if (g_pttSessionActive.load()) return;
  g_pttSessionActive.store(true);
  g_sessionModifiers.store(modifiers);
  NSLog(@"[mac_input] PTT session started (modifiers=0x%lx)", (unsigned long)modifiers);
  notifyJS(true);
}

static void endPttSession() {
  if (!g_pttSessionActive.load()) return;
  g_pttSessionActive.store(false);
  g_sessionModifiers.store(0);
  g_mainKeyDown.store(false);
  NSLog(@"[mac_input] PTT session ended");
  notifyJS(false);
}

// Check if ALL keys in the combo are released (both main key and all modifiers)
static bool allKeysReleased(NSEventModifierFlags currentModifiers) {
  // If main key is still down, not all released
  if (g_mainKeyDown.load()) return false;

  // Check if any of the session modifiers are still held
  NSEventModifierFlags sessionMods = g_sessionModifiers.load();
  NSEventModifierFlags stillHeld = stripIrrelevantModifiers(currentModifiers) & sessionMods;

  return stillHeld == 0;
}

static CGEventRef eventTapCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
  (void)proxy;
  (void)refcon;

  // Handle event tap being disabled by system - re-enable it for reliability
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (g_eventTap && g_hotkeyActive.load()) {
      CGEventTapEnable(g_eventTap, true);
      NSLog(@"[mac_input] Event tap re-enabled after system disabled it (type=%d)", (int)type);
    }
    return event;
  }

  if (!g_hotkeyActive.load()) return event;

  NSEventModifierFlags currentModifiers = stripIrrelevantModifiers(
      (NSEventModifierFlags)CGEventGetFlags(event));

  // Handle modifier flag changes
  if (type == kCGEventFlagsChanged) {
    // If session is active, check if all keys are now released
    if (g_pttSessionActive.load()) {
      if (allKeysReleased(currentModifiers)) {
        endPttSession();
      }
    }
    // Don't consume modifier events - let them pass through
    return event;
  }

  if (type != kCGEventKeyDown && type != kCGEventKeyUp) return event;

  CGKeyCode key = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);

  // Only care about our target key
  if (key != g_targetKeyCode) return event;

  if (type == kCGEventKeyDown) {
    // If session already active, consume repeat keydowns
    if (g_pttSessionActive.load()) {
      return nullptr;
    }

    // Check if modifiers match to start a new session
    if (!modifiersMatch(event)) {
      // Modifiers don't match - let the event through
      return event;
    }

    // Start PTT session - both key and modifiers are pressed
    g_mainKeyDown.store(true);
    startPttSession(currentModifiers);
    return nullptr; // Consume the keydown

  } else { // kCGEventKeyUp
    // Main key released
    g_mainKeyDown.store(false);

    // If session is active, check if all keys are now released
    if (g_pttSessionActive.load()) {
      if (allKeysReleased(currentModifiers)) {
        endPttSession();
      }
      // Always consume keyup during/after session to prevent typing
      return nullptr;
    }

    // No active session, let the event through
    return event;
  }
}

Napi::Value RegisterPushToTalkHotkey(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsNumber() || (!info[1].IsNumber() && !info[1].IsArray() && !info[1].IsUndefined() && !info[1].IsNull()) || !info[2].IsFunction()) {
    Napi::TypeError::New(env, "Expected (keyCode:number, modifiers:number|number[], callback:function)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::lock_guard<std::mutex> lock(g_tapMutex);

  // If already active, unregister first
  if (g_eventTap) {
    if (g_runLoop) CFRunLoopStop(g_runLoop);
    if (g_runLoopSource) { CFRelease(g_runLoopSource); g_runLoopSource = nullptr; }
    if (g_eventTap) { CFMachPortInvalidate(g_eventTap); CFRelease(g_eventTap); g_eventTap = nullptr; }
    g_hotkeyActive.store(false);
    g_pttSessionActive.store(false);
    g_mainKeyDown.store(false);
    g_sessionModifiers.store(0);
    if (g_hotkeyCallback) {
      g_hotkeyCallback.Release();
    }
  }

  g_targetKeyCode = (CGKeyCode)info[0].As<Napi::Number>().Uint32Value();
  g_allowedModifierMasks.clear();
  g_pttSessionActive.store(false);
  g_mainKeyDown.store(false);
  g_sessionModifiers.store(0);

  auto parseModifierMask = [](uint32_t value) {
    return stripIrrelevantModifiers((NSEventModifierFlags)value);
  };

  if (info[1].IsArray()) {
    Napi::Array maskArray = info[1].As<Napi::Array>();
    const uint32_t length = maskArray.Length();
    for (uint32_t i = 0; i < length; ++i) {
      Napi::Value entry = maskArray.Get(i);
      if (!entry.IsNumber()) {
        Napi::TypeError::New(env, "Expected modifiers to be a number or array of numbers")
            .ThrowAsJavaScriptException();
        return env.Undefined();
      }
      const NSEventModifierFlags mask = parseModifierMask(entry.As<Napi::Number>().Uint32Value());
      if (std::find(g_allowedModifierMasks.begin(), g_allowedModifierMasks.end(), mask) ==
          g_allowedModifierMasks.end()) {
        g_allowedModifierMasks.push_back(mask);
      }
    }
  } else if (info[1].IsNumber()) {
    const NSEventModifierFlags mask = parseModifierMask(
        info[1].As<Napi::Number>().Uint32Value());
    g_allowedModifierMasks.push_back(mask);
  } else if (info[1].IsUndefined() || info[1].IsNull()) {
    g_allowedModifierMasks.push_back((NSEventModifierFlags)0);
  } else {
    Napi::TypeError::New(env, "Expected modifiers to be a number or array of numbers")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (g_allowedModifierMasks.empty()) {
    g_allowedModifierMasks.push_back((NSEventModifierFlags)0);
  }

  Napi::Function cb = info[2].As<Napi::Function>();
  g_hotkeyCallback = Napi::ThreadSafeFunction::New(env, cb, "ptt_hotkey_cb", 0, 1);

  g_eventTap = CGEventTapCreate(kCGSessionEventTap,
                                kCGHeadInsertEventTap,
                                kCGEventTapOptionDefault,
                                CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) | CGEventMaskBit(kCGEventFlagsChanged),
                                eventTapCallback,
                                nullptr);
  if (!g_eventTap) {
    g_hotkeyCallback.Release();
    g_allowedModifierMasks.clear();
    Napi::Error::New(env, "Failed to create event tap").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_eventTap, 0);
  if (!g_runLoopSource) {
    CFMachPortInvalidate(g_eventTap); CFRelease(g_eventTap); g_eventTap = nullptr;
    g_hotkeyCallback.Release();
    g_allowedModifierMasks.clear();
    Napi::Error::New(env, "Failed to create run loop source").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_hotkeyActive.store(true);

  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    g_runLoop = CFRunLoopGetCurrent();
    if (g_runLoopSource) {
      CFRunLoopAddSource(g_runLoop, g_runLoopSource, kCFRunLoopCommonModes);
    }
    CFRunLoopRun();
    // Cleanup when stopped
    std::lock_guard<std::mutex> innerLock(g_tapMutex);
    if (g_runLoopSource) { CFRelease(g_runLoopSource); g_runLoopSource = nullptr; }
    if (g_eventTap) { CFMachPortInvalidate(g_eventTap); CFRelease(g_eventTap); g_eventTap = nullptr; }
    g_runLoop = nullptr;
    g_hotkeyActive.store(false);
  });

  return env.Undefined();
}

Napi::Value UnregisterPushToTalkHotkey(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(g_tapMutex);
  if (g_runLoop) {
    CFRunLoopStop(g_runLoop);
  }
  if (g_hotkeyCallback) {
    g_hotkeyCallback.Release();
  }
  g_allowedModifierMasks.clear();
  g_pttSessionActive.store(false);
  g_mainKeyDown.store(false);
  g_sessionModifiers.store(0);
  return env.Undefined();
}

Napi::Value GetKeyCode(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected key name string")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string keyName = info[0].As<Napi::String>().Utf8Value();
  std::transform(keyName.begin(), keyName.end(), keyName.begin(), ::toupper);

  CGKeyCode keyCode = 0;

  if (keyName.length() == 1) {
    char c = keyName[0];
    if (c >= 'A' && c <= 'Z') {
      const CGKeyCode letterCodes[] = {
        kVK_ANSI_A, kVK_ANSI_B, kVK_ANSI_C, kVK_ANSI_D, kVK_ANSI_E, kVK_ANSI_F,
        kVK_ANSI_G, kVK_ANSI_H, kVK_ANSI_I, kVK_ANSI_J, kVK_ANSI_K, kVK_ANSI_L,
        kVK_ANSI_M, kVK_ANSI_N, kVK_ANSI_O, kVK_ANSI_P, kVK_ANSI_Q, kVK_ANSI_R,
        kVK_ANSI_S, kVK_ANSI_T, kVK_ANSI_U, kVK_ANSI_V, kVK_ANSI_W, kVK_ANSI_X,
        kVK_ANSI_Y, kVK_ANSI_Z
      };
      keyCode = letterCodes[c - 'A'];
    } else if (c >= '0' && c <= '9') {
      const CGKeyCode digitCodes[] = {
        kVK_ANSI_0, kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4,
        kVK_ANSI_5, kVK_ANSI_6, kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9
      };
      keyCode = digitCodes[c - '0'];
    } else {
      switch (c) {
        case ' ': keyCode = kVK_Space; break;
        case '\t': keyCode = kVK_Tab; break;
        case '\r': case '\n': keyCode = kVK_Return; break;
        case '-': keyCode = kVK_ANSI_Minus; break;
        case '=': keyCode = kVK_ANSI_Equal; break;
        case '[': keyCode = kVK_ANSI_LeftBracket; break;
        case ']': keyCode = kVK_ANSI_RightBracket; break;
        case '\\': keyCode = kVK_ANSI_Backslash; break;
        case ';': keyCode = kVK_ANSI_Semicolon; break;
        case '\'': case '"': keyCode = kVK_ANSI_Quote; break;
        case ',': keyCode = kVK_ANSI_Comma; break;
        case '.': keyCode = kVK_ANSI_Period; break;
        case '/': keyCode = kVK_ANSI_Slash; break;
        case '`': keyCode = kVK_ANSI_Grave; break;
        default: return env.Null();
      }
    }
  } else {
    if (keyName == "SPACE" || keyName == "SPACEBAR") {
      keyCode = kVK_Space;
    } else if (keyName == "TAB") {
      keyCode = kVK_Tab;
    } else if (keyName == "RETURN" || keyName == "ENTER") {
      keyCode = kVK_Return;
    } else if (keyName == "ESCAPE" || keyName == "ESC") {
      keyCode = kVK_Escape;
    } else if (keyName == "BACKSPACE") {
      keyCode = kVK_Delete;
    } else if (keyName == "DELETE" || keyName == "FORWARDDELETE") {
      keyCode = kVK_ForwardDelete;
    } else if (keyName == "HOME") {
      keyCode = kVK_Home;
    } else if (keyName == "END") {
      keyCode = kVK_End;
    } else if (keyName == "PAGEUP") {
      keyCode = kVK_PageUp;
    } else if (keyName == "PAGEDOWN") {
      keyCode = kVK_PageDown;
    } else if (keyName == "UP") {
      keyCode = kVK_UpArrow;
    } else if (keyName == "DOWN") {
      keyCode = kVK_DownArrow;
    } else if (keyName == "LEFT") {
      keyCode = kVK_LeftArrow;
    } else if (keyName == "RIGHT") {
      keyCode = kVK_RightArrow;
    } else if (keyName == "CAPSLOCK") {
      keyCode = kVK_CapsLock;
    } else if (keyName.length() > 1 && keyName[0] == 'F') {
      try {
        int fn = std::stoi(keyName.substr(1));
        if (fn >= 1 && fn <= 20) {
          const CGKeyCode fKeys[] = {
            kVK_F1, kVK_F2, kVK_F3, kVK_F4, kVK_F5, kVK_F6, kVK_F7, kVK_F8,
            kVK_F9, kVK_F10, kVK_F11, kVK_F12, kVK_F13, kVK_F14, kVK_F15, kVK_F16,
            kVK_F17, kVK_F18, kVK_F19, kVK_F20
          };
          keyCode = fKeys[fn - 1];
        }
      } catch (...) {
        return env.Null();
      }
    } else {
      return env.Null();
    }
  }

  return Napi::Number::New(env, (uint32_t)keyCode);
}

Napi::Value GetModifierFlags(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);
  result.Set("shift", Napi::Number::New(env, (uint32_t)NSEventModifierFlagShift));
  result.Set("control", Napi::Number::New(env, (uint32_t)NSEventModifierFlagControl));
  result.Set("option", Napi::Number::New(env, (uint32_t)NSEventModifierFlagOption));
  result.Set("command", Napi::Number::New(env, (uint32_t)NSEventModifierFlagCommand));
  return result;
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "pasteCommandV"),
              Napi::Function::New(env, PasteCommandV));
  exports.Set(Napi::String::New(env, "copyToClipboard"),
              Napi::Function::New(env, CopyToClipboard));
  exports.Set(Napi::String::New(env, "getClipboardText"),
              Napi::Function::New(env, GetClipboardText));
  exports.Set(Napi::String::New(env, "checkPermissions"),
              Napi::Function::New(env, CheckPermissions));
  exports.Set(Napi::String::New(env, "checkPermissionsWithPrompt"),
              Napi::Function::New(env, CheckPermissionsWithPrompt));
  exports.Set(Napi::String::New(env, "injectText"),
              Napi::Function::New(env, InjectText));
  exports.Set(Napi::String::New(env, "getWindowAppDetails"),
              Napi::Function::New(env, GetWindowAppDetails));
  exports.Set(Napi::String::New(env, "getSelectedText"),
              Napi::Function::New(env, GetSelectedText));
  exports.Set(Napi::String::New(env, "registerPushToTalkHotkey"),
              Napi::Function::New(env, RegisterPushToTalkHotkey));
  exports.Set(Napi::String::New(env, "unregisterPushToTalkHotkey"),
              Napi::Function::New(env, UnregisterPushToTalkHotkey));
  exports.Set(Napi::String::New(env, "getKeyCode"),
              Napi::Function::New(env, GetKeyCode));
  exports.Set(Napi::String::New(env, "getModifierFlags"),
              Napi::Function::New(env, GetModifierFlags));
  return exports;
}

NODE_API_MODULE(mac_input, Init)
