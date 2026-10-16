#!/bin/bash
# rpm %postun / deb postrm for OmniCam: electron-builder's own after-remove.tpl (26.x) and OmniCam's
# camera setup removal, only when the package is really removed. On an upgrade rpm runs the old
# package's %postun after the new package's %post ($1 is 1 then), and deb calls postrm "upgrade":
# removing anything then would undo what the new version just installed.
case "$1" in
  0 | remove | purge) ;;
  *) exit 0 ;;
esac


# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
# OmniCam: remove its camera configuration, and the device itself when nothing is using it.
if [ -f '/opt/${sanitizedProductName}/resources/linux/omnicam-camera-setup.sh' ]; then
  /bin/bash '/opt/${sanitizedProductName}/resources/linux/omnicam-camera-setup.sh' remove || true
fi
