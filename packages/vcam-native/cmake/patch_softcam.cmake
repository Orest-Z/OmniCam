# OmniCam has up to four cameras, each with its own shared memory and mutex named after it:
# "OmniCam/SharedMemory" (camera 1, the names OmniCam always used), "OmniCam 2/SharedMemory"…
# softcam hard-codes one pair of names, so at configure time (never touching the submodule) we copy
# the files that need a camera name into the build tree and patch them:
#   FrameBuffer.h/.cpp   create() and open() take the camera's name; it defaults to camera 1, so
#                        softcam's SenderAPI (the DLL's exported sc* API) stays camera 1
#   DShowSoftcam.cpp     each filter instance opens the camera its CLSID belongs to
#                        (omnicam_camera_name() in src/filter/omnicam_filter.cpp)
#   SenderAPI.cpp, DShowSoftcam.h   unchanged copies, so their #include "FrameBuffer.h" finds the patched header
# SOFTCAM_GEN_DIR goes first on the include path. A replacement that no longer matches (the
# submodule changed) stops configure instead of building a camera with the wrong names.

set(SOFTCAM_GEN_DIR "${CMAKE_BINARY_DIR}/gen")

# Replaces `from` with `to` in the variable `var`; stops unless `from` occurs exactly `count` times.
function(omnicam_replace var from to count)
  string(REPLACE "${from}" "" _rest "${${var}}")
  string(LENGTH "${${var}}" _all)
  string(LENGTH "${_rest}" _left)
  string(LENGTH "${from}" _one)
  math(EXPR _found "(${_all} - ${_left}) / ${_one}")
  if(NOT _found EQUAL ${count})
    message(FATAL_ERROR "patch_softcam: expected ${count} of '${from}', found ${_found}. Did the softcam submodule change?")
  endif()
  string(REPLACE "${from}" "${to}" _out "${${var}}")
  set(${var} "${_out}" PARENT_SCOPE)
endfunction()

file(READ "${SOFTCAM_DIR}/softcamcore/FrameBuffer.h" content)
omnicam_replace(content "float           framerate = 0.0f);"
                        "float           framerate = 0.0f, const char* camera = \"OmniCam\");" 1)
omnicam_replace(content "static FrameBuffer open();" "static FrameBuffer open(const char* camera = \"OmniCam\");" 1)
file(WRITE "${SOFTCAM_GEN_DIR}/FrameBuffer.h" "${content}")

file(READ "${SOFTCAM_DIR}/softcamcore/FrameBuffer.cpp" content)
omnicam_replace(content "#include <mutex> // lock_guard" "#include <mutex> // lock_guard\n#include <string>" 1)
omnicam_replace(content "const char NamedMutexName[] = \"DirectShow Softcam/NamedMutex\";"
                        "static std::string NamedMutexName(const char* camera) { return std::string(camera) + \"/NamedMutex\"; }" 1)
omnicam_replace(content "const char SharedMemoryName[] = \"DirectShow Softcam/SharedMemory\";"
                        "static std::string SharedMemoryName(const char* camera) { return std::string(camera) + \"/SharedMemory\"; }" 1)
omnicam_replace(content "float           framerate)" "float           framerate, const char* camera)" 1)
omnicam_replace(content "FrameBuffer FrameBuffer::open()" "FrameBuffer FrameBuffer::open(const char* camera)" 1)
omnicam_replace(content "FrameBuffer fb(NamedMutexName);" "FrameBuffer fb(NamedMutexName(camera).c_str());" 2)
omnicam_replace(content "SharedMemory::create(SharedMemoryName," "SharedMemory::create(SharedMemoryName(camera).c_str()," 1)
omnicam_replace(content "SharedMemory::open(SharedMemoryName)" "SharedMemory::open(SharedMemoryName(camera).c_str())" 1)
file(WRITE "${SOFTCAM_GEN_DIR}/FrameBuffer.cpp" "${content}")

file(READ "${SOFTCAM_DIR}/softcamcore/DShowSoftcam.cpp" content)
omnicam_replace(content "#include \"DShowSoftcam.h\""
                        "#include \"DShowSoftcam.h\"\n\n// OmniCam: the camera a filter CLSID belongs to (src/filter/omnicam_filter.cpp).\nconst char* omnicam_camera_name(REFCLSID clsid);" 1)
omnicam_replace(content "FrameBuffer::open()" "FrameBuffer::open(omnicam_camera_name(m_clsid))" 2)
file(WRITE "${SOFTCAM_GEN_DIR}/DShowSoftcam.cpp" "${content}")

configure_file("${SOFTCAM_DIR}/softcamcore/SenderAPI.cpp" "${SOFTCAM_GEN_DIR}/SenderAPI.cpp" COPYONLY)
configure_file("${SOFTCAM_DIR}/softcamcore/DShowSoftcam.h" "${SOFTCAM_GEN_DIR}/DShowSoftcam.h" COPYONLY)
