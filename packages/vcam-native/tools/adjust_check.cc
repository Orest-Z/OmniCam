// Self-check for the picture adjustments (src/adjust.h). No Node, no camera:
//   g++ -O2 -std=c++17 -Isrc tools/adjust_check.cc -o adjust_check && ./adjust_check
// Add -DOMNICAM_ADJUST_SCALAR to check the plain (non-SIMD) loop.
#include <cassert>
#include <cstdio>
#include <vector>

#include "adjust.h"

using namespace omnicam;

// The same line in plain 32-bit maths: what the 16-bit SIMD path must match exactly.
static int reference(int s, AdjustLine l) {
    const int t = (s * l.m + l.c) >> 6;
    return t < 0 ? 0 : t > 255 ? 255 : t;
}

int main() {
    // All zero: every sample stays exactly as it was (the picture is untouched, bit for bit).
    const AdjustCoef same(Adjust{});
    for (int i = 0; i < 256; i++)
        assert(adjustSample(i, same.y) == i && adjustSample(i, same.u) == i && adjustSample(i, same.v) == i);

    // Brightness lifts luma and leaves colour alone; the ends clamp instead of wrapping around.
    const AdjustCoef bright(Adjust{100, 0, 0, 0});
    assert(adjustSample(100, bright.y) > 100 && adjustSample(255, bright.y) == 255 && adjustSample(77, bright.u) == 77);
    assert(adjustSample(0, AdjustCoef(Adjust{-100, 0, 0, 0}).y) == 0);

    // Contrast keeps mid-grey and spreads the rest.
    const AdjustCoef contrast(Adjust{0, 100, 0, 0});
    assert(adjustSample(128, contrast.y) == 128 && adjustSample(64, contrast.y) < 64 && adjustSample(192, contrast.y) > 192);

    // No saturation is grey: every U and V sample becomes neutral.
    const AdjustCoef grey(Adjust{0, 0, -100, 0});
    for (int i = 0; i < 256; i++) assert(adjustSample(i, grey.u) == 128 && adjustSample(i, grey.v) == 128);

    // Warmer: more red (V up), less blue (U down); cooler is the opposite.
    const AdjustCoef warm(Adjust{0, 0, 0, 100}), cool(Adjust{0, 0, 0, -100});
    assert(adjustSample(128, warm.v) > 128 && adjustSample(128, warm.u) < 128 && adjustSample(50, warm.y) == 50);
    assert(adjustSample(128, cool.v) < 128 && adjustSample(128, cool.u) > 128);

    // Every slider position, every sample value: the SIMD rows (and their scalar tails) match plain
    // maths, so no 16-bit sum overflows anywhere in the range. A row of 256 + 13 covers both paths.
    std::vector<uint8_t> row(256 + 13), out(row.size());
    for (size_t i = 0; i < row.size(); i++) row[i] = (uint8_t)(i * 251);
    long checked = 0;
    for (int b = -100; b <= 100; b += 10)
        for (int c = -100; c <= 100; c += 10)
            for (int s = -100; s <= 100; s += 10)
                for (int w = -100; w <= 100; w += 10) {
                    const AdjustCoef k(Adjust{b, c, s, w});
                    for (AdjustLine l : {k.y, k.u, k.v}) {
                        adjustPlane(l, row.data(), 0, out.data(), 0, (int)row.size(), 1);
                        for (size_t i = 0; i < row.size(); i++, checked++) assert(out[i] == reference(row[i], l));
                    }
                }

    // Only the region asked for changes (the picture, not the black bars around it).
    uint8_t plane[4 * 3] = {};
    adjustPlane(bright.y, plane + 4 + 1, 4, plane + 4 + 1, 4, 2, 1);
    assert(plane[5] == adjustSample(0, bright.y) && plane[6] == plane[5] && plane[4] == 0 && plane[7] == 0 && plane[0] == 0);

    // Into another buffer, untouched planes are copied exactly; in place they are not written at all.
    uint8_t y[32], u[16], v[16], dy[32], du[16], dv[16];
    for (int i = 0; i < 32; i++) y[i] = (uint8_t)(i * 9);
    for (int i = 0; i < 16; i++) u[i] = v[i] = (uint8_t)(i * 13);
    const Adjust lumaOnly{40, 0, 0, 0};
    adjustPlanes(AdjustCoef(lumaOnly), lumaOnly, y, 8, u, 4, v, 4, 8, 4, dy, 8, du, 4, dv, 4);
    for (int i = 0; i < 8; i++) assert(du[i] == u[i] && dv[i] == v[i]); // 8x4 picture: 4x2 colour samples

    std::printf("adjust_check: ok (%ld samples against the reference)\n", checked);
    return 0;
}
