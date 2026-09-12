#include "pipeline.h"

#include <algorithm>
#include <cstring>

#include <libyuv.h>

namespace omnicam {
namespace {

constexpr auto kStaleAfter = std::chrono::milliseconds(3000);

inline int evenDown(int v) { return v & ~1; }

struct I420View {
    uint8_t* y; int sy;
    uint8_t* u; int su;
    uint8_t* v; int sv;
    int w, h;
};

I420View viewOf(std::vector<uint8_t>& buf, int w, int h) {
    const int cw = (w + 1) / 2, ch = (h + 1) / 2;
    const size_t need = (size_t)w * h + (size_t)cw * ch * 2;
    if (buf.size() < need) buf.resize(need);
    I420View v;
    v.y = buf.data();               v.sy = w;
    v.u = v.y + (size_t)w * h;      v.su = cw;
    v.v = v.u + (size_t)cw * ch;    v.sv = cw;
    v.w = w; v.h = h;
    return v;
}

void fillI420Black(const I420View& v) {
    std::memset(v.y, 16, (size_t)v.sy * v.h);
    const int ch = (v.h + 1) / 2;
    std::memset(v.u, 128, (size_t)v.su * ch);
    std::memset(v.v, 128, (size_t)v.sv * ch);
}

// Converts any supported source into an I420 view of the same size.
bool toI420(const uint8_t* data, size_t size, const FrameInfo& in, const I420View& dst) {
    const int w = in.width, h = in.height;
    auto plane = [&](int i) -> const uint8_t* {
        return i < in.planeCount ? data + in.planes[i].offset : nullptr;
    };
    auto stride = [&](int i) -> int { return i < in.planeCount ? (int)in.planes[i].stride : 0; };
    auto within = [&](int i, int rows) {
        if (i >= in.planeCount) return false;
        return (size_t)in.planes[i].offset + (size_t)in.planes[i].stride * rows <= size;
    };
    const int ch = (h + 1) / 2;

    switch (in.format) {
    case PixelFormat::I420:
    case PixelFormat::I420A:
        if (!within(0, h) || !within(1, ch) || !within(2, ch)) return false;
        return libyuv::I420Copy(plane(0), stride(0), plane(1), stride(1), plane(2), stride(2),
                                dst.y, dst.sy, dst.u, dst.su, dst.v, dst.sv, w, h) == 0;
    case PixelFormat::NV12:
        if (!within(0, h) || !within(1, ch)) return false;
        return libyuv::NV12ToI420(plane(0), stride(0), plane(1), stride(1),
                                  dst.y, dst.sy, dst.u, dst.su, dst.v, dst.sv, w, h) == 0;
    case PixelFormat::RGBA:
    case PixelFormat::RGBX:
        // memory order R,G,B,A == libyuv "ABGR"
        if (!within(0, h)) return false;
        return libyuv::ABGRToI420(plane(0), stride(0), dst.y, dst.sy, dst.u, dst.su, dst.v, dst.sv, w, h) == 0;
    case PixelFormat::BGRA:
    case PixelFormat::BGRX:
        // memory order B,G,R,A == libyuv "ARGB"
        if (!within(0, h)) return false;
        return libyuv::ARGBToI420(plane(0), stride(0), dst.y, dst.sy, dst.u, dst.su, dst.v, dst.sv, w, h) == 0;
    }
    return false;
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
        placeholderSet_ = false; // re-rendered lazily from placeholderRgba_
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
    std::lock_guard<std::mutex> lock(mtx_);
    if (pending_.valid) dropped_++;
    pending_.data.assign(data, data + size);
    pending_.info = info;
    pending_.valid = true;
    usePlaceholder_ = false;
    lastPushAt_ = std::chrono::steady_clock::now();
}

void Pipeline::setPlaceholder(const uint8_t* rgba, int width, int height) {
    std::lock_guard<std::mutex> lock(mtx_);
    placeholderRaw_.data.assign(rgba, rgba + (size_t)width * height * 4);
    placeholderRaw_.info = FrameInfo{PixelFormat::RGBA, width, height, {{0, (uint32_t)width * 4}, {0, 0}, {0, 0}}, 1};
    placeholderRaw_.valid = true;
    placeholderSet_ = false; // worker re-converts on next use
}

void Pipeline::showPlaceholder() {
    std::lock_guard<std::mutex> lock(mtx_);
    usePlaceholder_ = true;
    pending_.valid = false;
}

void Pipeline::setHoldLastFrame(bool hold) {
    std::lock_guard<std::mutex> lock(mtx_);
    holdLastFrame_ = hold;
}

void Pipeline::setTransform(const Transform& t) {
    std::lock_guard<std::mutex> lock(mtx_);
    transform_ = t;
}

PipelineStats Pipeline::stats() {
    PipelineStats s;
    s.running = running_;
    s.width = width_; s.height = height_; s.fps = fps_;
    s.framesSent = sent_; s.framesRepeated = repeated_; s.framesDropped = dropped_;
    s.consumers = running_ ? device_->consumers() : 0;
    return s;
}

// --- worker --------------------------------------------------------------------------------

bool Pipeline::convert(const RawFrame& raw, const Transform& t, std::vector<uint8_t>& outBgr) {
    const FrameInfo& in = raw.info;
    if (in.width <= 0 || in.height <= 0) return false;

    I420View src = viewOf(i420_, in.width, in.height);
    if (!toI420(raw.data.data(), raw.data.size(), in, src)) return false;

    // Rotation (clockwise) — swaps dimensions for 90/270.
    I420View cur = src;
    if (t.rotation == 90 || t.rotation == 180 || t.rotation == 270) {
        const bool swap = t.rotation != 180;
        I420View dst = viewOf(rot_, swap ? cur.h : cur.w, swap ? cur.w : cur.h);
        const libyuv::RotationMode mode = t.rotation == 90 ? libyuv::kRotate90
                                        : t.rotation == 180 ? libyuv::kRotate180 : libyuv::kRotate270;
        if (libyuv::I420Rotate(cur.y, cur.sy, cur.u, cur.su, cur.v, cur.sv,
                               dst.y, dst.sy, dst.u, dst.su, dst.v, dst.sv, cur.w, cur.h, mode) != 0)
            return false;
        cur = dst;
    }
    if (t.mirror) {
        // Mirror into whichever scratch buffer is not currently `cur`.
        std::vector<uint8_t>& target = (cur.y == i420_.data()) ? rot_ : i420_;
        I420View dst = viewOf(target, cur.w, cur.h);
        if (libyuv::I420Mirror(cur.y, cur.sy, cur.u, cur.su, cur.v, cur.sv,
                               dst.y, dst.sy, dst.u, dst.su, dst.v, dst.sv, cur.w, cur.h) != 0)
            return false;
        cur = dst;
    }

    // Aspect-fit into the fixed output canvas (letterbox / pillarbox with black bars).
    I420View canvas = cur;
    if (cur.w != width_ || cur.h != height_) {
        canvas = viewOf(fit_, width_, height_);
        fillI420Black(canvas);
        const double scale = std::min((double)width_ / cur.w, (double)height_ / cur.h);
        const int dw = std::max(2, evenDown((int)(cur.w * scale + 0.5)));
        const int dh = std::max(2, evenDown((int)(cur.h * scale + 0.5)));
        const int x0 = evenDown((width_ - dw) / 2);
        const int y0 = evenDown((height_ - dh) / 2);
        uint8_t* dy = canvas.y + (size_t)y0 * canvas.sy + x0;
        uint8_t* du = canvas.u + (size_t)(y0 / 2) * canvas.su + x0 / 2;
        uint8_t* dv = canvas.v + (size_t)(y0 / 2) * canvas.sv + x0 / 2;
        if (libyuv::I420Scale(cur.y, cur.sy, cur.u, cur.su, cur.v, cur.sv, cur.w, cur.h,
                              dy, canvas.sy, du, canvas.su, dv, canvas.sv, dw, dh,
                              libyuv::kFilterBilinear) != 0)
            return false;
    }

    outBgr.resize((size_t)width_ * height_ * 3);
    // libyuv "RGB24" is B,G,R in memory — exactly what DirectShow RGB24 wants, top-down.
    return libyuv::I420ToRGB24(canvas.y, canvas.sy, canvas.u, canvas.su, canvas.v, canvas.sv,
                               outBgr.data(), width_ * 3, width_, height_) == 0;
}

void Pipeline::workerLoop() {
    using clock = std::chrono::steady_clock;
    const auto period = std::chrono::duration_cast<clock::duration>(std::chrono::duration<double>(1.0 / fps_));
    auto next = clock::now();
    RawFrame local;
    Transform transform;

    while (running_) {
        {
            std::unique_lock<std::mutex> lock(mtx_);
            if (cv_.wait_until(lock, next, [this] { return !running_.load(); })) break;

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
            showPlaceholderNow_ = usePlaceholder_;
        }

        if (local.valid) {
            if (convert(local, transform, out_)) {
                haveOut_ = true;
                sent_++;
            } else {
                dropped_++;
            }
            local.valid = false;
        } else {
            repeated_++;
        }

        const uint8_t* frame = nullptr;
        if (showPlaceholderNow_ || !haveOut_) {
            frame = placeholderSet_ ? placeholder_.data() : nullptr;
        }
        if (!frame) {
            if (!haveOut_) std::fill(out_.begin(), out_.end(), 0);
            frame = out_.data();
        }
        device_->sendFrame(frame);

        next += period;
        const auto now = clock::now();
        if (next < now - period) next = now; // fell behind: resync instead of bursting
    }
}

} // namespace omnicam
