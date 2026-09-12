#pragma once

#include <cstdint>
#include <memory>
#include <string>

namespace omnicam {

// Platform-specific virtual camera device. Frames are BGR24, top-down, tightly packed
// (width * 3 bytes per row). One backend per OS:
//   Windows: softcam DirectShow filter (win_softcam.cc)
//   macOS:   CoreMediaIO camera extension  (later)
//   Linux:   v4l2loopback                  (later)
class IVirtualCamera {
public:
    virtual ~IVirtualCamera() = default;

    // Returns false and fills `error` if the device cannot be created (driver not
    // registered, another instance already running, ...).
    virtual bool start(int width, int height, int fps, std::string& error) = 0;
    virtual void stop() = 0;

    // Delivers one BGR24 frame of the size given to start(). Must not block for long.
    virtual void sendFrame(const uint8_t* bgr24) = 0;

    // Number of consumer applications currently reading the camera (0 or 1 for softcam).
    virtual int consumers() = 0;

    // Cheap pre-flight without creating a device: is the driver installed on this machine?
    virtual bool probe(const std::string& nativeDir, std::string& reason) = 0;
};

std::unique_ptr<IVirtualCamera> createPlatformCamera();

} // namespace omnicam
