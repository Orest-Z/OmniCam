// Linux backend: writes frames into the v4l2loopback device labelled "OmniCam" with write(), the
// module's simplest producer interface. Consumers (browsers, OBS, Zoom…) read it as a normal camera.

#include "ivcam.h"

#include <dirent.h>
#include <fcntl.h>
#include <linux/videodev2.h>
#include <pthread.h>
#include <sys/ioctl.h>
#include <sys/resource.h>
#include <sys/utsname.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <chrono>
#include <climits>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <set>
#include <string>
#include <system_error>
#include <thread>
#include <vector>

namespace omnicam {
namespace {

namespace fs = std::filesystem;

constexpr const char* kLabel = "OmniCam";
// v4l2loopback 0.13+ queues this event to its subscribers whenever a reader starts or stops
// streaming (count 0 or 1). It is defined in the module's source, not in an installed header, so it
// is spelled out here and the module tells us at runtime whether it knows it.
constexpr uint32_t kEventClientUsage = V4L2_EVENT_PRIVATE_START + 0x08E00000 + 1;
// Fallback when the event is missing (v4l2loopback 0.12, Ubuntu 24.04): count other processes that
// hold the device open, this often, on a thread of its own (a scan takes several milliseconds).
constexpr auto kProcScanEvery = std::chrono::seconds(1);

std::string trim(std::string s) {
    const auto first = s.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = s.find_last_not_of(" \t\r\n");
    return s.substr(first, last - first + 1);
}

std::string readLine(const fs::path& p) {
    std::ifstream f(p);
    std::string line;
    std::getline(f, line);
    return trim(line);
}

std::string kernelRelease() {
    utsname u{};
    return uname(&u) == 0 ? u.release : "";
}

struct VideoNode {
    std::string dev;   // /dev/videoN
    std::string label; // the card label (sysfs "name")
};

// Video devices created by v4l2loopback: their sysfs node carries the module's own attributes.
std::vector<VideoNode> loopbackNodes() {
    std::vector<VideoNode> nodes;
    std::error_code ec;
    for (const auto& e : fs::directory_iterator("/sys/class/video4linux", ec)) {
        const std::string name = e.path().filename().string();
        if (name.rfind("video", 0) != 0) continue;
        if (!fs::exists(e.path() / "max_openers", ec)) continue;
        nodes.push_back({"/dev/" + name, readLine(e.path() / "name")});
    }
    return nodes;
}

// Is a v4l2loopback module installed for the running kernel (any compression, or built in)?
bool moduleInstalled() {
    const fs::path dir = fs::path("/lib/modules") / kernelRelease();
    std::ifstream builtin(dir / "modules.builtin");
    for (std::string line; std::getline(builtin, line);) {
        if (line.find("/v4l2loopback.ko") != std::string::npos) return true;
    }
    std::error_code ec;
    for (fs::recursive_directory_iterator it(dir, fs::directory_options::skip_permission_denied, ec), end;
         !ec && it != end; it.increment(ec)) {
        if (it->path().filename().string().rfind("v4l2loopback.ko", 0) == 0) return true;
    }
    return false;
}

std::string errnoText(int err) { return std::strerror(err); }

// Processes other than this one with `dev` open. Other users' processes can't be inspected and are
// not counted.
int countOpeners(const std::string& dev) {
    std::error_code ec;
    const fs::path target = fs::canonical(dev, ec);
    if (ec) return 0;
    const std::string self = std::to_string(getpid());
    std::set<std::string> pids;
    DIR* proc = opendir("/proc");
    if (!proc) return 0;
    char link[PATH_MAX];
    while (dirent* p = readdir(proc)) {
        if (p->d_name[0] < '0' || p->d_name[0] > '9' || self == p->d_name) continue;
        const std::string fdDir = std::string("/proc/") + p->d_name + "/fd";
        DIR* fds = opendir(fdDir.c_str());
        if (!fds) continue;
        while (dirent* f = readdir(fds)) {
            if (f->d_name[0] == '.') continue;
            const ssize_t n = readlinkat(dirfd(fds), f->d_name, link, sizeof link - 1);
            if (n <= 0) continue;
            link[n] = '\0';
            if (target == link) {
                pids.insert(p->d_name);
                break;
            }
        }
        closedir(fds);
    }
    closedir(proc);
    return (int)pids.size();
}

std::string fourcc(uint32_t f) {
    std::string s;
    for (int i = 0; i < 4; i++) s += (char)((f >> (8 * i)) & 0xff);
    return trim(s);
}

class V4l2Backend final : public IVirtualCamera {
public:
    V4l2Backend() {
        const char* f = std::getenv("OMNICAM_V4L2_FORMAT");
        format_ = f && std::strcmp(f, "i420") == 0 ? OutputFormat::I420 : OutputFormat::YUYV;
    }
    ~V4l2Backend() override { stop(); }

    OutputFormat preferredFormat() const override { return format_; }

    bool start(int width, int height, int fps, std::string& error) override {
        stop();
        std::string dev;
        if (!locate(dev, error)) return false;

        fd_ = ::open(dev.c_str(), O_RDWR | O_NONBLOCK | O_CLOEXEC);
        if (fd_ < 0) {
            const int err = errno;
            if (err == EACCES || err == EPERM) error = "permission: cannot open " + dev + " (" + errnoText(err) + ")";
            else if (err == EBUSY) error = "busy: " + dev + " is open in too many programs";
            else error = "io: cannot open " + dev + " (" + errnoText(err) + ")";
            return false;
        }

        const uint32_t pixfmt = format_ == OutputFormat::I420 ? V4L2_PIX_FMT_YUV420 : V4L2_PIX_FMT_YUYV;
        v4l2_format fmt{};
        fmt.type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
        fmt.fmt.pix.width = (uint32_t)width;
        fmt.fmt.pix.height = (uint32_t)height;
        fmt.fmt.pix.pixelformat = pixfmt;
        fmt.fmt.pix.field = V4L2_FIELD_NONE;
        if (format_ == OutputFormat::I420) {
            fmt.fmt.pix.bytesperline = (uint32_t)width;
            fmt.fmt.pix.sizeimage = (uint32_t)(width * height + (width / 2) * (height / 2) * 2);
        } else {
            fmt.fmt.pix.bytesperline = (uint32_t)width * 2;
            fmt.fmt.pix.sizeimage = (uint32_t)(width * height * 2);
        }
        // What the pipeline produces: the source's YUV, read as BT.601 limited range (pipeline.cc).
        fmt.fmt.pix.colorspace = V4L2_COLORSPACE_SMPTE170M;
        fmt.fmt.pix.ycbcr_enc = V4L2_YCBCR_ENC_601;
        fmt.fmt.pix.quantization = V4L2_QUANTIZATION_LIM_RANGE;
        fmt.fmt.pix.xfer_func = V4L2_XFER_FUNC_709;
        const uint32_t wantSize = fmt.fmt.pix.sizeimage;
        const std::string want = fourcc(pixfmt) + " " + std::to_string(width) + "x" + std::to_string(height);

        if (ioctl(fd_, VIDIOC_S_FMT, &fmt) < 0) {
            const int err = errno;
            if (err == EBUSY) {
                error = "busy: " + dev + " is in use (another program is sending video to it, or an app "
                        "reading it blocks the change to " + want + "); close the apps using the camera";
            } else if (err == EINVAL) {
                error = "format: " + dev + " rejected " + want + " (" + errnoText(err) + ")";
            } else {
                error = "io: setting " + want + " on " + dev + " failed (" + errnoText(err) + ")";
            }
            stop();
            return false;
        }
        // While a reader holds the device, v4l2loopback keeps its current format and answers with
        // that instead of failing.
        if (fmt.fmt.pix.width != (uint32_t)width || fmt.fmt.pix.height != (uint32_t)height ||
            fmt.fmt.pix.pixelformat != pixfmt) {
            error = "busy: " + dev + " stays at " + fourcc(fmt.fmt.pix.pixelformat) + " " +
                    std::to_string(fmt.fmt.pix.width) + "x" + std::to_string(fmt.fmt.pix.height) +
                    " while an app is using it; close the apps using the camera to change the output size";
            stop();
            return false;
        }
        if (fmt.fmt.pix.sizeimage < wantSize) {
            error = "format: " + dev + " offers " + std::to_string(fmt.fmt.pix.sizeimage) +
                    " bytes per frame, " + want + " needs " + std::to_string(wantSize);
            stop();
            return false;
        }
        frameBytes_ = wantSize;

        v4l2_streamparm parm{};
        parm.type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
        parm.parm.output.timeperframe.numerator = 1;
        parm.parm.output.timeperframe.denominator = (uint32_t)fps;
        if (ioctl(fd_, VIDIOC_S_PARM, &parm) < 0) {
            error = "format: " + dev + " rejected " + std::to_string(fps) + " fps (" + errnoText(errno) + ")";
            stop();
            return false;
        }

        v4l2_event_subscription sub{};
        sub.type = kEventClientUsage;
        sub.flags = V4L2_EVENT_SUB_FL_SEND_INITIAL;
        useEvents_ = ioctl(fd_, VIDIOC_SUBSCRIBE_EVENT, &sub) == 0;
        streaming_ = false;
        if (!useEvents_) startScanner(dev);
        return true;
    }

    void stop() override {
        stopScanner();
        if (fd_ >= 0) ::close(fd_);
        fd_ = -1;
        useEvents_ = false;
    }

    void sendFrame(const uint8_t* frame) override {
        if (fd_ < 0) return;
        // A full frame or nothing: on an error or a short write the frame is dropped, the next one
        // comes within a frame period. v4l2loopback copies and returns, it does not wait for readers.
        (void)::write(fd_, frame, frameBytes_);
    }

    int consumers() override {
        if (fd_ < 0) return 0;
        if (useEvents_) {
            v4l2_event ev{};
            while (ioctl(fd_, VIDIOC_DQEVENT, &ev) == 0) {
                if (ev.type == kEventClientUsage) {
                    uint32_t count;
                    std::memcpy(&count, ev.u.data, sizeof count);
                    streaming_ = count > 0;
                }
            }
            // The event says whether anyone is reading, not how many.
            return streaming_ ? 1 : 0;
        }
        return openers_;
    }

    bool probe(const std::string& /*nativeDir*/, std::string& reason) override {
        std::string dev;
        return locate(dev, reason);
    }

private:
    // Finds the OmniCam device, or explains (with a C1 code) why there is none to use.
    bool locate(std::string& dev, std::string& reason) const {
        if (const char* forced = std::getenv("OMNICAM_V4L2_DEVICE"); forced && *forced) {
            dev = forced;
            if (access(dev.c_str(), F_OK) != 0) {
                reason = "no-device: OMNICAM_V4L2_DEVICE=" + dev + " does not exist";
                return false;
            }
        } else {
            std::error_code ec;
            if (!fs::exists("/sys/module/v4l2loopback", ec)) {
                if (!moduleInstalled()) {
                    reason = "no-module: no v4l2loopback module is installed for kernel " + kernelRelease();
                } else {
                    reason = "not-loaded: the v4l2loopback module is installed but not loaded";
                }
                return false;
            }
            std::string others;
            for (const auto& n : loopbackNodes()) {
                if (n.label == kLabel) {
                    dev = n.dev;
                    break;
                }
                others += (others.empty() ? "\"" : ", \"") + n.label + "\" (" + n.dev + ")";
            }
            if (dev.empty()) {
                reason = others.empty()
                    ? "no-device: v4l2loopback is loaded but has no devices"
                    : "no-device: v4l2loopback is loaded but no device is labelled \"OmniCam\"; found " + others;
                return false;
            }
        }
        if (access(dev.c_str(), R_OK | W_OK) != 0) {
            const int err = errno;
            reason = (err == EACCES || err == EPERM ? "permission: cannot open " : "io: cannot open ") + dev +
                     " (" + errnoText(err) + ")";
            return false;
        }
        return true;
    }

    void startScanner(const std::string& dev) {
        stopScanner();
        scanStop_ = false;
        openers_ = countOpeners(dev);
        scanner_ = std::thread([this, dev] {
            pthread_setname_np(pthread_self(), "omnicam-scan");
            (void)setpriority(PRIO_PROCESS, (id_t)gettid(), 10); // background work, never ahead of frames
            std::unique_lock<std::mutex> lock(scanMtx_);
            while (!scanCv_.wait_for(lock, kProcScanEvery, [this] { return scanStop_; })) {
                lock.unlock();
                openers_ = countOpeners(dev);
                lock.lock();
            }
        });
    }

    void stopScanner() {
        {
            std::lock_guard<std::mutex> lock(scanMtx_);
            scanStop_ = true;
        }
        scanCv_.notify_all();
        if (scanner_.joinable()) scanner_.join();
        openers_ = 0;
    }

    OutputFormat format_ = OutputFormat::YUYV;
    int fd_ = -1;
    size_t frameBytes_ = 0;
    bool useEvents_ = false;
    bool streaming_ = false;

    // /proc fallback
    std::thread scanner_;
    std::mutex scanMtx_;
    std::condition_variable scanCv_;
    bool scanStop_ = false;
    std::atomic<int> openers_{0};
};

} // namespace

std::unique_ptr<IVirtualCamera> createPlatformCamera() {
    return std::make_unique<V4l2Backend>();
}

} // namespace omnicam
