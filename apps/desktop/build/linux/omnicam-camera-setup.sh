#!/bin/bash
# OmniCam camera setup: makes the v4l2loopback device "OmniCam" exist now and after every boot.
# Run as root, once: by the app through pkexec (Settings → Camera), or by the rpm/deb scriptlets.
#
#   omnicam-camera-setup.sh install|remove
#
# Exit codes (the app maps them to instructions):
#   0 ok · 10 no v4l2loopback module for this kernel · 11 load failed (other) · 12 usage
#   13 busy (a program has a loopback camera open) · 14 Secure Boot rejected the module
#   15 another v4l2loopback options file would override ours (named in the message)
# The last line on stderr is always one sentence for a person.
set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
# Byte order, like kmod when it sorts config files.
LC_ALL=C
export PATH LC_ALL

LABEL=OmniCam
MODPROBE_CONF=/etc/modprobe.d/omnicam.conf
LOAD_CONF=/etc/modules-load.d/omnicam.conf
OPTIONS='options v4l2loopback devices=1 video_nr=63 card_label="OmniCam" exclusive_caps=1 max_buffers=2'

say() { echo "$*" >&2; }
fail() {
  local code=$1
  shift
  say "$*"
  exit "$code"
}

# /dev/videoN of the first loopback device labelled OmniCam, or nothing.
omnicam_device() {
  local node
  for node in /sys/class/video4linux/video*; do
    [ -e "$node/max_openers" ] || continue # only v4l2loopback's own devices
    if [ "$(tr -d '\n' <"$node/name" 2>/dev/null)" = "$LABEL" ]; then
      echo "/dev/${node##*/}"
      return 0
    fi
  done
  return 1
}

# Labels of every loopback device, for messages.
loopback_labels() {
  local node labels=""
  for node in /sys/class/video4linux/video*; do
    [ -e "$node/max_openers" ] || continue
    labels="$labels${labels:+, }\"$(tr -d '\n' <"$node/name" 2>/dev/null)\""
  done
  echo "$labels"
}

module_loaded() { [ -d /sys/module/v4l2loopback ]; }

# v4l2loopback-ctl 0.13+ can add and delete devices while the module stays loaded; 0.12's cannot.
ctl_can() {
  command -v v4l2loopback-ctl >/dev/null 2>&1 &&
    v4l2loopback-ctl --help 2>&1 | grep -q "v4l2loopback-ctl $1 "
}

# Other options files for v4l2loopback that would fight ours: anything an administrator wrote in
# /etc or /run, and any file that modprobe reads after omnicam.conf (its values would win). Vendor
# defaults read before ours, like Fedora's 98-v4l2loopback.conf, are simply overridden.
conflicting_config() {
  local dir file base
  for dir in /etc/modprobe.d /run/modprobe.d /usr/local/lib/modprobe.d /usr/lib/modprobe.d /lib/modprobe.d; do
    for file in "$dir"/*.conf; do
      [ -f "$file" ] || continue
      [ "$file" = "$MODPROBE_CONF" ] && continue
      grep -Eq '^[[:space:]]*options[[:space:]]+v4l2loopback([[:space:]]|$)' "$file" || continue
      base=${file##*/}
      # A same-named file in /etc or /run masks the vendor copy: only the first one found counts.
      case "$dir" in
        /etc/* | /run/*) echo "$file"; return 0 ;;
      esac
      if [ -e "/etc/modprobe.d/$base" ] || [ -e "/run/modprobe.d/$base" ]; then
        continue
      fi
      if [[ "$base" > "omnicam.conf" ]]; then
        echo "$file"
        return 0
      fi
    done
  done
  return 1
}

# modprobe, mapping its failure to our exit codes.
load_module() {
  local out
  if out=$(modprobe v4l2loopback 2>&1); then
    return 0
  fi
  [ -n "$out" ] && say "$out"
  case "$out" in
    *"Key was rejected by service"* | *"Required key not available"*)
      fail 14 "Secure Boot rejected the v4l2loopback module: its signing key is not enrolled yet (enroll it with mokutil and reboot)."
      ;;
  esac
  fail 11 "The v4l2loopback module could not be loaded."
}

unload_module() {
  local out
  if out=$(modprobe -r v4l2loopback 2>&1); then
    return 0
  fi
  [ -n "$out" ] && say "$out"
  fail 13 "A program is using a loopback camera (an app with a camera open, or OBS's virtual camera): close it and try again."
}

# udev creates the node shortly after the module or v4l2loopback-ctl returns: allow 5 s. A new node
# is root:video 0660 until udev has also given the logged-in user access (uaccess), so wait for udev
# to finish before saying the camera is ready, or the app's first open fails with EACCES.
wait_for_device() {
  local tries=20
  while [ "$tries" -gt 0 ]; do
    if omnicam_device >/dev/null; then
      udevadm settle --timeout=10 || true
      return 0
    fi
    sleep 0.25
    tries=$((tries - 1))
  done
  return 1
}

install() {
  local kernel conflict
  kernel=$(uname -r)
  if ! modinfo -k "$kernel" v4l2loopback >/dev/null 2>&1; then
    fail 10 "No v4l2loopback module is installed for kernel $kernel: install it first (Fedora: akmod-v4l2loopback from RPM Fusion; Debian, Ubuntu, Arch: v4l2loopback-dkms)."
  fi
  if conflict=$(conflicting_config); then
    fail 15 "$conflict already sets v4l2loopback options and would override OmniCam's: remove it, or merge its devices into one options line, then try again."
  fi

  mkdir -p "${MODPROBE_CONF%/*}" "${LOAD_CONF%/*}"
  printf '# Written by OmniCam: its camera device.\n%s\n' "$OPTIONS" >"$MODPROBE_CONF"
  printf '# Written by OmniCam: load the camera module at boot.\nv4l2loopback\n' >"$LOAD_CONF"

  if omnicam_device >/dev/null; then
    say "The OmniCam camera is set up."
    return 0
  fi

  if module_loaded; then
    if ctl_can add; then
      # Another program's loopback device (OBS…) stays as it is; ours is added next to it.
      local nr=63
      [ -e /dev/video63 ] && nr=""
      if ! v4l2loopback-ctl add -n "$LABEL" -x 1 -b 2 ${nr:+"$nr"} >/dev/null 2>&1; then
        unload_module
        load_module
      fi
    else
      unload_module
      load_module
    fi
  else
    load_module
  fi

  if ! wait_for_device; then
    local labels
    labels=$(loopback_labels)
    fail 11 "v4l2loopback is loaded but no camera named OmniCam appeared${labels:+ (found $labels)}."
  fi
  say "The OmniCam camera is set up."
}

remove() {
  local dev
  rm -f "$MODPROBE_CONF" "$LOAD_CONF"
  if ! dev=$(omnicam_device); then
    say "OmniCam's camera setup is removed."
    return 0
  fi
  if ctl_can delete; then
    if ! v4l2loopback-ctl delete "$dev" >/dev/null 2>&1; then
      fail 13 "OmniCam's camera setup is removed; the camera itself stays until the next restart because a program has it open."
    fi
  elif [ "$(loopback_labels)" = "\"$LABEL\"" ]; then
    if ! modprobe -r v4l2loopback >/dev/null 2>&1; then
      fail 13 "OmniCam's camera setup is removed; the camera itself stays until the next restart because a program has it open."
    fi
  else
    say "OmniCam's camera setup is removed; the camera itself goes away at the next restart."
    return 0
  fi
  say "OmniCam's camera setup is removed."
}

if [ "$(id -u)" -ne 0 ]; then
  fail 12 "Run this as root: omnicam-camera-setup.sh install|remove"
fi
case "${1:-}" in
  install) install ;;
  remove) remove ;;
  *) fail 12 "Usage: omnicam-camera-setup.sh install|remove" ;;
esac
