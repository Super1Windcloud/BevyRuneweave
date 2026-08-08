Unicode True
ManifestDPIAware True

!include "MUI2.nsh"

!ifndef SOURCE_DIR
  !error "SOURCE_DIR is required"
!endif
!ifndef ASSETS_DIR
  !error "ASSETS_DIR is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif
!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif

Name "Bevy RuneWeave"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Bevy RuneWeave"
InstallDirRegKey HKCU "Software\Bevy RuneWeave" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\bevy-runeweave-runtime.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Bevy RuneWeave" MainSection
  SetOutPath "$INSTDIR"
  File "${SOURCE_DIR}\bevy-runeweave-runtime.exe"
  File "${SOURCE_DIR}\game_runtime.h"
  File "${SOURCE_DIR}\build-info.txt"

  SetOutPath "$INSTDIR\lib"
  File "${SOURCE_DIR}\lib\bevy_runeweave.dll"

  SetOutPath "$INSTDIR\assets"
  File /r "${ASSETS_DIR}\*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Bevy RuneWeave" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BevyRuneWeave" "DisplayName" "Bevy RuneWeave"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BevyRuneWeave" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BevyRuneWeave" "DisplayIcon" "$INSTDIR\bevy-runeweave-runtime.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BevyRuneWeave" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BevyRuneWeave" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BevyRuneWeave" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\Bevy RuneWeave"
  CreateShortcut "$SMPROGRAMS\Bevy RuneWeave\Bevy RuneWeave.lnk" "$INSTDIR\bevy-runeweave-runtime.exe"
  CreateShortcut "$SMPROGRAMS\Bevy RuneWeave\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Bevy RuneWeave\Bevy RuneWeave.lnk"
  Delete "$SMPROGRAMS\Bevy RuneWeave\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Bevy RuneWeave"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BevyRuneWeave"
  DeleteRegKey HKCU "Software\Bevy RuneWeave"
  RMDir /r "$INSTDIR"
SectionEnd
