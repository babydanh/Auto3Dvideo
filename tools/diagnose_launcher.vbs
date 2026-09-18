Option Explicit
Dim shell, fso, desktop, shortcutPath, shortcut, exePath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
desktop = shell.SpecialFolders("Desktop")
shortcutPath = fso.BuildPath(desktop, "Auto3Dvideo Studio.lnk")
WScript.Echo "SHORTCUT=" & shortcutPath
WScript.Echo "SHORTCUT_EXISTS=" & fso.FileExists(shortcutPath)
If fso.FileExists(shortcutPath) Then
  Set shortcut = shell.CreateShortcut(shortcutPath)
  WScript.Echo "TARGET=" & shortcut.TargetPath
  WScript.Echo "WORKDIR=" & shortcut.WorkingDirectory
  WScript.Echo "ARGS=" & shortcut.Arguments
End If
exePath = "D:\Duancanhan\Auto3Dvideo\desktop\src-tauri\target\release\auto3dvideo-desktop.exe"
WScript.Echo "RELEASE_EXISTS=" & fso.FileExists(exePath)
WScript.Echo "RELEASE_PATH=" & exePath
