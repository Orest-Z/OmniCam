# softcam hard-codes the names of its shared-memory objects. We rename them at configure
# time (never touching the submodule) so an OmniCam install can coexist with a stock softcam.
set(_src "${SOFTCAM_DIR}/softcamcore/FrameBuffer.cpp")
set(_dst "${CMAKE_BINARY_DIR}/gen/FrameBuffer.cpp")
file(READ "${_src}" _content)
string(REPLACE "DirectShow Softcam/NamedMutex"   "OmniCam/NamedMutex"   _content "${_content}")
string(REPLACE "DirectShow Softcam/SharedMemory" "OmniCam/SharedMemory" _content "${_content}")
file(WRITE "${_dst}" "${_content}")
set(SOFTCAM_FRAMEBUFFER_CPP "${_dst}")
