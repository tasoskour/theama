; Keep installer sources outside build/: that directory is ignored by Git.
; electron-builder runs the old uninstaller with --updated before replacing files.
; Its hook stops the service but preserves its registration and all user data.

!macro customInstall
  ; The helper does nothing on first install, when no service exists yet.
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\nssm\installer-helper.ps1" -Action start'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Theama service could not be started (exit code $0)."
    MessageBox MB_OK|MB_ICONEXCLAMATION "Theama was installed, but its service could not be started. Use Repair service in the app." /SD IDOK
  ${EndIf}
!macroend

!macro customUnInstall
  ; Stop before electron-builder removes or moves any service executables.
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\nssm\installer-helper.ps1" -Action stop'
  Pop $0
  ${If} $0 != 0
  ${AndIf} $0 != 10
    MessageBox MB_OK|MB_ICONSTOP "Theama's service could not be stopped. Stop the service and try again." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}

  ${IfNot} ${isUpdated}
    ; This installer is per-machine: $APPDATA is ProgramData in this context.
    SetShellVarContext all
    InitPluginsDir
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\nssm\service-admin.ps1" -Action uninstall -NssmExe "$INSTDIR\resources\nssm\nssm.exe" -DataDir "$APPDATA\Theama" -ResultFile "$PLUGINSDIR\theama-service-result.json"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Theama's service could not be removed. Use Uninstall service in the app and try again." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}

    ; Keep data by default, and always keep it during upgrades or silent removal.
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete Theama's library, settings, backups and logs from $APPDATA\Theama? Your video files will not be deleted." /SD IDNO IDYES theama_delete_data IDNO theama_keep_data
      theama_delete_data:
        RMDir /r "$APPDATA\Theama"
      theama_keep_data:
    ${EndIf}
  ${EndIf}
!macroend
