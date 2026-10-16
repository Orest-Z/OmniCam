#pragma once

#include <cstdint>
#include <memory>
#include <string>

namespace omnicam {

// Pixel layout a backend wants its frames in. Every format is top-down and tightly packed at the
// start() size:
//   BGR24: B,G,R bytes, width * 3 bytes per row (DirectShow RGB24)
//   I420:  Y plane, then U, then V, back to back (chroma planes (width/2) x (height/2))
//   YUYV:  Y0,U,Y1,V, width * 2 bytes per row (V4L2_PIX_FMT_YUYV, libyuv "YUY2")
enum class OutputFormat { BGR24, I420, YUYV };

// Platform-specific virtual camera device. One backend per OS, chosen at build time:
//   Windows: softcam DirectShow filter       (win_softcam.cc)
//   Linux:   v4l2loopback device "OmniCam"   (linux_v4l2.cc)
//   macOS:   CoreMediaIO camera extension    (later)
//
// Error strings (start() and probe()) begin with a code the UI maps to instructions:
// "<code>: <sentence for the log>", e.g. "not-registered: …", "busy: …", "not-loaded: …".
class IVirtualCamera {
public:
    virtual ~IVirtualCamera() = default;

    // Format sendFrame() receives. Fixed for the lifetime of the backend.
    virtual OutputFormat preferredFormat() const { return OutputFormat::BGR24; }

    // Returns false and fills `error` if the device cannot be created (driver not
    // registered, another instance already running, ...).
    virtual bool start(int width, int height, int fps, std::string& error) = 0;
    virtual void stop() = 0;

    // Delivers one frame in preferredFormat() at the size given to start(). Must not block for long.
    virtual void sendFrame(const uint8_t* frame) = 0;

    // Number of consumer applications currently reading the camera (0 or 1 for softcam).
    virtual int consumers() = 0;

    // Cheap pre-flight without creating a device: is the driver installed on this machine?
    virtual bool probe(const std::string& nativeDir, std::string& reason) = 0;
};

std::unique_ptr<IVirtualCamera> createPlatformCamera();

} // namespace omnicam
