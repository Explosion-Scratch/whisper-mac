#pragma once

#include <napi.h>
#include <AVFoundation/AVFoundation.h>
#include <AudioToolbox/AudioToolbox.h>
#include <vector>
#include <mutex>
#include <atomic>

class AudioCapture : public Napi::ObjectWrap<AudioCapture> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    AudioCapture(const Napi::CallbackInfo& info);
    ~AudioCapture();

    // Napi methods
    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    Napi::Value CheckMicrophonePermission(const Napi::CallbackInfo& info);
    Napi::Value RequestMicrophonePermission(const Napi::CallbackInfo& info);
    Napi::Value GetAudioLevel(const Napi::CallbackInfo& info);

private:
    // Audio processing
    static void InputCallback(void *inUserData,
                              AudioQueueRef inAQ,
                              AudioQueueBufferRef inBuffer,
                              const AudioTimeStamp *inStartTime,
                              UInt32 inNumberPacketDescriptions,
                              const AudioStreamPacketDescription *inPacketDescs);

    void HandleAudioInput(AudioQueueBufferRef inBuffer);
    void StopCaptureInternal();

    // State
    AudioQueueRef m_queue;
    bool m_isRecording;
    std::mutex m_mutex;
    
    // Callback to JS
    Napi::ThreadSafeFunction m_tsfn;
    
    // Config
    double m_sampleRate;
    uint32_t m_bufferSize; // Frames per buffer
    
    // Metering
    std::atomic<float> m_currentRms;
};
