// Linux backend: writes frames into the v4l2loopback device labelled "OmniCam".
// Stub until the real backend lands: probe() and start() report that it is not built yet.

#include "ivcam.h"

namespace omnicam {
namespace {

constexpr const char* kNotBuilt = "not-loaded: Linux camera backend not built yet";

class V4l2Backend final : public IVirtualCamera {
public:
    OutputFormat preferredFormat() const override { return OutputFormat::YUYV; }

    bool start(int /*width*/, int /*height*/, int /*fps*/, std::string& error) override {
        error = kNotBuilt;
        return false;
    }

    void stop() override {}

    void sendFrame(const uint8_t* /*frame*/) override {}

    int consumers() override { return 0; }

    bool probe(const std::string& /*nativeDir*/, std::string& reason) override {
        reason = kNotBuilt;
        return false;
    }
};

} // namespace

std::unique_ptr<IVirtualCamera> createPlatformCamera() {
    return std::make_unique<V4l2Backend>();
}

} // namespace omnicam
