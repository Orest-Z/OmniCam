// N-API surface of omnicam_vcam.node. Mirrors `VcamAddon` in apps/desktop/src/engine/vcam.ts.

#include <napi.h>

#include <cstring>
#include <memory>
#include <string>

#include "pipeline.h"

namespace {

using omnicam::FrameInfo;
using omnicam::Pipeline;
using omnicam::PixelFormat;
using omnicam::Transform;

std::unique_ptr<Pipeline> g_pipeline;

Pipeline& pipeline() {
    if (!g_pipeline) g_pipeline = std::make_unique<Pipeline>();
    return *g_pipeline;
}

bool parseFormat(const std::string& s, PixelFormat& out) {
    if (s == "I420")  { out = PixelFormat::I420;  return true; }
    if (s == "I420A") { out = PixelFormat::I420A; return true; }
    if (s == "NV12")  { out = PixelFormat::NV12;  return true; }
    if (s == "RGBA")  { out = PixelFormat::RGBA;  return true; }
    if (s == "BGRA")  { out = PixelFormat::BGRA;  return true; }
    if (s == "RGBX")  { out = PixelFormat::RGBX;  return true; }
    if (s == "BGRX")  { out = PixelFormat::BGRX;  return true; }
    return false;
}

// start({ width, height, fps, nativeDir })
Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) {
        throw Napi::TypeError::New(env, "start(options) expects an object");
    }
    Napi::Object o = info[0].As<Napi::Object>();
    const int width = o.Get("width").ToNumber().Int32Value();
    const int height = o.Get("height").ToNumber().Int32Value();
    const int fps = o.Get("fps").ToNumber().Int32Value();
    const std::string nativeDir = o.Has("nativeDir") ? o.Get("nativeDir").ToString().Utf8Value() : "";

    std::string error;
    if (!pipeline().start(width, height, fps, nativeDir, error)) {
        throw Napi::Error::New(env, error);
    }
    return env.Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
    if (g_pipeline) g_pipeline->stop();
    return info.Env().Undefined();
}

// pushFrame(Uint8Array, { format, width, height, layout: [{offset, stride}, ...] })
Napi::Value PushFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsObject()) {
        throw Napi::TypeError::New(env, "pushFrame(Uint8Array, info) expected");
    }
    Napi::Uint8Array data = info[0].As<Napi::Uint8Array>();
    Napi::Object o = info[1].As<Napi::Object>();

    FrameInfo fi{};
    if (!parseFormat(o.Get("format").ToString().Utf8Value(), fi.format)) {
        throw Napi::TypeError::New(env, "unsupported pixel format");
    }
    fi.width = o.Get("width").ToNumber().Int32Value();
    fi.height = o.Get("height").ToNumber().Int32Value();
    fi.matrix = o.Has("matrix") && o.Get("matrix").ToString().Utf8Value() == "bt709" ? omnicam::YuvMatrix::BT709 : omnicam::YuvMatrix::BT601;
    fi.fullRange = o.Has("fullRange") && o.Get("fullRange").ToBoolean().Value();
    Napi::Array layout = o.Get("layout").As<Napi::Array>();
    fi.planeCount = std::min<int>(3, (int)layout.Length());
    for (int i = 0; i < fi.planeCount; i++) {
        Napi::Object p = layout.Get(i).As<Napi::Object>();
        fi.planes[i].offset = p.Get("offset").ToNumber().Uint32Value();
        fi.planes[i].stride = p.Get("stride").ToNumber().Uint32Value();
    }
    pipeline().pushFrame(data.Data(), data.ByteLength(), fi);
    return env.Undefined();
}

// setPlaceholder(Uint8Array rgba, width, height)
Napi::Value SetPlaceholder(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsTypedArray()) {
        throw Napi::TypeError::New(env, "setPlaceholder(Uint8Array, width, height) expected");
    }
    Napi::Uint8Array data = info[0].As<Napi::Uint8Array>();
    const int width = info[1].ToNumber().Int32Value();
    const int height = info[2].ToNumber().Int32Value();
    if (width <= 0 || height <= 0 || data.ByteLength() < (size_t)width * height * 4) {
        throw Napi::RangeError::New(env, "placeholder buffer too small");
    }
    pipeline().setPlaceholder(data.Data(), width, height);
    return env.Undefined();
}

Napi::Value ShowPlaceholder(const Napi::CallbackInfo& info) {
    pipeline().showPlaceholder();
    return info.Env().Undefined();
}

Napi::Value SetHoldLastFrame(const Napi::CallbackInfo& info) {
    pipeline().setHoldLastFrame(info.Length() > 0 && info[0].ToBoolean().Value());
    return info.Env().Undefined();
}

// setTransform({ mirror, rotation })
Napi::Value SetTransform(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) {
        throw Napi::TypeError::New(env, "setTransform(options) expects an object");
    }
    Napi::Object o = info[0].As<Napi::Object>();
    Transform t;
    t.mirror = o.Has("mirror") && o.Get("mirror").ToBoolean().Value();
    t.rotation = o.Has("rotation") ? o.Get("rotation").ToNumber().Int32Value() : 0;
    t.rotation = ((t.rotation % 360) + 360) % 360;
    if (t.rotation % 90 != 0) throw Napi::RangeError::New(env, "rotation must be a multiple of 90");
    pipeline().setTransform(t);
    return env.Undefined();
}

// setPreview(enabled, maxWidth, intervalMs)
Napi::Value SetPreview(const Napi::CallbackInfo& info) {
    const bool enabled = info.Length() > 0 && info[0].ToBoolean().Value();
    const int maxWidth = info.Length() > 1 ? info[1].ToNumber().Int32Value() : 640;
    const int interval = info.Length() > 2 ? info[2].ToNumber().Int32Value() : 80;
    pipeline().setPreview(enabled, maxWidth, interval);
    return info.Env().Undefined();
}

// takePreview() -> { width, height, data: Uint8Array(RGBA) } | null
Napi::Value TakePreview(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::vector<uint8_t> rgba;
    int w = 0, h = 0;
    if (!pipeline().takePreview(rgba, w, h)) return env.Null();
    Napi::Object o = Napi::Object::New(env);
    o.Set("width", w);
    o.Set("height", h);
    o.Set("data", Napi::Buffer<uint8_t>::Copy(env, rgba.data(), rgba.size()));
    return o;
}

Napi::Value GetStats(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    omnicam::PipelineStats s = pipeline().stats();
    Napi::Object o = Napi::Object::New(env);
    o.Set("running", s.running);
    o.Set("width", s.width);
    o.Set("height", s.height);
    o.Set("fps", s.fps);
    o.Set("framesSent", Napi::Number::New(env, (double)s.framesSent));
    o.Set("framesRepeated", Napi::Number::New(env, (double)s.framesRepeated));
    o.Set("framesDropped", Napi::Number::New(env, (double)s.framesDropped));
    o.Set("consumers", s.consumers);
    o.Set("convertUs", Napi::Number::New(env, (double)s.convertUs));
    o.Set("convertN", Napi::Number::New(env, (double)s.convertN));
    return o;
}

// probe(nativeDir) -> { ok, reason? }
Napi::Value Probe(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const std::string nativeDir = info.Length() > 0 ? info[0].ToString().Utf8Value() : "";
    std::string reason;
    const bool ok = pipeline().probe(nativeDir, reason);
    Napi::Object o = Napi::Object::New(env);
    o.Set("ok", ok);
    if (!ok) o.Set("reason", reason);
    return o;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("start", Napi::Function::New(env, Start));
    exports.Set("stop", Napi::Function::New(env, Stop));
    exports.Set("pushFrame", Napi::Function::New(env, PushFrame));
    exports.Set("setPlaceholder", Napi::Function::New(env, SetPlaceholder));
    exports.Set("showPlaceholder", Napi::Function::New(env, ShowPlaceholder));
    exports.Set("setHoldLastFrame", Napi::Function::New(env, SetHoldLastFrame));
    exports.Set("setTransform", Napi::Function::New(env, SetTransform));
    exports.Set("setPreview", Napi::Function::New(env, SetPreview));
    exports.Set("takePreview", Napi::Function::New(env, TakePreview));
    exports.Set("getStats", Napi::Function::New(env, GetStats));
    exports.Set("probe", Napi::Function::New(env, Probe));
    // Make sure the worker thread is gone before the runtime tears down.
    env.AddCleanupHook([] { g_pipeline.reset(); });
    return exports;
}

} // namespace

NODE_API_MODULE(omnicam_vcam, Init)
