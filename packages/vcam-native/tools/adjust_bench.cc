// What the picture adjustments cost per frame, against the conversion the camera does anyway.
// Mirrors Pipeline::convert for an I420 phone frame and YUYV output (Linux); Windows' BGR24 output
// costs more than YUYV, so the adjustment's share there is smaller still. Build after `npm run native:build`:
//   g++ -O3 -std=c++17 -Isrc -Ithird_party/libyuv/include tools/adjust_bench.cc build/third_party/libyuv/libyuv.a -o adjust_bench
#include <chrono>
#include <cstdio>
#include <vector>

#include <libyuv.h>

#include "adjust.h"

using namespace omnicam;
using clk = std::chrono::steady_clock;

struct Plane3 {
    std::vector<uint8_t> buf;
    int w, h;
    uint8_t* y() { return buf.data(); }
    uint8_t* u() { return buf.data() + (size_t)w * h; }
    uint8_t* v() { return u() + (size_t)(w / 2) * (h / 2); }
    Plane3(int w_, int h_) : buf((size_t)w_ * h_ * 3 / 2), w(w_), h(h_) {
        for (size_t i = 0; i < buf.size(); i++) buf[i] = (uint8_t)(i * 7 + (i >> 9)); // not flat
    }
};

static double perFrameMs(int frames, auto&& fn) {
    for (int i = 0; i < 10; i++) fn(); // warm caches and page in buffers
    const auto t0 = clk::now();
    for (int i = 0; i < frames; i++) fn();
    return std::chrono::duration<double, std::milli>(clk::now() - t0).count() / frames;
}

static void adjustInPlace(Plane3& p, const Adjust& a) {
    const AdjustCoef k(a);
    adjustPlanes(k, a, p.y(), p.w, p.u(), p.w / 2, p.v(), p.w / 2, p.w, p.h);
}

int main() {
    const Adjust adj{-30, 36, 68, 88};
    struct Case { const char* name; int sw, sh, ow, oh; } cases[] = {
        {"1080p phone -> 720p camera ", 1920, 1080, 1280, 720},
        {"1080p phone -> 1080p camera", 1920, 1080, 1920, 1080},
        {"4K phone    -> 1080p camera", 3840, 2160, 1920, 1080},
        {"4K phone    -> 4K camera   ", 3840, 2160, 3840, 2160},
        {"1080p phone -> 4K camera   ", 1920, 1080, 3840, 2160},
    };
    std::printf("%-30s %10s %10s %8s   (budget: 33.3 ms at 30 fps, 16.7 at 60)\n", "", "convert", "+adjust", "extra");
    for (const Case& c : cases) {
        Plane3 src(c.sw, c.sh), canvas(c.ow, c.oh);
        std::vector<uint8_t> yuyv((size_t)c.ow * c.oh * 2);
        const bool scale = c.sw != c.ow;
        auto convert = [&](bool adjust) {
            Plane3* cur = &src;
            if (scale) {
                libyuv::I420Scale(src.y(), c.sw, src.u(), c.sw / 2, src.v(), c.sw / 2, c.sw, c.sh,
                                  canvas.y(), c.ow, canvas.u(), c.ow / 2, canvas.v(), c.ow / 2, c.ow, c.oh,
                                  c.sw > c.ow ? libyuv::kFilterBox : libyuv::kFilterBilinear); // as the pipeline picks
                cur = &canvas;
                if (adjust) adjustInPlace(canvas, adj);
            } else if (adjust) {
                // Same size: the phone's frame is never written, so the adjustment reads it and writes the canvas.
                const AdjustCoef k(adj);
                adjustPlanes(k, adj, src.y(), c.sw, src.u(), c.sw / 2, src.v(), c.sw / 2, c.sw, c.sh,
                             canvas.y(), c.ow, canvas.u(), c.ow / 2, canvas.v(), c.ow / 2);
                cur = &canvas;
            }
            libyuv::I420ToYUY2(cur->y(), c.ow, cur->u(), c.ow / 2, cur->v(), c.ow / 2, yuyv.data(), c.ow * 2, c.ow, c.oh);
        };
        const int frames = c.ow > 2000 ? 100 : 300;
        const double base = perFrameMs(frames, [&] { convert(false); });
        const double with = perFrameMs(frames, [&] { convert(true); });
        std::printf("%-30s %8.2f ms %8.2f ms %6.2f ms\n", c.name, base, with, with - base);
    }
    return 0;
}
