// vcam_selftest: drives the frame pipeline and the camera backend without Node or a phone. It
// pushes a moving I420 test pattern (colour bars, a sweeping white bar, a frame counter) at 30 fps
// and prints probe(), every change in the consumer count, and the pipeline's convert time.
//
// Build and run (Linux):
//   cmake -S packages/vcam-native -B packages/vcam-native/build-selftest -DCMAKE_BUILD_TYPE=Release
//         -DOMNICAM_BUILD_ADDON=OFF -DOMNICAM_BUILD_SELFTEST=ON          (one line)
//   cmake --build packages/vcam-native/build-selftest --target vcam_selftest
//   packages/vcam-native/build-selftest/vcam_selftest [seconds per size, default 10] [WxH ...]
// Sizes default to 1280x720 and 1920x1080. OMNICAM_V4L2_FORMAT=i420 and OMNICAM_V4L2_DEVICE
// work as they do in the app. Open the device in a viewer meanwhile to see consumers go up.

#include "pipeline.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using namespace omnicam;
using clock_type = std::chrono::steady_clock;

namespace {

// 75% colour bars in BT.601 limited range: white, yellow, cyan, green, magenta, red, blue.
constexpr uint8_t kBars[7][3] = {
    {180, 128, 128}, {162, 44, 142}, {131, 156, 44}, {112, 72, 58},
    {84, 184, 198},  {65, 100, 212}, {35, 212, 114},
};

void drawPattern(std::vector<uint8_t>& buf, int w, int h, int frame) {
    const int cw = w / 2, ch = h / 2;
    uint8_t* y = buf.data();
    uint8_t* u = y + (size_t)w * h;
    uint8_t* v = u + (size_t)cw * ch;
    const int barsH = h * 2 / 3;
    for (int row = 0; row < h; row++) {
        uint8_t* yr = y + (size_t)row * w;
        if (row < barsH) {
            for (int x = 0; x < w; x++) yr[x] = kBars[x * 7 / w][0];
        } else {
            // A luma ramp that scrolls left, so motion shows even where the bar is not.
            for (int x = 0; x < w; x++) yr[x] = (uint8_t)(16 + ((x + frame * 8) % w) * 219 / w);
        }
    }
    for (int row = 0; row < ch; row++) {
        uint8_t* ur = u + (size_t)row * cw;
        uint8_t* vr = v + (size_t)row * cw;
        for (int x = 0; x < cw; x++) {
            const bool bars = row * 2 < barsH;
            ur[x] = bars ? kBars[x * 2 * 7 / w][1] : 128;
            vr[x] = bars ? kBars[x * 2 * 7 / w][2] : 128;
        }
    }
    // White bar sweeping across the bars, one screen width every 2 s at 30 fps.
    const int barW = w / 32;
    const int bx = (frame * w / 60) % (w - barW);
    for (int row = 0; row < barsH; row++) std::memset(y + (size_t)row * w + bx, 235, barW);
    // Frame counter as 16 binary blocks in the top-left corner (white = 1).
    const int bs = (w / 80) & ~1;
    for (int bit = 0; bit < 16; bit++) {
        const uint8_t val = (frame >> (15 - bit)) & 1 ? 235 : 16;
        for (int row = 0; row < bs; row++) std::memset(y + (size_t)(bs + row) * w + bs * (bit + 1), val, bs);
        for (int row = 0; row < bs / 2; row++) {
            std::memset(u + (size_t)(bs / 2 + row) * cw + bs / 2 * (bit + 1), 128, bs / 2);
            std::memset(v + (size_t)(bs / 2 + row) * cw + bs / 2 * (bit + 1), 128, bs / 2);
        }
    }
}

bool runSize(Pipeline& p, int w, int h, int seconds) {
    std::string error;
    if (!p.start(w, h, 30, "", error)) {
        std::printf("start %dx%d failed: %s\n", w, h, error.c_str());
        return false;
    }
    std::printf("\n%dx%d @ 30 fps for %d s\n", w, h, seconds);
    std::vector<uint8_t> buf((size_t)w * h * 3 / 2);
    const FrameInfo info{PixelFormat::I420, w, h,
                         {{0, (uint32_t)w}, {(uint32_t)(w * h), (uint32_t)(w / 2)},
                          {(uint32_t)(w * h + (w / 2) * (h / 2)), (uint32_t)(w / 2)}}, 3};
    const auto period = std::chrono::microseconds(1000000 / 30);
    const auto t0 = clock_type::now();
    int consumers = -1;
    // The pipeline's convert counters run across restarts: measure from here.
    const PipelineStats base = p.stats();
    uint64_t usBefore = base.convertUs, nBefore = base.convertN;
    for (int frame = 0; frame < seconds * 30; frame++) {
        drawPattern(buf, w, h, frame);
        p.pushFrame(buf.data(), buf.size(), info);
        const PipelineStats s = p.stats();
        if (s.consumers != consumers) {
            const double t = std::chrono::duration<double>(clock_type::now() - t0).count();
            std::printf("  %6.2f s  consumers %d\n", t, s.consumers);
            consumers = s.consumers;
        }
        if (frame % 150 == 149 && s.convertN > nBefore) {
            std::printf("  %6.2f s  convert %.2f ms/frame over the last %llu frames\n",
                        std::chrono::duration<double>(clock_type::now() - t0).count(),
                        (double)(s.convertUs - usBefore) / 1000.0 / (double)(s.convertN - nBefore),
                        (unsigned long long)(s.convertN - nBefore));
            usBefore = s.convertUs;
            nBefore = s.convertN;
        }
        std::this_thread::sleep_until(t0 + period * (frame + 1));
    }
    const PipelineStats s = p.stats();
    const uint64_t n = s.convertN - base.convertN;
    std::printf("  sent %llu, repeated %llu, dropped %llu, converted %llu", (unsigned long long)s.framesSent,
                (unsigned long long)s.framesRepeated, (unsigned long long)s.framesDropped, (unsigned long long)n);
    if (n) std::printf(", convert %.2f ms/frame average", (double)(s.convertUs - base.convertUs) / 1000.0 / (double)n);
    std::printf("\n");
    p.stop();
    return true;
}

} // namespace

int main(int argc, char** argv) {
    int seconds = 10;
    std::vector<std::pair<int, int>> sizes;
    for (int i = 1; i < argc; i++) {
        int w, h;
        if (std::sscanf(argv[i], "%dx%d", &w, &h) == 2) sizes.emplace_back(w, h);
        else seconds = std::max(1, std::atoi(argv[i]));
    }
    if (sizes.empty()) sizes = {{1280, 720}, {1920, 1080}};

    const char* fmt = std::getenv("OMNICAM_V4L2_FORMAT");
    std::printf("output format: %s\n", fmt && std::strcmp(fmt, "i420") == 0 ? "I420" : "YUYV");
    Pipeline p;
    std::string reason;
    const bool ok = p.probe("", reason);
    std::printf("probe: %s%s\n", ok ? "ok" : "failed: ", ok ? "" : reason.c_str());
    if (!ok) return 1;
    for (const auto& [w, h] : sizes) {
        if (!runSize(p, w, h, seconds)) return 1;
    }
    return 0;
}
