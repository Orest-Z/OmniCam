cmake_minimum_required(VERSION 3.20)
project(omnicam_vcam LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Static CRT: the filter DLL is loaded into third-party processes (Discord, Zoom…) that may
# not have the VC++ redistributable, and the addon should not depend on it either.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

option(OMNICAM_BUILD_ADDON  "Build the N-API addon (needs cmake-js variables)" ON)
option(OMNICAM_BUILD_FILTER "Build the DirectShow filter DLL"                  ON)

set(SOFTCAM_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/softcam/src")
set(LIBYUV_DIR  "${CMAKE_CURRENT_SOURCE_DIR}/third_party/libyuv")

if(NOT EXISTS "${SOFTCAM_DIR}/softcamcore/SenderAPI.cpp" OR NOT EXISTS "${LIBYUV_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "Submodules missing. Run: git submodule update --init --recursive")
endif()

add_compile_definitions(WIN32 _WINDOWS _CRT_SECURE_NO_WARNINGS UNICODE _UNICODE NOMINMAX)

# --- softcam sender core (shared memory + watchdog), shm names patched to "OmniCam/*" ------
include(cmake/patch_softcam.cmake)
add_library(softcam_core STATIC
  "${SOFTCAM_DIR}/softcamcore/SenderAPI.cpp"
  "${SOFTCAM_FRAMEBUFFER_CPP}"
  "${SOFTCAM_DIR}/softcamcore/Misc.cpp"
  "${SOFTCAM_DIR}/softcamcore/Watchdog.cpp")
target_include_directories(softcam_core PUBLIC "${SOFTCAM_DIR}" "${SOFTCAM_DIR}/softcamcore")
target_link_libraries(softcam_core PUBLIC winmm)

# --- DirectShow filter DLL: omnicam_vcam.dll (x64 and x86 builds) ---------------------------
if(OMNICAM_BUILD_FILTER)
  file(GLOB BASECLASSES_SRC "${SOFTCAM_DIR}/baseclasses/*.cpp")
  add_library(softcam_baseclasses STATIC ${BASECLASSES_SRC})
  target_include_directories(softcam_baseclasses PUBLIC "${SOFTCAM_DIR}/baseclasses")
  target_compile_definitions(softcam_baseclasses PRIVATE _LIB)
  target_compile_options(softcam_baseclasses PRIVATE /w)

  add_library(omnicam_vcam_filter SHARED
    src/filter/omnicam_filter.cpp
    src/filter/omnicam_filter.def
    "${SOFTCAM_DIR}/softcamcore/DShowSoftcam.cpp")
  set_target_properties(omnicam_vcam_filter PROPERTIES OUTPUT_NAME "omnicam_vcam" PREFIX "")
  target_include_directories(omnicam_vcam_filter PRIVATE "${SOFTCAM_DIR}")
  target_link_libraries(omnicam_vcam_filter PRIVATE softcam_core softcam_baseclasses
    strmiids ole32 oleaut32 uuid advapi32 user32 gdi32 winmm)
endif()

# --- N-API addon: omnicam_vcam.node ---------------------------------------------------------
if(OMNICAM_BUILD_ADDON)
  set(LIBYUV_DISABLE_JPEG ON CACHE BOOL "" FORCE)
  set(UNIT_TEST OFF CACHE BOOL "" FORCE)
  add_subdirectory("${LIBYUV_DIR}" EXCLUDE_FROM_ALL)
  target_compile_options(yuv PRIVATE /w)

  add_library(omnicam_vcam SHARED
    src/addon.cc
    src/pipeline.cc
    src/backend/win_softcam.cc
    ${CMAKE_JS_SRC})
  set_target_properties(omnicam_vcam PROPERTIES PREFIX "" SUFFIX ".node")
  target_include_directories(omnicam_vcam PRIVATE
    ${CMAKE_JS_INC}
    "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/node-addon-api"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/node-addon-api"
    "${LIBYUV_DIR}/include")
  target_compile_definitions(omnicam_vcam PRIVATE NAPI_VERSION=8 NAPI_CPP_EXCEPTIONS NODE_ADDON_API_DISABLE_DEPRECATED)
  target_compile_options(omnicam_vcam PRIVATE /EHsc /W4)
  target_link_libraries(omnicam_vcam PRIVATE ${CMAKE_JS_LIB} softcam_core yuv advapi32)
endif()
