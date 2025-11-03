// N-API addon for macOS input, clipboard helpers, and push-to-talk hotkey support
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

struct AcceleratorSpec {
  CGKeyCode keyCode = 0;
  UInt32 modifiers = 0;
};

std::string Trim(const std::string &value) {
  size_t start = value.find_first_not_of(" \t\n\r");
  if (start == std::string::npos) return "";
  size_t end = value.find_last_not_of(" \t\n\r");
  return value.substr(start, end - start + 1);
}

std::string ToUpper(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
    return static_cast<char>(std::toupper(c));
  });
  return value;
}

std::vector<std::string> SplitTokens(const std::string &accelerator) {
  std::vector<std::string> tokens;
  std::string current;
  for (char ch : accelerator) {
    if (ch == '+') {
      std::string trimmed = Trim(current);
      if (!trimmed.empty()) tokens.push_back(trimmed);
      current.clear();
    } else {
      current.push_back(ch);
    }
  }
  std::string trimmed = Trim(current);
  if (!trimmed.empty()) tokens.push_back(trimmed);
  return tokens;
}

const std::unordered_map<std::string, CGKeyCode> &KeyCodeMap() {
  static const std::unordered_map<std::string, CGKeyCode> map = {
      {"A", kVK_ANSI_A},       {"B", kVK_ANSI_B},       {"C", kVK_ANSI_C},
      {"D", kVK_ANSI_D},       {"E", kVK_ANSI_E},       {"F", kVK_ANSI_F},
      {"G", kVK_ANSI_G},       {"H", kVK_ANSI_H},       {"I", kVK_ANSI_I},
      {"J", kVK_ANSI_J},       {"K", kVK_ANSI_K},       {"L", kVK_ANSI_L},
      {"M", kVK_ANSI_M},       {"N", kVK_ANSI_N},       {"O", kVK_ANSI_O},
      {"P", kVK_ANSI_P},       {"Q", kVK_ANSI_Q},       {"R", kVK_ANSI_R},
      {"S", kVK_ANSI_S},       {"T", kVK_ANSI_T},       {"U", kVK_ANSI_U},
      {"V", kVK_ANSI_V},       {"W", kVK_ANSI_W},       {"X", kVK_ANSI_X},
      {"Y", kVK_ANSI_Y},       {"Z", kVK_ANSI_Z},       {"0", kVK_ANSI_0},
      {"1", kVK_ANSI_1},       {"2", kVK_ANSI_2},       {"3", kVK_ANSI_3},
      {"4", kVK_ANSI_4},       {"5", kVK_ANSI_5},       {"6", kVK_ANSI_6},
      {"7", kVK_ANSI_7},       {"8", kVK_ANSI_8},       {"9", kVK_ANSI_9},
      {"SPACE", kVK_Space},    {"SPACEBAR", kVK_Space}, {"RETURN", kVK_Return},
      {"ENTER", kVK_Return},   {"ESC", kVK_Escape},     {"ESCAPE", kVK_Escape},
      {"TAB", kVK_Tab},        {"BACKSPACE", kVK_Delete},
      {"DELETE", kVK_ForwardDelete},                      {"FORWARDDELETE", kVK_ForwardDelete},
      {"HOME", kVK_Home},      {"END", kVK_End},        {"PAGEUP", kVK_PageUp},
      {"PAGEDOWN", kVK_PageDown},                        {"UP", kVK_UpArrow},
      {"DOWN", kVK_DownArrow}, {"LEFT", kVK_LeftArrow}, {"RIGHT", kVK_RightArrow},
      {"ARROWUP", kVK_UpArrow},                          {"ARROWDOWN", kVK_DownArrow},
      {"ARROWLEFT", kVK_LeftArrow},                      {"ARROWRIGHT", kVK_RightArrow},
      {"MINUS", kVK_ANSI_Minus},                          {"DASH", kVK_ANSI_Minus},
      {"EQUAL", kVK_ANSI_Equal},                          {"PLUS", kVK_ANSI_Equal},
      {"SEMICOLON", kVK_ANSI_Semicolon},
      {"QUOTE", kVK_ANSI_Quote},                          {"APOSTROPHE", kVK_ANSI_Quote},
      {"BACKQUOTE", kVK_ANSI_Grave},                      {"GRAVE", kVK_ANSI_Grave},
      {"TILDE", kVK_ANSI_Grave},                          {"SLASH", kVK_ANSI_Slash},
      {"BACKSLASH", kVK_ANSI_Backslash},                  {"COMMA", kVK_ANSI_Comma},
      {"PERIOD", kVK_ANSI_Period},                        {"DOT", kVK_ANSI_Period},
      {"BRACKETLEFT", kVK_ANSI_LeftBracket},              {"LEFTBRACKET", kVK_ANSI_LeftBracket},
      {"BRACKETRIGHT", kVK_ANSI_RightBracket},            {"RIGHTBRACKET", kVK_ANSI_RightBracket},
      {"CAPSLOCK", kVK_CapsLock},
      {"F1", kVK_F1},         {"F2", kVK_F2},           {"F3", kVK_F3},
      {"F4", kVK_F4},         {"F5", kVK_F5},           {"F6", kVK_F6},
      {"F7", kVK_F7},         {"F8", kVK_F8},           {"F9", kVK_F9},
      {"F10", kVK_F10},       {"F11", kVK_F11},         {"F12", kVK_F12},
      {"F13", kVK_F13},       {"F14", kVK_F14},         {"F15", kVK_F15},
      {"F16", kVK_F16},       {"F17", kVK_F17},         {"F18", kVK_F18},
      {"F19", kVK_F19},       {"F20", kVK_F20}};
  return map;
}

const std::unordered_map<std::string, UInt32> &ModifierMap() {
  static const std::unordered_map<std::string, UInt32> map = {
      {"CMD", cmdKey},                {"COMMAND", cmdKey},
      {"COMMANDORCONTROL", cmdKey},   {"CMDORCTRL", cmdKey},
      {"CMDORCONTROL", cmdKey},      {"CTRLORCMD", cmdKey},
      {"CONTROL", controlKey},        {"CTRL", controlKey},
      {"ALT", optionKey},             {"OPTION", optionKey},
      {"OPTIONORALT", optionKey},     {"ALTOPTION", optionKey},
      {"SHIFT", shiftKey},            {"SUPER", cmdKey},
      {"META", cmdKey}};
  return map;
}

bool ParseAccelerator(const std::string &accelerator, AcceleratorSpec *outSpec,
                      std::string *error) {
  if (!outSpec) {
    if (error) *error = "Internal error: spec pointer is null";
    return false;
  }
  if (accelerator.empty()) {
    if (error) *error = "Accelerator string is empty";
    return false;
  }

  const auto tokens = SplitTokens(accelerator);
  if (tokens.empty()) {
    if (error) *error = "Accelerator string is empty";
    return false;
  }

  UInt32 modifiers = 0;
  CGKeyCode keyCode = 0;
  bool keySet = false;
  const auto &keyCodes = KeyCodeMap();
  const auto &modifiersMap = ModifierMap();

  for (const auto &token : tokens) {
    if (token.empty()) continue;
    const std::string upper = ToUpper(token);

    auto modIt = modifiersMap.find(upper);
    if (modIt != modifiersMap.end()) {
      modifiers |= modIt->second;
      continue;
    }

    auto keyIt = keyCodes.find(upper);
    if (keyIt != keyCodes.end()) {
      if (keySet) {
        if (error) *error = "Accelerator must contain only one non-modifier key";
        return false;
      }
      keyCode = keyIt->second;
      keySet = true;
      continue;
    }

    if (upper.size() == 1) {
      auto singleIt = keyCodes.find(upper);
      if (singleIt != keyCodes.end()) {
        if (keySet) {
          if (error) *error = "Accelerator must contain only one non-modifier key";
          return false;
        }
        keyCode = singleIt->second;
        keySet = true;
        continue;
      }
    }

    if (error) {
      *error = "Unknown token \"" + token + "\" in accelerator";
    }
    return false;
  }

  if (!keySet) {
    if (error) *error = "Accelerator must include a non-modifier key";
    return false;
  }

  outSpec->keyCode = keyCode;
  outSpec->modifiers = modifiers;
  return true;
}

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

struct PushToTalkState {
  std::mutex mutex;
  EventHotKeyRef hotkeyRef = nullptr;
  EventHandlerRef handlerRef = nullptr;
  Napi::ThreadSafeFunction onPress;
  Napi::ThreadSafeFunction onRelease;
  bool hasPress = false;
  bool hasRelease = false;
  bool registered = false;
};

PushToTalkState gPushToTalkState;

OSStatus PushToTalkHotKeyHandler(EventHandlerCallRef /*callRef*/, EventRef event,
                                 void *userData) {
  auto *state = static_cast<PushToTalkState *>(userData);
  if (!state) return noErr;

  UInt32 eventClass = GetEventClass(event);
  UInt32 eventKind = GetEventKind(event);
  if (eventClass != kEventClassKeyboard) return noErr;

  Napi::ThreadSafeFunction callback;
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    if (!state->registered) return noErr;

    if (eventKind == kEventHotKeyPressed && state->hasPress) {
      callback = state->onPress;
    } else if (eventKind == kEventHotKeyReleased && state->hasRelease) {
      callback = state->onRelease;
    } else {
      return noErr;
    }
  }

  if (callback) {
    callback.BlockingCall([](Napi::Env env, Napi::Function jsCallback) {
      try {
        jsCallback.Call({});
      } catch (Napi::Error err) {
        err.SuppressDestruct();
      }
    });
  }
  return noErr;
}

void CleanupPushToTalkStateLocked(PushToTalkState &state) {
  if (state.hotkeyRef) {
    UnregisterEventHotKey(state.hotkeyRef);
    state.hotkeyRef = nullptr;
  }
  if (state.handlerRef) {
    RemoveEventHandler(state.handlerRef);
    state.handlerRef = nullptr;
  }
  if (state.hasPress) {
    state.onPress.Release();
    state.onPress = Napi::ThreadSafeFunction();
    state.hasPress = false;
  }
  if (state.hasRelease) {
    state.onRelease.Release();
    state.onRelease = Napi::ThreadSafeFunction();
    state.hasRelease = false;
  }
  state.registered = false;
}

Napi::Value RegisterPushToTalkHotkey(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsFunction() ||
      !info[2].IsFunction()) {
    Napi::TypeError::New(env,
                         "Expected accelerator string, press callback, and release callback")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string accelerator = info[0].As<Napi::String>().Utf8Value();
  AcceleratorSpec spec;
  std::string error;
  if (!ParseAccelerator(accelerator, &spec, &error)) {
    Napi::Error::New(env, error).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Function pressCallback = info[1].As<Napi::Function>();
  Napi::Function releaseCallback = info[2].As<Napi::Function>();

  Napi::ThreadSafeFunction pressTsfn = Napi::ThreadSafeFunction::New(
      env, pressCallback, "PushToTalkPress", 0, 1);
  Napi::ThreadSafeFunction releaseTsfn = Napi::ThreadSafeFunction::New(
      env, releaseCallback, "PushToTalkRelease", 0, 1);

  std::lock_guard<std::mutex> lock(gPushToTalkState.mutex);

  CleanupPushToTalkStateLocked(gPushToTalkState);

  EventTypeSpec eventTypes[2] = {{kEventClassKeyboard, kEventHotKeyPressed},
                                 {kEventClassKeyboard, kEventHotKeyReleased}};
  EventHandlerRef handlerRef = nullptr;
  OSStatus handlerStatus = InstallApplicationEventHandler(
      NewEventHandlerUPP(PushToTalkHotKeyHandler), 2, eventTypes,
      &gPushToTalkState, &handlerRef);
  if (handlerStatus != noErr) {
    pressTsfn.Release();
    releaseTsfn.Release();
    Napi::Error::New(env, "Failed to install push-to-talk event handler")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  EventHotKeyID hotkeyId;
  hotkeyId.signature = 'PTTK';
  hotkeyId.id = 1;

  EventHotKeyRef hotkeyRef = nullptr;
  OSStatus hotkeyStatus = RegisterEventHotKey(
      spec.keyCode, spec.modifiers, hotkeyId, GetApplicationEventTarget(), 0,
      &hotkeyRef);

  if (hotkeyStatus != noErr) {
    RemoveEventHandler(handlerRef);
    pressTsfn.Release();
    releaseTsfn.Release();
    Napi::Error::New(env, "Failed to register push-to-talk hotkey")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  gPushToTalkState.hotkeyRef = hotkeyRef;
  gPushToTalkState.handlerRef = handlerRef;
  gPushToTalkState.onPress = pressTsfn;
  gPushToTalkState.onRelease = releaseTsfn;
  gPushToTalkState.hasPress = true;
  gPushToTalkState.hasRelease = true;
  gPushToTalkState.registered = true;

  return Napi::Boolean::New(env, true);
}

Napi::Value UnregisterPushToTalkHotkey(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lock(gPushToTalkState.mutex);
  bool wasRegistered = gPushToTalkState.registered;
  CleanupPushToTalkStateLocked(gPushToTalkState);
  return Napi::Boolean::New(env, wasRegistered);
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
  return exports;
}

NODE_API_MODULE(mac_input, Init)
