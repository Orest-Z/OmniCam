#include "pipeline.h"

#include <algorithm>
#include <cstring>

#include <libyuv.h>

#ifdef _WIN32
#include <windows.h>
#include <timeapi.h>
#endif

namespace omnicam {
namespace {

using clock = std::chrono::steady_clock;

constexpr auto kStaleAfter = std::chrono::milliseconds(3000);
// Keepalive cadence while nobody reads the camera: a newly opened app still gets a frame quickly.
constexpr auto kKeepaliveIdle = std::chrono::milliseconds(500);
constexpr auto kConsumerPoll = std::chrono::milliseconds(250);

inline int evenDown(int v) { return v & ~1; }

struct I420View {
    const uint8_t* y; int sy;
    const uint8_t* u; int su;
    const uint8_t* v; int sv;
    int w, h;
};
struct I420Buf {
    uint8_t* y; int sy;
    uint8_t* u; int su;
    uint8_t* v; int sv;
    int w, h;
    operator I420View() const { return {y, sy, u, su, v, sv, w, h}; }
};

I420Buf bufOf(std::vector<uint8_t>& buf, int w, int h) {
    const int cw = (w + 1) / 2, ch = (h + 1) / 2;
    const size_t need = (size_t)w * h + (size_t)cw * ch * 2;
    if (buf.size() < need) buf.resize(need);
    I420Buf b;
    b.y = buf.data();               b.sy = w;
    b.u = b.y + (size_t)w * h;      b.su = cw;
    b.v = b.u + (size_t)cw * ch;    b.sv = cw;
    b.w = w; b.h = h;
    return b;
}

void fillI420Black(const I420Buf& b) {
    std::memset(b.y, 16, (size_t)b.sy * b.h);
    const int ch = (b.h + 1) / 2;
    std::memset(b.u, 128, (size_t)b.su * ch);
    std::memset(b.v, 128, (size_t)b.sv * ch);
}

const struct libyuv::YuvConstants* constantsFor(const FrameInfo& in) {
    if (in.matrix == YuvMatrix::BT709) return in.fullRange ? &libyuv::kYuvF709Constants : &libyuv::kYuvH709Constants;
    return in.fullRange ? &libyuv::kYuvJPEGConstants : &libyuv::kYuvI601Constants;
}

bool planeWithin(const FrameInfo& in, size_t size, int i, int rows) {
    if (i >= in.planeCount) return false;
    return (size_t)in.planes[i].offset + (size_t)in.planes[i].stride * rows <= size;
}

} // namespace

Pipeline::Pipeline() : device_(createPlatformCamera()) {}

Pipeline::~Pipeline() { stop(); }

bool Pipeline::probe(const std::string& nativeDir, std::string& reason) {
    return device_->probe(nativeDir, reason);
}

bool Pipeline::start(int width, int height, int fps, const std::string& nativeDir, std::string& error) {
    stop();
    if (width <= 0 || height <= 0 || (width % 4) || (height % 4)) {
        error = "output size must be positive and a multiple of 4";
        return false;
    }
    if (fps < 1 || fps > 120) {
        error = "fps out of range";
        return false;
    }
    std::string reason;
    if (!device_->probe(nativeDir, reason)) {
        error = reason;
        return false;
    }
    if (!device_->start(width, height, fps, error)) return false;

    width_ = width; height_ = height; fps_ = fps;
    out_.assign((size_t)width * height * 3, 0);
    haveOut_ = false;
    {
        std::lock_guard<std::mutex> lock(mtx_);
        pending_.valid = false;
        usePlaceholder_ = true;
        placeholderSet_ = false; // re-rendered lazily from placeholderRaw_
    }
    sent_ = repeated_ = dropped_ = 0;
    running_ = true;
    worker_ = std::thread([this] { workerLoop(); });
    return true;
}

void Pipeline::stop() {
    if (!running_.exchange(false)) {
        device_->stop();
        return;
    }
    cv_.notify_all();
    if (worker_.joinable()) worker_.join();
    device_->stop();
}

void Pipeline::pushFrame(const uint8_t* data, size_t size, const FrameInfo& info) {
    {
        std::lock_guard<std::mutex> lock(mtx_);
        if (pending_.valid) dropped_++; // worker still busy with the previous one: newest wins
        pending_.data.assign(data, data + size);
        pending_.info = info;
        pending_.valid = true;
        usePlaceholder_ = false;
        lastPushAt_ = clock::now();
    }
    cv_.notify_one();
}

void Pipeline::setPlaceholder(const uint8_t* rgba, int width, int height) {
    {
        std::lock_guard<std::mutex> lock(mtx_);
        placeholderRaw_.data.assign(rgba, rgba + (size_t)width * height * 4);
        placeholderRaw_.info = FrameInfo{PixelFormat::RGBA, width, height, {{0, (uint32_t)width * 4}, {0, 0}, {0, 0}}, 1};
        placeholderRaw_.valid = true;
        placeholderSet_ = false; // worker re-converts on next use
    }
    cv_.notify_one();
}

void Pipeline::showPlaceholder() {
    {
        std::lock_guard<std::mutex> lock(mtx_);
        usePlaceholder_ = true;
        pending_.valid = false;
    }
    cv_.notify_one();
}

void Pipeline::setHoldLastFrame(bool hold) {
    std::lock_guard<std::mutex> lock(mtx_);
    holdLastFrame_ = hold;
}

void Pipeline::setTransform(const Transform& t) {
    std::lock_guard<std::mutex> lock(mtx_);
    transform_ = t;
}

void Pipeline::setPreview(bool enabled, int maxWidth, int intervalMs) {
    {
        std::lock_guard<std::mutex> lock(mtx_);
        previewEnabled_ = enabled;
        previewMaxW_ = std::max(64, maxWidth);
        previewInterval_ = std::chrono::milliseconds(std::max(16, intervalMs));
        if (!enabled) previewFresh_ = false;
    }
    cv_.notify_one();
}

bool Pipeline::takePreview(std::vector<uint8_t>& rgba, int& width, int& height) {
    std::lock_guard<std::mutex> lock(mtx_);
    if (!previewFresh_) return false;
    rgba = preview_;
    width = previewW_;
    height = previewH_;
    previewFresh_ = false;
    return true;
}

// out_ (BGR24 at output size) -> ARGB -> scaled -> RGBA (what ImageData wants).
void Pipeline::makePreview(const std::vector<uint8_t>& bgr) {
    int maxW;
    {
        std::lock_guard<std::mutex> lock(mtx_);
        if (!previewEnabled_) return;
        const auto now = clock::now();
        if (now - lastPreviewAt_ < previewInterval_) return;
        lastPreviewAt_ = now;
        maxW = previewMaxW_;
    }
    const double scale = std::min(1.0, (double)maxW / width_);
    const int pw = std::max(2, evenDown((int)(width_ * scale + 0.5)));
    const int ph = std::max(2, evenDown((int)(height_ * scale + 0.5)));
    argb_.resize((size_t)width_ * height_ * 4);
    argbScaled_.resize((size_t)pw * ph * 4);
    // libyuv "RGB24" == B,G,R memory (our out_), "ARGB" == B,G,R,A memory.
    if (libyuv::RGB24ToARGB(bgr.data(), width_ * 3, argb_.data(), width_ * 4, width_, height_) != 0) return;
    if (libyuv::ARGBScale(argb_.data(), width_ * 4, width_, height_, argbScaled_.data(), pw * 4, pw, ph, libyuv::kFilterBilinear) != 0) return;
    std::lock_guard<std::mutex> lock(mtx_);
    preview_.resize((size_t)pw * ph * 4);
    // ARGB (B,G,R,A) -> ABGR (R,G,B,A memory) == RGBA for ImageData.
    if (libyuv::ARGBToABGR(argbScaled_.data(), pw * 4, preview_.data(), pw * 4, pw, ph) != 0) return;
    previewW_ = pw;
    previewH_ = ph;
    previewFresh_ = true;
}

PipelineStats Pipeline::stats() {
    PipelineStats s;
    s.running = running_;
    s.width = width_; s.height = height_; s.fps = fps_;
    s.framesSent = sent_; s.framesRepeated = repeated_; s.framesDropped = dropped_;
    s.consumers = consumers_;
    s.convertUs = convertUs_;
    s.convertN = convertN_;
    return s;
}

// --- conversion --------------------------------------------------------------------------------

bool Pipeline::convert(const RawFrame& raw, const Transform& t, std::vector<uint8_t>& outBgr) {
    const FrameInfo& in = raw.info;
    const uint8_t* data = raw.data.data();
    const size_t size = raw.data.size();
    if (in.width <= 0 || in.height <= 0) return false;
    const int ch = (in.height + 1) / 2;
    const auto* yuv = constantsFor(in);
    outBgr.resize((size_t)width_ * height_ * 3);

    // Note: libyuv's NV12->RGB24 row functions have no SIMD implementation under MSVC x64 (10 ms per
    // 1080p frame, measured); NV12->I420 + I420->RGB24 do (about 1.5 ms). So NV12 takes the I420 route.

    // Generic path. I420 sources are viewed in place (no copy); others are converted once.
    I420View src{};
    switch (in.format) {
    case PixelFormat::I420:
    case PixelFormat::I420A:
        if (!planeWithin(in, size, 0, in.height) || !planeWithin(in, size, 1, ch) || !planeWithin(in, size, 2, ch)) return false;
        src = {data + in.planes[0].offset, (int)in.planes[0].stride,
               data + in.planes[1].offset, (int)in.planes[1].stride,
               data + in.planes[2].offset, (int)in.planes[2].stride, in.width, in.height};
        break;
    case PixelFormat::NV12: {
        if (!planeWithin(in, size, 0, in.height) || !planeWithin(in, size, 1, ch)) return false;
        I420Buf b = bufOf(i420_, in.width, in.height);
        if (libyuv::NV12ToI420(data + in.planes[0].offset, (int)in.planes[0].stride,
                               data + in.planes[1].offset, (int)in.planes[1].stride,
                               b.y, b.sy, b.u, b.su, b.v, b.sv, in.width, in.height) != 0) return false;
        src = b;
        break;
    }
    case PixelFormat::RGBA:
    case PixelFormat::RGBX: { // memory order R,G,B,A == libyuv "ABGR"
        if (!planeWithin(in, size, 0, in.height)) return false;
        I420Buf b = bufOf(i420_, in.width, in.height);
        if (libyuv::ABGRToI420(data + in.planes[0].offset, (int)in.planes[0].stride,
                               b.y, b.sy, b.u, b.su, b.v, b.sv, in.width, in.height) != 0) return false;
        src = b;
        break;
    }
    case PixelFormat::BGRA:
    case PixelFormat::BGRX: { // memory order B,G,R,A == libyuv "ARGB"
        if (!planeWithin(in, size, 0, in.height)) return false;
        I420Buf b = bufOf(i420_, in.width, in.height);
        if (libyuv::ARGBToI420(data + in.planes[0].offset, (int)in.planes[0].stride,
                               b.y, b.sy, b.u, b.su, b.v, b.sv, in.width, in.height) != 0) return false;
        src = b;
        break;
    }
    }

    // Rotation (clockwise) — swaps dimensions for 90/270.
    I420View cur = src;
    if (t.rotation == 90 || t.rotation == 180 || t.rotation == 270) {
        const bool swap = t.rotation != 180;
        I420Buf dst = bufOf(rot_, swap ? cur.h : cur.w, swap ? cur.w : cur.h);
        const libyuv::RotationMode mode = t.rotation == 90 ? libyuv::kRotate90
                                        : t.rotation == 180 ? libyuv::kRotate180 : libyuv::kRotate270;
        if (libyuv::I420Rotate(cur.y, cur.sy, cur.u, cur.su, cur.v, cur.sv,
                               dst.y, dst.sy, dst.u, dst.su, dst.v, dst.sv, cur.w, cur.h, mode) != 0)
            return false;
        cur = dst;
    }
    if (t.mirror) {
        // Mirror into whichever scratch buffer `cur` does not live in.
        std::vector<uint8_t>& target = (cur.y == rot_.data()) ? i420_ : rot_;
        I420Buf dst = bufOf(target, cur.w, cur.h);
        if (libyuv::I420Mirror(cur.y, cur.sy, cur.u, cur.su, cur.v, cur.sv,
                               dst.y, dst.sy, dst.u, dst.su, dst.v, dst.sv, cur.w, cur.h) != 0)
            return false;
        cur = dst;
    }

    // Aspect-fit into the fixed output canvas (letterbox / pillarbox with black bars).
    I420View canvas = cur;
    if (cur.w != width_ || cur.h != height_) {
        I420Buf fit = bufOf(fit_, width_, height_);
        const double scale = std::min((double)width_ / cur.w, (double)height_ / cur.h);
        const int dw = std::max(2, evenDown((int)(cur.w * scale + 0.5)));
        const int dh = std::max(2, evenDown((int)(cur.h * scale + 0.5)));
        const int x0 = evenDown((width_ - dw) / 2);
        const int y0 = evenDown((height_ - dh) / 2);
        if (dw != width_ || dh != height_) fillI420Black(fit);
        uint8_t* dy = fit.y + (size_t)y0 * fit.sy + x0;
        uint8_t* du = fit.u + (size_t)(y0 / 2) * fit.su + x0 / 2;
        uint8_t* dv = fit.v + (size_t)(y0 / 2) * fit.sv + x0 / 2;
        // Box filter when shrinking (proper area averaging), bilinear when enlarging.
        const auto filter = cur.w > dw ? libyuv::kFilterBox : libyuv::kFilterBilinear;
        if (libyuv::I420Scale(cur.y, cur.sy, cur.u, cur.su, cur.v, cur.sv, cur.w, cur.h,
                              dy, fit.sy, du, fit.su, dv, fit.sv, dw, dh, filter) != 0)
            return false;
        canvas = fit;
    }

    // libyuv "RGB24" is B,G,R in memory — exactly what DirectShow RGB24 wants, top-down.
    return libyuv::I420ToRGB24Matrix(canvas.y, canvas.sy, canvas.u, canvas.su, canvas.v, canvas.sv,
                                     outBgr.data(), width_ * 3, yuv, width_, height_) == 0;
}

// --- worker ------------------------------------------------------------------------------------

void Pipeline::workerLoop() {
#ifdef _WIN32
    // 1 ms scheduler granularity for accurate keepalive timing; above-normal priority so frame
    // delivery does not hitch behind renderer work.
    timeBeginPeriod(1);
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
    SetThreadDescription(GetCurrentThread(), L"omnicam-vcam");
#endif
    const auto period = std::chrono::duration_cast<clock::duration>(std::chrono::duration<double>(1.0 / fps_));
    RawFrame local;
    Transform transform;
    auto lastSentAt = clock::now() - period;
    auto lastConsumerPoll = clock::time_point{};
    bool showPlaceholder = true;

    while (running_) {
        bool wantPreview;
        {
            std::lock_guard<std::mutex> lock(mtx_);
            wantPreview = previewEnabled_;
        }
        const bool active = consumers_ > 0;
        const auto keepalive = active ? period : kKeepaliveIdle;
        {
            std::unique_lock<std::mutex> lock(mtx_);
            // Wake on a new frame (event-driven, no pacing latency) or when the keepalive is due.
            cv_.wait_until(lock, lastSentAt + keepalive, [&] {
                return !running_ || pending_.valid || (!placeholderSet_ && placeholderRaw_.valid);
            });
            if (!running_) break;

            const auto now = clock::now();
            if (!holdLastFrame_ && haveOut_ && !pending_.valid && !usePlaceholder_ &&
                lastPushAt_ != clock::time_point{} && now - lastPushAt_ > kStaleAfter) {
                usePlaceholder_ = true;
            }
            if (pending_.valid) {
                std::swap(local.data, pending_.data);
                local.info = pending_.info;
                local.valid = true;
                pending_.valid = false;
            }
            transform = transform_;
            if (!placeholderSet_ && placeholderRaw_.valid) {
                // Placeholder is rendered untransformed: it is an on-screen message, not video.
                if (convert(placeholderRaw_, Transform{}, placeholder_)) placeholderSet_ = true;
            }
            showPlaceholder = usePlaceholder_;
        }

        auto now = clock::now();
        if (now - lastConsumerPoll > kConsumerPoll) {
            consumers_ = device_->consumers();
            lastConsumerPoll = now;
        }

        bool haveNew = false;
        if (local.valid) {
            if (consumers_ > 0 || wantPreview) {
                const auto c0 = clock::now();
                const bool ok = convert(local, transform, out_);
                convertUs_ += (uint64_t)std::chrono::duration_cast<std::chrono::microseconds>(clock::now() - c0).count();
                convertN_++;
                if (ok) {
                    haveOut_ = true;
                    haveNew = true;
                    sent_++;
                    if (wantPreview) makePreview(out_);
                } else {
                    dropped_++;
                }
            }
            // Nobody needs it: skip the conversion entirely.
            local.valid = false;
        }

        now = clock::now();
        const bool due = now - lastSentAt >= keepalive;
        if (haveNew || due) {
            const uint8_t* frame = nullptr;
            if (showPlaceholder || !haveOut_) frame = placeholderSet_ ? placeholder_.data() : nullptr;
            if (!frame) {
                if (!haveOut_) std::fill(out_.begin(), out_.end(), uint8_t{0});
                frame = out_.data();
            }
            if (!haveNew && consumers_ > 0) repeated_++;
            device_->sendFrame(frame);
            lastSentAt = now;
        }
    }
#ifdef _WIN32
    timeEndPeriod(1);
#endif
}

} // namespace omnicam
