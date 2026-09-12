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
enum class YuvMatrix { BT601, BT709 };

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
    YuvMatrix matrix = YuvMatrix::BT601;
    bool fullRange = false;
};

struct Transform {
    bool mirror = false;
    int rotation = 0; // 0, 90, 180, 270 (clockwise)
    bool fill = false; // crop to fill the output (webcam-like) instead of letterboxing
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
    uint64_t convertUs = 0;  // cumulative conversion time
    uint64_t convertN = 0;
};

/**
 * Owns the virtual camera output. Event-driven: a frame deposited by JS is converted and sent
 * immediately (no pacing latency); a keepalive re-sends the last frame only when the source stalls
 * so consumer apps never see a frozen "no signal". While no app reads the camera, nothing is
 * converted at all and the keepalive slows to a crawl.
 *
 * Output size/fps are fixed between start()/stop(): consumer apps negotiate a format once.
 */
class Pipeline {
public:
    Pipeline();
    ~Pipeline();

    bool start(int width, int height, int fps, const std::string& nativeDir, std::string& error);
    void stop();
    bool running() const { return running_.load(); }

    // Copies `data` (must cover the bytes implied by `info`) into the pending slot and wakes the worker.
    void pushFrame(const uint8_t* data, size_t size, const FrameInfo& info);

    // RGBA, tightly packed, any size (scaled to the output format).
    void setPlaceholder(const uint8_t* rgba, int width, int height);
    void showPlaceholder();
    void setHoldLastFrame(bool hold);
    void setTransform(const Transform& t);
    // Downscaled RGBA snapshots of the converted output for the desktop UI (no GPU involvement).
    void setPreview(bool enabled, int maxWidth, int intervalMs);
    // Copies the newest unread preview into `rgba`; false if nothing new since the last call.
    bool takePreview(std::vector<uint8_t>& rgba, int& width, int& height);
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
    void makePreview(const std::vector<uint8_t>& bgr);

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
    std::chrono::steady_clock::time_point lastPushAt_{};

    // Preview (guarded by mtx_ except the worker-owned scratch)
    bool previewEnabled_ = false;
    int previewMaxW_ = 640;
    std::chrono::milliseconds previewInterval_{80};
    std::vector<uint8_t> preview_;     // RGBA, previewW_ x previewH_
    int previewW_ = 0, previewH_ = 0;
    bool previewFresh_ = false;
    std::chrono::steady_clock::time_point lastPreviewAt_{};
    std::vector<uint8_t> argb_, argbScaled_; // worker scratch

    // Worker-owned buffers
    std::vector<uint8_t> out_;   // BGR24 output
    std::vector<uint8_t> i420_;  // scratch: source converted to I420 (only for RGB sources)
    std::vector<uint8_t> rot_;   // scratch: rotated / mirrored I420
    std::vector<uint8_t> fit_;   // scratch: scaled into the output canvas (I420)
    bool haveOut_ = false;

    int width_ = 0, height_ = 0, fps_ = 0;
    std::atomic<uint64_t> sent_{0}, repeated_{0}, dropped_{0};
    std::atomic<uint64_t> convertUs_{0}, convertN_{0};
    std::atomic<int> consumers_{0};
};

} // namespace omnicam
