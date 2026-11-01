#!/bin/bash
# OmniCam camera setup: makes the v4l2loopback device "OmniCam" exist now and after every boot.
# Run as root, once: by the app through pkexec (Settings → Camera), or by the rpm/deb scriptlets.
#
#   omnicam-camera-setup.sh install [--enroll] | driver | remove
#
# install: the device, if the module is installed. --enroll (the app only, never a package scriptlet):
#   when Secure Boot rejects the module, queue its signing key for enrollment instead of failing.
# driver: install the module from the distribution's packages first (Fedora: RPM Fusion free, turned on
#   if it is off; Debian, Ubuntu: v4l2loopback-dkms), then install --enroll. The app asks first.
#
# Exit codes (the app maps them to instructions):
#   0 ok · 10 no v4l2loopback module for this kernel · 11 load failed (other) · 12 usage
#   13 busy (a program has a loopback camera open) · 14 Secure Boot rejected the module
#   15 another v4l2loopback options file would override ours (named in the message)
#   16 Secure Boot key queued: restart to approve it (the last line is the one-time password)
#   17 installing the driver would also install a kernel: update and restart first
#   18 the driver could not be installed (why, in the message)
# The last line on stderr is always one sentence for a person (16: the password). Package manager
# output goes to stdout, for the log.
set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
# Byte order, like kmod when it sorts config files.
LC_ALL=C
export PATH LC_ALL

LABEL=OmniCam
MODPROBE_CONF=/etc/modprobe.d/omnicam.conf
LOAD_CONF=/etc/modules-load.d/omnicam.conf
OPTIONS='options v4l2loopback devices=1 video_nr=63 card_label="OmniCam" exclusive_caps=1 max_buffers=2'
ENROLL=0

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

# The public key the module was signed with: akmods' (Fedora) or DKMS's (Ubuntu's shim-signed key, then
# DKMS 3's own).
signing_key() {
  local key
  for key in /etc/pki/akmods/certs/public_key.der /var/lib/shim-signed/mok/MOK.der /var/lib/dkms/mok.pub; do
    if [ -f "$key" ]; then
      echo "$key"
      return 0
    fi
  done
  return 1
}

# Queues the signing key for Secure Boot (shim's MOK list) behind a one-time password and exits 16 with
# the password as the last line; the person approves it on the firmware's blue screen at the next
# restart. Digits only: that screen may not use the person's keyboard layout. Returns when it can't.
enroll_key() {
  local key pass hash
  command -v mokutil >/dev/null 2>&1 || return 1
  key=$(signing_key) || return 1
  case "$(mokutil --test-key "$key" 2>&1)" in
    # Trusted already (so the rejection is about another key), or blocked: nothing to enroll.
    *"already enrolled"* | *"already in db"* | *MokListX* | *"MokX "*) return 1 ;;
    # Queued earlier, behind a password that may be lost: queue it again with a new one. This also
    # drops other keys waiting in the same request; their tools queue them again.
    *"already in the enrollment request"*) mokutil --revoke-import >/dev/null 2>&1 || true ;;
  esac
  pass=$(od -An -N8 -tu1 /dev/urandom | awk '{ for (i = 1; i <= NF; i++) printf "%d", $i % 10 }')
  hash=$(mktemp)
  if ! mokutil --generate-hash="$pass" >"$hash" || ! mokutil --import "$key" --hash-file "$hash" >/dev/null 2>&1; then
    rm -f "$hash"
    return 1
  fi
  rm -f "$hash"
  say "Secure Boot will ask you to approve the driver's key at the next restart, with this one-time password:"
  say "$pass"
  exit 16
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
      # set -e would end the script on enroll_key's failure before it says why.
      if [ "$ENROLL" = 1 ]; then enroll_key || true; fi
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

# A dry run's plan includes a kernel. Asked for the driver's build dependencies, dnf and apt resolve them
# against the newest kernel in the repositories, not the running one: on Fedora that once installed a
# new kernel-core without its kernel-modules (no Wi-Fi, no HDMI after the restart).
plans_kernel() {
  grep -Eq '^[[:space:]]+kernel(-core|-modules[a-z-]*)?[[:space:]]|^Inst linux-(image|modules)-' <<<"$1"
}

KERNEL_UPDATE="Installing the driver would also install a newer kernel: update your system and restart into it first, then try again."

# The module from the distribution's own packages, built for the running kernel.
install_driver() {
  local kernel plan
  kernel=$(uname -r)
  if [ -e /run/ostree-booted ]; then
    fail 18 "This system installs packages with rpm-ostree, which OmniCam can't do for you: install the driver from a terminal."
  fi
  if command -v dnf >/dev/null 2>&1 && grep -Eq '^ID="?fedora"?$' /etc/os-release; then
    if ! rpm -q rpmfusion-free-release >/dev/null 2>&1; then
      say "Turning on RPM Fusion free."
      dnf install -y "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm" ||
        fail 18 "RPM Fusion could not be turned on: check the internet connection, then try again."
    fi
    plan=$(dnf install --assumeno akmod-v4l2loopback 2>&1 || true)
    if plans_kernel "$plan"; then
      echo "$plan" # for the log: which kernel it would have brought in
      fail 17 "$KERNEL_UPDATE"
    fi
    dnf install -y akmod-v4l2loopback ||
      fail 18 "akmod-v4l2loopback could not be installed: check the internet connection, or wait for another update to finish, then try again."
    # Installed but not running a kernel the build tools match (not restarted after an update).
    [ -d "/usr/src/kernels/$kernel" ] || fail 17 "$KERNEL_UPDATE"
    # The build signs the module with akmods' key, so the key must exist before it.
    [ -f /etc/pki/akmods/certs/public_key.der ] || kmodgenca -a || true
    # Build now and wait for it. --rebuild: akmod's own build at install time may have run before the
    # key existed, leaving a module Secure Boot rejects.
    akmods --force --rebuild --kernels "$kernel" --akmod v4l2loopback ||
      fail 18 "The driver could not be built for kernel $kernel (details in /var/cache/akmods)."
  elif command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive # no debconf questions: there is no terminal to answer them
    # Wait for an update already running (unattended-upgrades, right after boot) instead of failing;
    # keep changed config files without asking, since nobody can answer.
    local apt=(apt-get -q -o DPkg::Lock::Timeout=300 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
    "${apt[@]}" update || true
    if ! plan=$("${apt[@]}" -s install v4l2loopback-dkms "linux-headers-$kernel" 2>&1); then
      case "$plan" in
        *"linux-headers-$kernel"*) fail 17 "$KERNEL_UPDATE" ;;
        *"package v4l2loopback-dkms"*) fail 18 "v4l2loopback-dkms is not in your package sources (on Ubuntu it is in universe): install it from a terminal." ;;
        *) fail 18 "apt could not install v4l2loopback-dkms: $(tail -n 1 <<<"$plan")" ;;
      esac
    fi
    if plans_kernel "$plan"; then
      echo "$plan" # for the log: which kernel it would have brought in
      fail 17 "$KERNEL_UPDATE"
    fi
    "${apt[@]}" install -y v4l2loopback-dkms "linux-headers-$kernel" ||
      fail 18 "v4l2loopback-dkms could not be installed: check the internet connection, or wait for another update to finish, then try again."
  else
    fail 18 "OmniCam can only install the driver on Fedora, Debian and Ubuntu: install v4l2loopback with your package manager."
  fi
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
  fail 12 "Run this as root: omnicam-camera-setup.sh install [--enroll] | driver | remove"
fi
case "${1:-} ${2:-}" in
  "install ") install ;;
  "install --enroll")
    ENROLL=1
    install
    ;;
  "driver ")
    ENROLL=1
    install_driver
    install
    ;;
  "remove ") remove ;;
  *) fail 12 "Usage: omnicam-camera-setup.sh install [--enroll] | driver | remove" ;;
esac
