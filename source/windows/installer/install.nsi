Unicode true
ManifestDPIAware true
RequestExecutionLevel user
CRCCheck force
SetCompressor /SOLID lzma
SetCompressorDictSize 64
SetCompress force
SetDatablockOptimize on

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"

Var UpdateParentPid
Var UpdateParameters
Var RestartAfterUpdate

Name "Inkreel"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Inkreel"
InstallDirRegKey HKCU "Software\BultenStudio" "InstallDir"
BrandingText "Inkreel"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${APP_VERSION_NUMERIC}"
VIAddVersionKey /LANG=1055 "ProductName" "Inkreel"
VIAddVersionKey /LANG=1055 "CompanyName" "Inkreel"
VIAddVersionKey /LANG=1055 "FileDescription" "Inkreel Kurulumu"
VIAddVersionKey /LANG=1055 "FileVersion" "${APP_VERSION_NUMERIC}"
VIAddVersionKey /LANG=1055 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1055 "LegalCopyright" "Inkreel"

!define MUI_ICON "${ICON_PATH}"
!define MUI_UNICON "${ICON_PATH}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Inkreel ${APP_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Bu sihirbaz içerik ve tasarım stüdyosunu bilgisayarınıza kurar.$\r$\n$\r$\nProgram kişisel uygulama klasörünüze kurulur. Yönetici izni gerekmez.$\r$\n$\r$\nKurulumdan sonra Masaüstü veya Başlat menüsündeki Inkreel simgesini kullanabilirsiniz."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Inkreel.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Inkreel’i başlat"
!define MUI_FINISHPAGE_TEXT "Inkreel kullanıma hazır.$\r$\n$\r$\nProgramı Masaüstü veya Başlat menüsündeki simgesinden açabilirsiniz."
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Program dosyaları ve kısayollar kaldırılır. Projeleriniz ve otomatik kayıtlı taslaklarınız korunur."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "Turkish"

; The updater starts this installer before quitting. Wait for that exact
; process before touching any installed file. Invalid switches fail closed.
Function WaitForUpdateParent
  Push $0
  Push $1
  Push $2
  Push $3
  StrLen $0 $UpdateParentPid
  ${If} $0 < 1
  ${OrIf} $0 > 10
    Goto invalid_update_pid
  ${EndIf}
  StrCpy $1 0
  validate_pid_digit:
    StrCpy $2 $UpdateParentPid 1 $1
    ${If} $2 == ""
      Goto validate_pid_value
    ${EndIf}
    ${If} $2 S< "0"
    ${OrIf} $2 S> "9"
      Goto invalid_update_pid
    ${EndIf}
    IntOp $1 $1 + 1
    Goto validate_pid_digit
  validate_pid_value:
    IntOp $0 $UpdateParentPid + 0
    ; The round trip also rejects overflows and noncanonical numbers.
    ${If} $0 != $UpdateParentPid
      Goto invalid_update_pid
    ${EndIf}
    StrCmp $0 $UpdateParentPid 0 invalid_update_pid
    IntCmp $0 0 invalid_update_pid invalid_update_pid
    System::Call 'kernel32::GetCurrentProcessId() i.r1'
    IntCmp $0 $1 invalid_update_pid
    System::Call 'kernel32::OpenProcess(i 0x00100000, i 0, i $UpdateParentPid) p.r0 ?e'
    Pop $1
    ${If} $0 == 0
      ; ERROR_INVALID_PARAMETER means the process has already exited.
      ${If} $1 == 87
        Goto parent_finished
      ${EndIf}
      Goto parent_wait_failed
    ${EndIf}
    System::Call 'kernel32::WaitForSingleObject(p r0, i 60000) i.r1'
    System::Call 'kernel32::CloseHandle(p r0)'
    ${If} $1 != 0
      Goto parent_wait_failed
    ${EndIf}
    Goto parent_finished
  invalid_update_pid:
    MessageBox MB_OK|MB_ICONSTOP "Güncelleme işleminin uygulama kimliği geçersiz. Program dosyaları değiştirilmedi." /SD IDOK
    SetErrorLevel 10
    Abort
  parent_wait_failed:
    MessageBox MB_OK|MB_ICONSTOP "Uygulamanın kapanması beklenemedi. Inkreel’i kapatıp kurulumu yeniden başlatın. Program dosyaları değiştirilmedi." /SD IDOK
    SetErrorLevel 11
    Abort
  parent_finished:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function CheckInstallSpace
  Push $0
  Push $1
  Push $2
  ${GetRoot} "$INSTDIR" $0
  ClearErrors
  ${DriveSpace} "$0" "/D=F /S=M" $1
  ${If} ${Errors}
    Goto insufficient_space
  ${EndIf}
  ; Compare MiB to avoid a32-bit KiB overflow on multi-terabyte disks.
  IntOp $2 ${INSTALLED_KB} / 1024
  IntOp $2 $2 + 33
  IntCmpU $1 $2 enough_space insufficient_space enough_space
  insufficient_space:
    MessageBox MB_OK|MB_ICONSTOP "Kurulum için yeterli boş alan doğrulanamadı. Diskte en az 400 MB boş alan açıp yeniden deneyin. Program dosyaları değiştirilmedi." /SD IDOK
    SetErrorLevel 12
    Abort
  enough_space:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Bu sürüm 64 bit Windows 10 veya Windows 11 gerektirir."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Bu sürüm Windows 10 veya Windows 11 gerektirir."
    Abort
  ${EndIf}
  SetRegView 64
  StrCpy $RestartAfterUpdate 0
  ${GetParameters} $UpdateParameters
  ClearErrors
  ${GetOptions} "$UpdateParameters" "/UPDATEPID=" $UpdateParentPid
  ${IfNot} ${Errors}
    Call WaitForUpdateParent
  ${EndIf}
  ClearErrors
  ${GetOptions} "$UpdateParameters" "/RESTARTAPP" $0
  ${IfNot} ${Errors}
    StrCpy $RestartAfterUpdate 1
  ${EndIf}
  Call CheckInstallSpace
FunctionEnd


; Opening with write/delete access and no sharing checks the two executable names
; without modifying either file. OPEN_EXISTING never creates or truncates a file.
!macro DefineInstalledAppsClosed PREFIX
Function ${PREFIX}CheckInstalledAppsClosed
  Push $0
  Push $1
  StrCpy $0 "$INSTDIR\Inkreel.exe"
  Call ${PREFIX}CheckExecutableClosed
  StrCpy $0 "$INSTDIR\Karevo.exe"
  Call ${PREFIX}CheckExecutableClosed
  StrCpy $0 "$INSTDIR\Bulten Studio.exe"
  Call ${PREFIX}CheckExecutableClosed
  Pop $1
  Pop $0
FunctionEnd

Function ${PREFIX}CheckExecutableClosed
  IfFileExists "$0" 0 executable_check_finished
  System::Call 'kernel32::CreateFileW(w r0, i 0x40010000, i 0, p 0, i 3, i 0x80, p 0) p.r1'
  IntCmp $1 -1 executable_check_failed
  System::Call 'kernel32::CloseHandle(p r1)'
  Goto executable_check_finished
  executable_check_failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "Uygulama dosyası kullanımda veya yazılamıyor. Inkreel’i kapatıp yeniden deneyin. Program dosyaları değiştirilmedi." /SD IDOK
    SetErrorLevel 14
    Abort
  executable_check_finished:
FunctionEnd
!macroend
!insertmacro DefineInstalledAppsClosed ""
!insertmacro DefineInstalledAppsClosed "un."

Section "Inkreel" SEC_APP
  SetShellVarContext current
  SetRegView 64
  SetOutPath "$INSTDIR"
  Call CheckInstalledAppsClosed
  ClearErrors
  IfFileExists "$INSTDIR\Bulten Studio.exe" 0 +2
    Delete "$INSTDIR\Bulten Studio.exe"
  IfFileExists "$INSTDIR\Inkreel.exe" 0 +2
    Delete "$INSTDIR\Inkreel.exe"
  IfFileExists "$INSTDIR\Karevo.exe" 0 +2
    Delete "$INSTDIR\Karevo.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "Uygulama dosyaları değiştirilemiyor. Inkreel’i kapatıp kurulumu yeniden başlatın."
    Abort
  ${EndIf}
  ClearErrors
  !ifndef CHECK_ONLY
  File /r "${APP_SOURCE}/*"
  !endif
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Program dosyaları yazılamadı. Disk alanını kontrol edip kurulum dosyasını yeniden çalıştırın. Proje yedeğiniz korunur." /SD IDOK
    SetErrorLevel 13
    Abort
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ; Remove legacy shortcuts while preserving the install path and registry identity.
  Delete "$DESKTOP\Bülten Studio.lnk"
  Delete "$SMPROGRAMS\Bülten Studio\Bülten Studio.lnk"
  Delete "$SMPROGRAMS\Bülten Studio\Kaldır.lnk"
  RMDir "$SMPROGRAMS\Bülten Studio"
  ; Karevo -> Inkreel: the old Karevo.exe was removed above; drop its shortcuts too.
  Delete "$DESKTOP\Karevo.lnk"
  Delete "$SMPROGRAMS\Karevo\Karevo.lnk"
  Delete "$SMPROGRAMS\Karevo\Kaldır.lnk"
  RMDir "$SMPROGRAMS\Karevo"
  CreateDirectory "$SMPROGRAMS\Inkreel"
  CreateShortCut "$DESKTOP\Inkreel.lnk" "$INSTDIR\Inkreel.exe"
  CreateShortCut "$SMPROGRAMS\Inkreel\Inkreel.lnk" "$INSTDIR\Inkreel.exe"
  CreateShortCut "$SMPROGRAMS\Inkreel\Kaldır.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\BultenStudio" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio" "DisplayName" "Inkreel"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio" "Publisher" "Inkreel"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio" "DisplayIcon" '"$INSTDIR\Inkreel.exe",0'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio" "NoRepair" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio" "EstimatedSize" ${INSTALLED_KB}
  ${If} ${Silent}
  ${AndIf} $RestartAfterUpdate == 1
    Exec '"$INSTDIR\Inkreel.exe"'
  ${EndIf}
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  Call un.CheckInstalledAppsClosed
  ClearErrors
  IfFileExists "$INSTDIR\Inkreel.exe" 0 +2
    Delete "$INSTDIR\Inkreel.exe"
  IfFileExists "$INSTDIR\Karevo.exe" 0 +2
    Delete "$INSTDIR\Karevo.exe"
  IfFileExists "$INSTDIR\Bulten Studio.exe" 0 +2
    Delete "$INSTDIR\Bulten Studio.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "Uygulama dosyaları değiştirilemiyor. Inkreel’i kapatıp kaldırmayı yeniden başlatın."
    Abort
  ${EndIf}
  !include "${UNINSTALL_INCLUDE}"
  Delete "$DESKTOP\Inkreel.lnk"
  Delete "$DESKTOP\Bülten Studio.lnk"
  Delete "$SMPROGRAMS\Bülten Studio\Bülten Studio.lnk"
  Delete "$SMPROGRAMS\Bülten Studio\Kaldır.lnk"
  RMDir "$SMPROGRAMS\Bülten Studio"
  Delete "$DESKTOP\Karevo.lnk"
  Delete "$SMPROGRAMS\Inkreel\Inkreel.lnk"
  Delete "$SMPROGRAMS\Inkreel\Kaldır.lnk"
  RMDir "$SMPROGRAMS\Inkreel"
  Delete "$SMPROGRAMS\Karevo\Karevo.lnk"
  Delete "$SMPROGRAMS\Karevo\Kaldır.lnk"
  RMDir "$SMPROGRAMS\Karevo"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BultenStudio"
  DeleteRegKey HKCU "Software\BultenStudio"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
