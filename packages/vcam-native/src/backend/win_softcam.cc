// Windows backend: softcam's sender core linked statically (shared memory + named mutex).
// The consumer side is omnicam_vcam.dll, the registered DirectShow filter.

#include "ivcam.h"

#include <windows.h>

#include <softcamcore/SenderAPI.h>

namespace omnicam {
namespace {

// Must match CLSID_OmniCamFilter in src/filter/omnicam_filter.cpp
constexpr const wchar_t* kFilterClsidKey = L"CLSID\\{CA6A1B07-46DA-4E87-8251-D2E37B3A85CF}\\InprocServer32";

class SoftcamBackend final : public IVirtualCamera {
public:
    ~SoftcamBackend() override { stop(); }

    bool start(int width, int height, int fps, std::string& error) override {
        stop();
        std::string reason;
        if (!probe("", reason)) {
            error = reason;
            return false;
        }
        // framerate 0 = "send immediately": the pipeline owns the clock.
        (void)fps;
        camera_ = softcam::sender::CreateCamera(width, height, 0.0f);
        if (!camera_) {
            error = "could not create the virtual camera (is another OmniCam instance running?)";
            return false;
        }
        return true;
    }

    void stop() override {
        if (camera_) {
            softcam::sender::DeleteCamera(camera_);
            camera_ = nullptr;
        }
    }

    void sendFrame(const uint8_t* bgr24) override {
        if (camera_) softcam::sender::SendFrame(camera_, bgr24);
    }

    int consumers() override {
        return camera_ && softcam::sender::IsConnected(camera_) ? 1 : 0;
    }

    bool probe(const std::string& /*nativeDir*/, std::string& reason) override {
        HKEY key = nullptr;
        LONG rc = RegOpenKeyExW(HKEY_CLASSES_ROOT, kFilterClsidKey, 0, KEY_READ | KEY_WOW64_64KEY, &key);
        if (rc != ERROR_SUCCESS) {
            reason = "OmniCam camera driver is not registered (run the installer, or regsvr32 omnicam_vcam.dll)";
            return false;
        }
        RegCloseKey(key);
        return true;
    }

private:
    softcam::sender::CameraHandle camera_ = nullptr;
};

} // namespace

std::unique_ptr<IVirtualCamera> createPlatformCamera() {
    return std::make_unique<SoftcamBackend>();
}

} // namespace omnicam
