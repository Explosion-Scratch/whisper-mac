#include <napi.h>
#import <ApplicationServices/ApplicationServices.h>

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

Napi::Value PasteCommandV(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  postCmdV();
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "pasteCommandV"), Napi::Function::New(env, PasteCommandV));
  return exports;
}

}  // namespace

NODE_API_MODULE(mac_input, Init)


