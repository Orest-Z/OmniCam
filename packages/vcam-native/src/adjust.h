#pragma once

#include <cmath>
#include <cstdint>

// OMNICAM_ADJUST_SCALAR forces the plain loop, to test the path non-x86 builds take.
#if (defined(__SSE2__) || defined(_M_X64)) && !defined(OMNICAM_ADJUST_SCALAR)
#include <emmintrin.h>
#define OMNICAM_ADJUST_SSE2 1
#endif

namespace omnicam {

// Picture adjustments set in the desktop app, each -100..100; 0 leaves the picture as it is.
struct Adjust {
    int brightness = 0;
    int contrast = 0;
    int saturation = 0;
    int warmth = 0;
    bool touchesLuma() const { return brightness != 0 || contrast != 0; }
    bool touchesChroma() const { return saturation != 0 || warmth != 0; }
};

// Every adjustment is a straight line per sample, out = clamp((in * m + c) >> 6), applied to the YUV
// samples as they are (no RGB round trip). Contrast scales Y around mid-grey and brightness shifts it;
// saturation scales U and V around neutral, and warmth moves them towards orange (V up, U down) or blue.
// Fixed point in 16 bits, so SSE2 does 16 samples per step: every product and sum fits in an int16
// for inputs within -100..100 (worst case 255 * 128 = 32640, with a negative offset).
struct AdjustLine {
    int16_t m = 64; // gain, 64 = 1x
    int16_t c = 32; // offset * 64, with the rounding half added
};

struct AdjustCoef {
    AdjustLine y, u, v;

    explicit AdjustCoef(const Adjust& a) {
        const double contrast = 1.0 + a.contrast / 200.0;     // 0.5x .. 1.5x
        const double brightness = a.brightness * 0.64;        // ±64 levels
        const double saturation = 1.0 + a.saturation / 100.0; // 0 (grey) .. 2x
        const double warmth = a.warmth * 0.16;                // ±16 levels
        y = line(contrast, 128 - 128 * contrast + brightness);
        u = line(saturation, 128 - 128 * saturation - warmth);
        v = line(saturation, 128 - 128 * saturation + warmth);
    }

    static AdjustLine line(double gain, double offset) {
        return {(int16_t)std::lround(gain * 64), (int16_t)(std::lround(offset * 64) + 32)};
    }
};

inline uint8_t adjustSample(uint8_t s, AdjustLine l) {
    const int t = (int16_t)(s * l.m + l.c) >> 6;
    return (uint8_t)(t < 0 ? 0 : t > 255 ? 255 : t);
}

// Maps a w x h region of a plane, from `src` into `dst` (the same pointer for in place).
inline void adjustPlane(AdjustLine l, const uint8_t* src, int sstride, uint8_t* dst, int dstride, int w, int h) {
#ifdef OMNICAM_ADJUST_SSE2
    const __m128i zero = _mm_setzero_si128(), m = _mm_set1_epi16(l.m), c = _mm_set1_epi16(l.c);
#endif
    for (int row = 0; row < h; row++, src += sstride, dst += dstride) {
        int x = 0;
#ifdef OMNICAM_ADJUST_SSE2
        for (; x + 16 <= w; x += 16) {
            const __m128i px = _mm_loadu_si128(reinterpret_cast<const __m128i*>(src + x));
            const __m128i lo = _mm_srai_epi16(_mm_add_epi16(_mm_mullo_epi16(_mm_unpacklo_epi8(px, zero), m), c), 6);
            const __m128i hi = _mm_srai_epi16(_mm_add_epi16(_mm_mullo_epi16(_mm_unpackhi_epi8(px, zero), m), c), 6);
            _mm_storeu_si128(reinterpret_cast<__m128i*>(dst + x), _mm_packus_epi16(lo, hi)); // clamps to 0..255
        }
#endif
        for (; x < w; x++) dst[x] = adjustSample(src[x], l);
    }
}

// Adjusts a w x h I420 picture from the src planes into the dst planes. Into a different buffer every
// plane is written (an untouched one with gain 1, which is a copy), so the frame is read and written
// once; in place, untouched planes are skipped.
inline void adjustPlanes(const AdjustCoef& k, const Adjust& a,
                         const uint8_t* sy, int ssy, const uint8_t* su, int ssu, const uint8_t* sv, int ssv, int w, int h,
                         uint8_t* dy, int dsy, uint8_t* du, int dsu, uint8_t* dv, int dsv) {
    const bool inPlace = sy == dy;
    const int cw = (w + 1) / 2, ch = (h + 1) / 2;
    if (!inPlace || a.touchesLuma()) adjustPlane(k.y, sy, ssy, dy, dsy, w, h);
    if (!inPlace || a.touchesChroma()) {
        adjustPlane(k.u, su, ssu, du, dsu, cw, ch);
        adjustPlane(k.v, sv, ssv, dv, dsv, cw, ch);
    }
}

inline void adjustPlanes(const AdjustCoef& k, const Adjust& a, uint8_t* y, int sy, uint8_t* u, int su, uint8_t* v, int sv, int w, int h) {
    adjustPlanes(k, a, y, sy, u, su, v, sv, w, h, y, sy, u, su, v, sv);
}

} // namespace omnicam
