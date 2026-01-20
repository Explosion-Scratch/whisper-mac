#include "audio_capture.h"
#include <iostream>
#include <cmath>

#define NUM_BUFFERS 3

Napi::Object AudioCapture::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "AudioCapture", {
        InstanceMethod("start", &AudioCapture::Start),
        InstanceMethod("stop", &AudioCapture::Stop),
        InstanceMethod("checkMicrophonePermission", &AudioCapture::CheckMicrophonePermission),
        InstanceMethod("requestMicrophonePermission", &AudioCapture::RequestMicrophonePermission),
        InstanceMethod("getAudioLevel", &AudioCapture::GetAudioLevel)
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("AudioCapture", func);
    return exports;
}

AudioCapture::AudioCapture(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<AudioCapture>(info), 
      m_queue(nullptr), 
      m_isRecording(false),
      m_sampleRate(16000.0),
      m_bufferSize(512),
      m_currentRms(0.0f) {
}

AudioCapture::~AudioCapture() {
    StopCaptureInternal();
}

void AudioCapture::InputCallback(void *inUserData,
                                 AudioQueueRef inAQ,
                                 AudioQueueBufferRef inBuffer,
                                 const AudioTimeStamp *inStartTime,
                                 UInt32 inNumberPacketDescriptions,
                                 const AudioStreamPacketDescription *inPacketDescs) {
    AudioCapture* capture = static_cast<AudioCapture*>(inUserData);
    if (!capture->m_isRecording) return;

    capture->HandleAudioInput(inBuffer);

    if (capture->m_isRecording) {
        AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, NULL);
    }
}

void AudioCapture::HandleAudioInput(AudioQueueBufferRef inBuffer) {
    // Basic RMS calculation and data copying
    // Assuming 16-bit PCM for input, we might want to convert to Float32 for JS
    // But AudioQueue config below sets it to what we want. 
    // Let's use LinearPCM 16-bit Integer for stability, converting to float here.

    int16_t *audioData = static_cast<int16_t*>(inBuffer->mAudioData);
    UInt32 byteCount = inBuffer->mAudioDataByteSize;
    UInt32 sampleCount = byteCount / sizeof(int16_t);

    if (sampleCount == 0) return;

    std::vector<float> floatData(sampleCount);
    float sumSq = 0.0f;

    for (UInt32 i = 0; i < sampleCount; ++i) {
        float val = static_cast<float>(audioData[i]) / 32768.0f;
        floatData[i] = val;
        sumSq += val * val;
    }

    float rms = std::sqrt(sumSq / sampleCount);
    m_currentRms.store(rms);

    // Send to JS
    if (m_tsfn) {
        auto callback = [floatData = std::move(floatData)](Napi::Env env, Napi::Function jsCallback) {
            Napi::Float32Array jsArray = Napi::Float32Array::New(env, floatData.size());
            memcpy(jsArray.Data(), floatData.data(), floatData.size() * sizeof(float));
            jsCallback.Call({jsArray});
        };
        m_tsfn.NonBlockingCall(callback);
    }
}

Napi::Value AudioCapture::Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (m_isRecording) {
        return Napi::Boolean::New(env, false);
    }

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Options object expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (info.Length() < 2 || !info[1].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object options = info[0].As<Napi::Object>();
    if (options.Has("sampleRate")) m_sampleRate = options.Get("sampleRate").As<Napi::Number>().DoubleValue();
    if (options.Has("bufferSize")) m_bufferSize = options.Get("bufferSize").As<Napi::Number>().Uint32Value();

    m_tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[1].As<Napi::Function>(),
        "AudioCaptureCallback",
        0,
        1
    );

    // Setup AudioQueue
    AudioStreamBasicDescription format;
    memset(&format, 0, sizeof(format));
    format.mSampleRate = m_sampleRate;
    format.mFormatID = kAudioFormatLinearPCM;
    format.mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked;
    format.mFramesPerPacket = 1;
    format.mChannelsPerFrame = 1; // Mono
    format.mBitsPerChannel = 16;
    format.mBytesPerPacket = 2;
    format.mBytesPerFrame = 2;

    OSStatus status = AudioQueueNewInput(&format, InputCallback, this, NULL, kCFRunLoopCommonModes, 0, &m_queue);
    
    if (status != noErr) {
        m_tsfn.Release();
        std::string errMsg = "Failed to create AudioQueue. OSStatus: " + std::to_string(status);
        if (status == 1836086396) errMsg += " (kAudioQueueErr_InvalidDevice)";
        if (status == 1718449215) errMsg += " (kAudioQueueErr_InvalidBuffer)";
        Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
        return env.Null();
    }

    UInt32 bufferByteSize = m_bufferSize * format.mBytesPerFrame;
    for (int i = 0; i < NUM_BUFFERS; ++i) {
        AudioQueueBufferRef buffer;
        OSStatus allocStatus = AudioQueueAllocateBuffer(m_queue, bufferByteSize, &buffer);
        if (allocStatus != noErr) {
            AudioQueueDispose(m_queue, true);
            m_queue = nullptr;
            m_tsfn.Release();
            Napi::Error::New(env, "Failed to allocate AudioQueue buffer. OSStatus: " + std::to_string(allocStatus)).ThrowAsJavaScriptException();
            return env.Null();
        }
        AudioQueueEnqueueBuffer(m_queue, buffer, 0, NULL);
    }

    status = AudioQueueStart(m_queue, NULL);
    if (status != noErr) {
        AudioQueueDispose(m_queue, true);
        m_queue = nullptr;
        m_tsfn.Release();
        std::string errMsg = "Failed to start AudioQueue. OSStatus: " + std::to_string(status);
        if (status == -50) errMsg += " (Permission Denied or Invalid Argument)";
        Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
        return env.Null();
    }

    m_isRecording = true;
    return Napi::Boolean::New(env, true);
}

Napi::Value AudioCapture::Stop(const Napi::CallbackInfo& info) {
    StopCaptureInternal();
    return Napi::Boolean::New(info.Env(), true);
}

void AudioCapture::StopCaptureInternal() {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_isRecording) return;
    
    m_isRecording = false;

    if (m_queue) {
        AudioQueueStop(m_queue, true);
        AudioQueueDispose(m_queue, true);
        m_queue = nullptr;
    }

    if (m_tsfn) {
        m_tsfn.Release();
    }
}

Napi::Value AudioCapture::GetAudioLevel(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), m_currentRms.load());
}

Napi::Value AudioCapture::CheckMicrophonePermission(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (@available(macOS 10.14, *)) {
        AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
        switch (status) {
            case AVAuthorizationStatusAuthorized:
                return Napi::String::New(env, "authorized");
            case AVAuthorizationStatusDenied:
                return Napi::String::New(env, "denied");
            case AVAuthorizationStatusRestricted:
                return Napi::String::New(env, "restricted");
            case AVAuthorizationStatusNotDetermined:
                return Napi::String::New(env, "not_determined");
            default:
                return Napi::String::New(env, "unknown");
        }
    }
    return Napi::String::New(env, "authorized"); // Pre-Mojave assumed authorized
}

Napi::Value AudioCapture::RequestMicrophonePermission(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    if (@available(macOS 10.14, *)) {
        AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
        if (status == AVAuthorizationStatusAuthorized) {
            deferred.Resolve(Napi::Boolean::New(env, true));
            return deferred.Promise();
        }
        if (status == AVAuthorizationStatusDenied || status == AVAuthorizationStatusRestricted) {
            deferred.Resolve(Napi::Boolean::New(env, false));
            return deferred.Promise();
        }

        auto tsfn = Napi::ThreadSafeFunction::New(
            env,
            Napi::Function::New(env, [](const Napi::CallbackInfo& info) {}),
            "RequestPermissionTSFN",
            0, 1
        );

        auto deferred_ptr = std::make_shared<Napi::Promise::Deferred>(deferred);

        [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
            tsfn.BlockingCall([granted, deferred_ptr](Napi::Env env, Napi::Function dummy) {
                deferred_ptr->Resolve(Napi::Boolean::New(env, granted));
            });
            tsfn.Release();
        }];
    } else {
        deferred.Resolve(Napi::Boolean::New(env, true));
    }

    return deferred.Promise();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return AudioCapture::Init(env, exports);
}

NODE_API_MODULE(audio_capture, Init)
