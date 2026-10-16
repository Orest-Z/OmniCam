cmake_minimum_required(VERSION 3.20)
project(omnicam_vcam LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(OMNICAM_BUILD_ADDON "Build the N-API addon (needs cmake-js variables)" ON)
if(WIN32)
  option(OMNICAM_BUILD_FILTER "Build the DirectShow filter DLL"                ON)
else()
  option(OMNICAM_BUILD_FILTER "Build the DirectShow filter DLL (Windows only)" OFF)
  if(OMNICAM_BUILD_FILTER)
    message(FATAL_ERROR "OMNICAM_BUILD_FILTER: the DirectShow filter only builds on Windows")
  endif()
  # Pipeline + camera backend without Node, for testing the device by hand (tools/vcam_selftest.cc).
  option(OMNICAM_BUILD_SELFTEST "Build vcam_selftest (Linux only)" OFF)
endif()

set(SOFTCAM_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/softcam/src")
set(LIBYUV_DIR  "${CMAKE_CURRENT_SOURCE_DIR}/third_party/libyuv")

if(NOT EXISTS "${LIBYUV_DIR}/CMakeLists.txt" OR (WIN32 AND NOT EXISTS "${SOFTCAM_DIR}/softcamcore/SenderAPI.cpp"))
  message(FATAL_ERROR "Submodules missing. Run: git submodule update --init --recursive")
endif()

if(WIN32)
  # Static CRT: the filter DLL is loaded into third-party processes (Discord, Zoom…) that may
  # not have the VC++ redistributable, and the addon should not depend on it either.
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

  # --- Version resource: product name + version on every binary (required for code signing) ---
  set(OMNICAM_APP_PACKAGE "${CMAKE_CURRENT_SOURCE_DIR}/../../apps/desktop/package.json")
  file(READ "${OMNICAM_APP_PACKAGE}" OMNICAM_APP_PACKAGE_JSON)
  string(JSON OMNICAM_VERSION GET "${OMNICAM_APP_PACKAGE_JSON}" version)
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${OMNICAM_APP_PACKAGE}")
  if(NOT OMNICAM_VERSION MATCHES "^([0-9]+)\\.([0-9]+)\\.([0-9]+)")
    message(FATAL_ERROR "apps/desktop/package.json: version '${OMNICAM_VERSION}' is not x.y.z")
  endif()
  set(OMNICAM_VERSION_MAJOR ${CMAKE_MATCH_1})
  set(OMNICAM_VERSION_MINOR ${CMAKE_MATCH_2})
  set(OMNICAM_VERSION_PATCH ${CMAKE_MATCH_3})

  function(omnicam_version_resource target file_name description)
    set(OMNICAM_FILE_NAME "${file_name}")
    set(OMNICAM_FILE_DESCRIPTION "${description}")
    set(rc "${CMAKE_CURRENT_BINARY_DIR}/${target}_version.rc")
    configure_file("${CMAKE_CURRENT_SOURCE_DIR}/src/version.rc.in" "${rc}" @ONLY)
    target_sources(${target} PRIVATE "${rc}")
  endfunction()

  # No NOMINMAX here: the DirectShow base classes rely on the min/max macros.
  add_compile_definitions(WIN32 _WINDOWS _CRT_SECURE_NO_WARNINGS UNICODE _UNICODE)

  # --- softcam sender core (shared memory + watchdog), shm names patched to "OmniCam/*" ------
  include(cmake/patch_softcam.cmake)
  add_library(softcam_core STATIC
    "${SOFTCAM_DIR}/softcamcore/SenderAPI.cpp"
    "${SOFTCAM_FRAMEBUFFER_CPP}"
    "${SOFTCAM_DIR}/softcamcore/Misc.cpp"
    "${SOFTCAM_DIR}/softcamcore/Watchdog.cpp")
  target_include_directories(softcam_core PUBLIC "${SOFTCAM_DIR}" "${SOFTCAM_DIR}/softcamcore")
  target_link_libraries(softcam_core PUBLIC winmm)
else()
  # The addon exports only its N-API entry point; libyuv is linked in statically and stays private.
  set(CMAKE_POSITION_INDEPENDENT_CODE ON)
  set(CMAKE_C_VISIBILITY_PRESET hidden)
  set(CMAKE_CXX_VISIBILITY_PRESET hidden)
  set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
endif()

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
  omnicam_version_resource(omnicam_vcam_filter "omnicam_vcam.dll" "OmniCam virtual camera (DirectShow filter)")
  target_include_directories(omnicam_vcam_filter PRIVATE "${SOFTCAM_DIR}")
  target_link_libraries(omnicam_vcam_filter PRIVATE softcam_core softcam_baseclasses
    strmiids ole32 oleaut32 uuid advapi32 user32 gdi32 winmm)
endif()

# --- libyuv and the camera backend: shared by the addon and the self-test ------------------
if(OMNICAM_BUILD_ADDON OR OMNICAM_BUILD_SELFTEST)
  set(LIBYUV_DISABLE_JPEG ON CACHE BOOL "" FORCE)
  set(UNIT_TEST OFF CACHE BOOL "" FORCE)
  add_subdirectory("${LIBYUV_DIR}" EXCLUDE_FROM_ALL)
  if(NOT WIN32)
    target_compile_options(yuv_common_objects PRIVATE -w)
    find_package(Threads REQUIRED)
  endif()

  # The camera backend is chosen at build time, one per OS (see src/backend/ivcam.h).
  if(WIN32)
    set(OMNICAM_BACKEND src/backend/win_softcam.cc)
  elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    set(OMNICAM_BACKEND src/backend/linux_v4l2.cc)
  else()
    message(FATAL_ERROR "No virtual camera backend for ${CMAKE_SYSTEM_NAME}")
  endif()
endif()

# --- N-API addon: omnicam_vcam.node ---------------------------------------------------------
if(OMNICAM_BUILD_ADDON)
  add_library(omnicam_vcam SHARED
    src/addon.cc
    src/pipeline.cc
    ${OMNICAM_BACKEND}
    ${CMAKE_JS_SRC})
  set_target_properties(omnicam_vcam PROPERTIES PREFIX "" SUFFIX ".node")

  if(WIN32)
    target_compile_options(yuv PRIVATE /w)
    omnicam_version_resource(omnicam_vcam "omnicam_vcam.node" "OmniCam frame pipeline (Node addon)")
    target_include_directories(omnicam_vcam PRIVATE
      ${CMAKE_JS_INC}
      "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/node-addon-api"
      "${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/node-addon-api"
      "${LIBYUV_DIR}/include")
    target_compile_definitions(omnicam_vcam PRIVATE NOMINMAX _WIN32_WINNT=0x0A00 NAPI_VERSION=8 NAPI_CPP_EXCEPTIONS NODE_ADDON_API_DISABLE_DEPRECATED)
    target_compile_options(omnicam_vcam PRIVATE /EHsc /W4)
    target_link_libraries(omnicam_vcam PRIVATE ${CMAKE_JS_LIB} softcam_core yuv advapi32)
  else()
    # Headers we don't own are SYSTEM so -Wall -Wextra only looks at our code.
    target_include_directories(omnicam_vcam SYSTEM PRIVATE
      ${CMAKE_JS_INC}
      "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/node-addon-api"
      "${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/node-addon-api"
      "${LIBYUV_DIR}/include")
    target_compile_definitions(omnicam_vcam PRIVATE NAPI_VERSION=8 NAPI_CPP_EXCEPTIONS NODE_ADDON_API_DISABLE_DEPRECATED)
    target_compile_options(omnicam_vcam PRIVATE -Wall -Wextra)
    target_link_libraries(omnicam_vcam PRIVATE ${CMAKE_JS_LIB} yuv Threads::Threads)
  endif()
endif()

# --- vcam_selftest: pushes a test pattern into the camera device ---------------------------
if(OMNICAM_BUILD_SELFTEST)
  add_executable(vcam_selftest tools/vcam_selftest.cc src/pipeline.cc ${OMNICAM_BACKEND})
  target_include_directories(vcam_selftest PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
  target_include_directories(vcam_selftest SYSTEM PRIVATE "${LIBYUV_DIR}/include")
  target_compile_options(vcam_selftest PRIVATE -Wall -Wextra)
  target_link_libraries(vcam_selftest PRIVATE yuv Threads::Threads)
endif()
