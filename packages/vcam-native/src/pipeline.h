#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "backend/ivcam.h"

namespace omnicam {

enum class PixelFormat { I420, I420A, NV12, RGBA, BGRA, RGBX, BGRX };

struct PlaneLayout {
    uint32_t offset;
    uint32_t stride;
};

struct FrameInfo {
    PixelFormat format;
    int width;
    int height;
    PlaneLayout planes[3];
    int planeCount;
};

struct Transform {
    bool mirror = false;
    int rotation = 0; // 0, 90, 180, 270 (clockwise)
};

struct PipelineStats {
    bool running = false;
    int width = 0;
    int height = 0;
    int fps = 0;
    uint64_t framesSent = 0;
    uint64_t framesRepeated = 0;
    uint64_t framesDropped = 0;
    int consumers = 0;
};

// Owns the virtual camera clock. JS deposits raw frames whenever they arrive; a worker
// thread converts the newest one to BGR24 and sends it to the device at a fixed rate,
// repeating the last frame when the source stalls. Output size is fixed for the lifetime
// of start()/stop() — consumer apps negotiate a format once and hate changes.
class Pipeline {
public:
    Pipeline();
    ~Pipeline();

    bool start(int width, int height, int fps, const std::string& nativeDir, std::string& error);
    void stop();
    bool running() const { return running_.load(); }

    // Copies `data` (must be at least the bytes implied by `info`) into the pending slot.
    void pushFrame(const uint8_t* data, size_t size, const FrameInfo& info);

    // RGBA, tightly packed, any size (scaled to the output format).
    void setPlaceholder(const uint8_t* rgba, int width, int height);
    void showPlaceholder();
    void setHoldLastFrame(bool hold);
    void setTransform(const Transform& t);
    PipelineStats stats();
    bool probe(const std::string& nativeDir, std::string& reason);

private:
    struct RawFrame {
        std::vector<uint8_t> data;
        FrameInfo info{};
        bool valid = false;
    };

    void workerLoop();
    // Converts `raw` into `outBgr` (BGR24 at output size) honoring `t`. Returns false on error.
    bool convert(const RawFrame& raw, const Transform& t, std::vector<uint8_t>& outBgr);

    std::unique_ptr<IVirtualCamera> device_;
    std::thread worker_;
    std::atomic<bool> running_{false};

    std::mutex mtx_;
    std::condition_variable cv_;
    RawFrame pending_;                 // newest raw frame from JS (guarded by mtx_)
    RawFrame placeholderRaw_;          // RGBA as given by JS (guarded by mtx_)
    std::vector<uint8_t> placeholder_; // BGR24 at output size, worker-rendered (guarded by mtx_)
    bool placeholderSet_ = false;
    bool usePlaceholder_ = true;
    bool holdLastFrame_ = true;
    Transform transform_;

    // Worker-owned buffers
    std::vector<uint8_t> out_;   // BGR24 output
    std::vector<uint8_t> i420_;  // scratch: source as I420
    std::vector<uint8_t> rot_;   // scratch: rotated / mirrored I420
    std::vector<uint8_t> fit_;   // scratch: scaled into the output canvas (I420)
    bool haveOut_ = false;
    bool showPlaceholderNow_ = false;

    int width_ = 0, height_ = 0, fps_ = 0;
    std::chrono::steady_clock::time_point lastPushAt_{};
    std::atomic<uint64_t> sent_{0}, repeated_{0}, dropped_{0};
};

} // namespace omnicam
