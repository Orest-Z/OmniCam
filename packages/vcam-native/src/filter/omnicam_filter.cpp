// OmniCam DirectShow virtual camera — DLL entry points.
//
// This is the softcam filter (third_party/softcam/src/softcam/softcam.cpp) re-skinned with
// OmniCam's own friendly name and CLSID so that:
//   * consumer apps (Discord, Zoom, Chrome…) list the device as "OmniCam", and
//   * a stock "DirectShow Softcam" install on the same machine keeps working independently.
// The sender-side API (scCreateCamera & co.) is exported unchanged for tooling.

#include <softcam/softcam.h>

#include <olectl.h>
#include <initguid.h>

#include <softcamcore/DShowSoftcam.h>
#include <softcamcore/SenderAPI.h>

// {CA6A1B07-46DA-4E87-8251-D2E37B3A85CF}
DEFINE_GUID(CLSID_OmniCamFilter,
0xca6a1b07, 0x46da, 0x4e87, 0x82, 0x51, 0xd2, 0xe3, 0x7b, 0x3a, 0x85, 0xcf);

namespace {

const wchar_t FILTER_NAME[] = L"OmniCam";
const GUID &FILTER_CLASSID = CLSID_OmniCamFilter;

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

CUnknown * WINAPI CreateFilterInstance(LPUNKNOWN lpunk, HRESULT *phr)
{
    return softcam::Softcam::CreateInstance(lpunk, FILTER_CLASSID, phr);
}

} // namespace

CFactoryTemplate g_Templates[] =
{
    { FILTER_NAME, &FILTER_CLASSID, &CreateFilterInstance, NULL, nullptr }
};
int g_cTemplates = sizeof(g_Templates) / sizeof(g_Templates[0]);

STDAPI DllRegisterServer()
{
    HRESULT hr = AMovieDllRegisterServer2(TRUE);
    if (FAILED(hr)) return hr;
    hr = CoInitialize(nullptr);
    if (FAILED(hr)) return hr;
    do
    {
        IFilterMapper2 *pFM2 = nullptr;
        hr = CoCreateInstance(CLSID_FilterMapper2, nullptr, CLSCTX_INPROC_SERVER,
                              IID_IFilterMapper2, (void**)&pFM2);
        if (FAILED(hr)) break;
        pFM2->UnregisterFilter(&CLSID_VideoInputDeviceCategory, 0, FILTER_CLASSID);
        hr = pFM2->RegisterFilter(FILTER_CLASSID, FILTER_NAME, 0,
                                  &CLSID_VideoInputDeviceCategory, FILTER_NAME, &s_reg_filter2);
        pFM2->Release();
    } while (0);
    CoFreeUnusedLibraries();
    CoUninitialize();
    return hr;
}

STDAPI DllUnregisterServer()
{
    HRESULT hr = AMovieDllRegisterServer2(FALSE);
    if (FAILED(hr)) return hr;
    hr = CoInitialize(nullptr);
    if (FAILED(hr)) return hr;
    do
    {
        IFilterMapper2 *pFM2 = nullptr;
        hr = CoCreateInstance(CLSID_FilterMapper2, nullptr, CLSCTX_INPROC_SERVER,
                              IID_IFilterMapper2, (void**)&pFM2);
        if (FAILED(hr)) break;
        hr = pFM2->UnregisterFilter(&CLSID_VideoInputDeviceCategory, FILTER_NAME, FILTER_CLASSID);
        pFM2->Release();
    } while (0);
    CoFreeUnusedLibraries();
    CoUninitialize();
    return hr;
}

extern "C" BOOL WINAPI DllEntryPoint(HINSTANCE, ULONG, LPVOID);

BOOL APIENTRY DllMain(HANDLE hModule, DWORD dwReason, LPVOID lpReserved)
{
    return DllEntryPoint((HINSTANCE)hModule, dwReason, lpReserved);
}

// ---- Sender API re-export (same ABI as softcam) -------------------------------------------

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
