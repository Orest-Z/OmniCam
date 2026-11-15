// Windows backend: writes frames into one camera's softcam frame buffer (shared memory + named
// mutex, named after the camera; see cmake/patch_softcam.cmake). The consumer side is
// omnicam_vcam.dll, the registered DirectShow filter. softcam's SenderAPI keeps one camera per
// process, so with up to four cameras in the addon the backend uses its FrameBuffer directly,
// exactly as SenderAPI does with a framerate of 0.

#include "ivcam.h"

#include <windows.h>

#include <optional>

#include "FrameBuffer.h" // the patched copy in the build tree

namespace omnicam {
namespace {

// Must match kCameras in src/filter/omnicam_filter.cpp.
struct Camera {
    const char* name;     // shared memory "<name>/SharedMemory", and what apps list
    const wchar_t* clsid;
};
constexpr Camera kCameras[kCameraCount] = {
    {"OmniCam",   L"{CA6A1B07-46DA-4E87-8251-D2E37B3A85CF}"},
    {"OmniCam 2", L"{33C613FC-37A2-4F6E-933B-D1BB4B4386EF}"},
    {"OmniCam 3", L"{FAC48438-03E0-46CE-9174-5214B85C2DF4}"},
    {"OmniCam 4", L"{ED0B7180-7513-443C-8296-6351B2917A9F}"},
};

bool keyExists(const std::wstring& path) {
    HKEY key = nullptr;
    if (RegOpenKeyExW(HKEY_CLASSES_ROOT, path.c_str(), 0, KEY_READ | KEY_WOW64_64KEY, &key) != ERROR_SUCCESS) return false;
    RegCloseKey(key);
    return true;
}

class SoftcamBackend final : public IVirtualCamera {
public:
    explicit SoftcamBackend(int index) : index_(index), camera_(kCameras[index]) {}
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
        softcam::FrameBuffer frames = softcam::FrameBuffer::create(width, height, 0.0f, camera_.name);
        if (!frames) {
            error = std::string("busy: could not create the virtual camera ") + camera_.name +
                    " (is another OmniCam instance running?)";
            return false;
        }
        frames_.emplace(frames);
        return true;
    }

    void stop() override {
        if (frames_) {
            frames_->deactivate();
            frames_.reset();
        }
    }

    void sendFrame(const uint8_t* frame) override {
        if (frames_) frames_->write(frame);
    }

    int consumers() override {
        return frames_ && frames_->connected() ? 1 : 0;
    }

    bool probe(const std::string& /*nativeDir*/, std::string& reason) override {
        // Camera 1 is listed by the installer, so its COM class is enough. Cameras 2–4 always have
        // theirs and are listed by "Extra cameras": look for their entry in the video input category.
        if (index_ == 0) {
            if (keyExists(std::wstring(L"CLSID\\") + camera_.clsid + L"\\InprocServer32")) return true;
            reason = "not-registered: OmniCam camera driver is not registered (run the installer, or regsvr32 omnicam_vcam.dll)";
            return false;
        }
        // {860BB310-…} is CLSID_VideoInputDeviceCategory, where apps look for cameras.
        if (keyExists(std::wstring(L"CLSID\\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\\Instance\\") + camera_.clsid)) return true;
        reason = std::string("not-registered: ") + camera_.name + " is not registered (turn on Extra cameras, or regsvr32 /n /i:extra omnicam_vcam.dll)";
        return false;
    }

private:
    const int index_;
    const Camera& camera_;
    std::optional<softcam::FrameBuffer> frames_;
};

} // namespace

std::unique_ptr<IVirtualCamera> createPlatformCamera(int index) {
    return std::make_unique<SoftcamBackend>(index);
}

} // namespace omnicam
