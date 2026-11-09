// OmniCam DirectShow virtual cameras — DLL entry points.
//
// This is the softcam filter (third_party/softcam/src/softcam/softcam.cpp) re-skinned with
// OmniCam's own friendly names and CLSIDs so that:
//   * consumer apps (Discord, Zoom, Chrome…) list the devices as "OmniCam", "OmniCam 2"…, and
//   * a stock "DirectShow Softcam" install on the same machine keeps working independently.
// One DLL holds four cameras, each reading its own shared memory (cmake/patch_softcam.cmake):
//   regsvr32 omnicam_vcam.dll                  COM classes for all four; apps list only "OmniCam"
//   regsvr32 /n /i:extra omnicam_vcam.dll      apps also list "OmniCam 2", "OmniCam 3", "OmniCam 4"
//   regsvr32 /u /n /i:extra omnicam_vcam.dll   apps stop listing cameras 2–4
//   regsvr32 /u omnicam_vcam.dll               removes everything
// The sender-side API (scCreateCamera & co.) is exported unchanged for tooling; it drives camera 1.

#include <softcam/softcam.h>

#include <olectl.h>
#include <initguid.h>

#include <cwchar>

#include "DShowSoftcam.h" // the patched copy in the build tree
#include <softcamcore/SenderAPI.h>

// Fixed forever: apps remember cameras by these. Must match kCameras in src/backend/win_softcam.cc.
// {CA6A1B07-46DA-4E87-8251-D2E37B3A85CF}
DEFINE_GUID(CLSID_OmniCamFilter,
0xca6a1b07, 0x46da, 0x4e87, 0x82, 0x51, 0xd2, 0xe3, 0x7b, 0x3a, 0x85, 0xcf);
// {33C613FC-37A2-4F6E-933B-D1BB4B4386EF}
DEFINE_GUID(CLSID_OmniCamFilter2,
0x33c613fc, 0x37a2, 0x4f6e, 0x93, 0x3b, 0xd1, 0xbb, 0x4b, 0x43, 0x86, 0xef);
// {FAC48438-03E0-46CE-9174-5214B85C2DF4}
DEFINE_GUID(CLSID_OmniCamFilter3,
0xfac48438, 0x03e0, 0x46ce, 0x91, 0x74, 0x52, 0x14, 0xb8, 0x5c, 0x2d, 0xf4);
// {ED0B7180-7513-443C-8296-6351B2917A9F}
DEFINE_GUID(CLSID_OmniCamFilter4,
0xed0b7180, 0x7513, 0x443c, 0x82, 0x96, 0x63, 0x51, 0xb2, 0x91, 0x7a, 0x9f);

namespace {

struct Camera {
    const wchar_t* friendlyName; // what apps list
    const GUID* clsid;
    const char* name;            // its shared memory and mutex: "<name>/SharedMemory"
};

const Camera kCameras[] = {
    { L"OmniCam",   &CLSID_OmniCamFilter,  "OmniCam" },
    { L"OmniCam 2", &CLSID_OmniCamFilter2, "OmniCam 2" },
    { L"OmniCam 3", &CLSID_OmniCamFilter3, "OmniCam 3" },
    { L"OmniCam 4", &CLSID_OmniCamFilter4, "OmniCam 4" },
};
constexpr int kCameraCount = sizeof(kCameras) / sizeof(kCameras[0]);

const AMOVIESETUP_MEDIATYPE s_pin_types[] =
{
    { &MEDIATYPE_Video, &MEDIASUBTYPE_NULL }
};

const AMOVIESETUP_PIN s_pins[] =
{
    {
        const_cast<LPWSTR>(L"Output"),
        FALSE,          // rendered
        TRUE,           // output
        FALSE,          // can have none
        FALSE,          // can have many
        &CLSID_NULL,
        NULL,
        1,
        s_pin_types
    }
};

const REGFILTER2 s_reg_filter2 = { 1, MERIT_DO_NOT_USE, 1, s_pins };

template <int N>
CUnknown * WINAPI CreateFilterInstance(LPUNKNOWN lpunk, HRESULT *phr)
{
    return softcam::Softcam::CreateInstance(lpunk, *kCameras[N].clsid, phr);
}

// Camera 1 keeps the instance name OmniCam has always registered it under; cameras 2–4 use
// their CLSID (nullptr), the key Settings looks for: CLSID\{video input category}\Instance\{CLSID}.
const wchar_t* instanceName(int i)
{
    return i == 0 ? kCameras[0].friendlyName : nullptr;
}

// Adds (or removes) cameras [first, last) to the video input category apps list cameras from.
// Removing is best effort: a camera that isn't listed is already gone, and the next one must
// still be removed. Settings reads the registry afterwards, not this result.
HRESULT setListed(int first, int last, bool listed)
{
    HRESULT hr = CoInitialize(nullptr);
    if (FAILED(hr)) return hr;
    IFilterMapper2 *pFM2 = nullptr;
    hr = CoCreateInstance(CLSID_FilterMapper2, nullptr, CLSCTX_INPROC_SERVER,
                          IID_IFilterMapper2, (void**)&pFM2);
    for (int i = first; SUCCEEDED(hr) && i < last; i++)
    {
        const Camera& c = kCameras[i];
        if (listed)
        {
            pFM2->UnregisterFilter(&CLSID_VideoInputDeviceCategory, 0, *c.clsid);
            hr = pFM2->RegisterFilter(*c.clsid, c.friendlyName, 0,
                                      &CLSID_VideoInputDeviceCategory, instanceName(i), &s_reg_filter2);
        }
        else
        {
            pFM2->UnregisterFilter(&CLSID_VideoInputDeviceCategory, instanceName(i), *c.clsid);
        }
    }
    if (pFM2) pFM2->Release();
    CoFreeUnusedLibraries();
    CoUninitialize();
    return hr;
}

} // namespace

// Called by the patched softcam filter (DShowSoftcam.cpp) to pick the shared memory it reads.
const char* omnicam_camera_name(REFCLSID clsid)
{
    for (const Camera& c : kCameras)
    {
        if (IsEqualCLSID(clsid, *c.clsid)) return c.name;
    }
    return kCameras[0].name;
}

CFactoryTemplate g_Templates[] =
{
    { L"OmniCam",   &CLSID_OmniCamFilter,  &CreateFilterInstance<0>, NULL, nullptr },
    { L"OmniCam 2", &CLSID_OmniCamFilter2, &CreateFilterInstance<1>, NULL, nullptr },
    { L"OmniCam 3", &CLSID_OmniCamFilter3, &CreateFilterInstance<2>, NULL, nullptr },
    { L"OmniCam 4", &CLSID_OmniCamFilter4, &CreateFilterInstance<3>, NULL, nullptr },
};
int g_cTemplates = sizeof(g_Templates) / sizeof(g_Templates[0]);
static_assert(sizeof(g_Templates) / sizeof(g_Templates[0]) == kCameraCount, "one template per camera");

STDAPI DllRegisterServer()
{
    HRESULT hr = AMovieDllRegisterServer2(TRUE);
    if (FAILED(hr)) return hr;
    return setListed(0, 1, true);
}

STDAPI DllUnregisterServer()
{
    HRESULT hr = AMovieDllRegisterServer2(FALSE);
    if (FAILED(hr)) return hr;
    return setListed(0, kCameraCount, false);
}

// regsvr32 [/u] /n /i:extra — the "Extra cameras" switch in Settings.
STDAPI DllInstall(BOOL bInstall, LPCWSTR pszCmdLine)
{
    if (!pszCmdLine || std::wcscmp(pszCmdLine, L"extra") != 0) return E_INVALIDARG;
    if (!bInstall) return setListed(1, kCameraCount, false);
    // Their COM classes too, in case the DLL was never registered the usual way.
    HRESULT hr = AMovieDllRegisterServer2(TRUE);
    if (FAILED(hr)) return hr;
    return setListed(1, kCameraCount, true);
}

extern "C" BOOL WINAPI DllEntryPoint(HINSTANCE, ULONG, LPVOID);

BOOL APIENTRY DllMain(HANDLE hModule, DWORD dwReason, LPVOID lpReserved)
{
    return DllEntryPoint((HINSTANCE)hModule, dwReason, lpReserved);
}

// ---- Sender API re-export (same ABI as softcam; camera 1) ---------------------------------

extern "C" {

scCamera SOFTCAM_API scCreateCamera(int width, int height, float framerate)
{
    return softcam::sender::CreateCamera(width, height, framerate);
}

void SOFTCAM_API scDeleteCamera(scCamera camera)
{
    softcam::sender::DeleteCamera(camera);
}

void SOFTCAM_API scSendFrame(scCamera camera, const void* image_bits)
{
    softcam::sender::SendFrame(camera, image_bits);
}

bool SOFTCAM_API scWaitForConnection(scCamera camera, float timeout)
{
    return softcam::sender::WaitForConnection(camera, timeout);
}

bool SOFTCAM_API scIsConnected(scCamera camera)
{
    return softcam::sender::IsConnected(camera);
}

} // extern "C"
