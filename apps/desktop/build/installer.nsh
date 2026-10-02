; OmniCam NSIS hooks (electron-builder "include").
; Registers the DirectShow filter DLLs (x64 + x86) and opens the firewall for the app.
; Runs elevated because the installer is perMachine.

; First page: say what the installer changes on the system before it asks for administrator rights.
; Skipped on in-app updates (silent) and when run with --updated.
!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Install OmniCam"
  !define MUI_WELCOMEPAGE_TEXT "OmniCam turns your phone's camera into a webcam for this PC.$\r$\n$\r$\nBesides copying its files, the installer makes two system changes, both removed again when you uninstall:$\r$\n$\r$\n  - registers the $\"OmniCam$\" camera device (a DirectShow filter, 64- and 32-bit), so apps can list it;$\r$\n  - adds a Windows Firewall rule that lets your phone reach OmniCam on your local network.$\r$\n$\r$\nThese need administrator rights, so Windows will ask.$\r$\n$\r$\nOmniCam has no account and no telemetry. Video goes from your phone to this PC over your own network."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstall
  DetailPrint "Registering OmniCam virtual camera (x64)..."
  nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /s "$INSTDIR\resources\native\omnicam_vcam.dll"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "The OmniCam camera driver (x64) could not be registered (code $0). Run this installer again to retry."
  ${EndIf}

  ${If} ${FileExists} "$INSTDIR\resources\native\x86\omnicam_vcam.dll"
    DetailPrint "Registering OmniCam virtual camera (x86)..."
    nsExec::ExecToLog '"$WINDIR\SysWOW64\regsvr32.exe" /s "$INSTDIR\resources\native\x86\omnicam_vcam.dll"'
    Pop $0
  ${EndIf}

  ; Start-menu shortcut to the README so the instructions are one click away.
  CreateShortCut "$SMPROGRAMS\OmniCam README.lnk" "$INSTDIR\resources\docs\README.txt"

  DetailPrint "Adding Windows Firewall rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="OmniCam"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="OmniCam" dir=in action=allow program="$INSTDIR\OmniCam.exe" enable=yes profile=private,public description="Lets your phone reach OmniCam on the local network"'
  Pop $0
!macroend

!macro customUnInstall
  DetailPrint "Unregistering OmniCam virtual camera..."
  nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /u /s "$INSTDIR\resources\native\omnicam_vcam.dll"'
  Pop $0
  ${If} ${FileExists} "$INSTDIR\resources\native\x86\omnicam_vcam.dll"
    nsExec::ExecToLog '"$WINDIR\SysWOW64\regsvr32.exe" /u /s "$INSTDIR\resources\native\x86\omnicam_vcam.dll"'
    Pop $0
  ${EndIf}
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="OmniCam"'
  Pop $0
  Delete "$SMPROGRAMS\OmniCam README.lnk"
!macroend
