Option Explicit
Dim fso, shell, folder, file, shortcut
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
Set folder = fso.GetFolder(shell.SpecialFolders("Desktop"))
For Each file In folder.Files
  If LCase(fso.GetExtensionName(file.Name)) = "lnk" Or LCase(fso.GetExtensionName(file.Name)) = "url" Then
    WScript.Echo "FILE=" & file.Path
    If LCase(fso.GetExtensionName(file.Name)) = "lnk" Then
      Set shortcut = shell.CreateShortcut(file.Path)
      WScript.Echo "TARGET=" & shortcut.TargetPath
      WScript.Echo "ARGS=" & shortcut.Arguments
    Else
      WScript.Echo "URL=" & fso.OpenTextFile(file.Path, 1).ReadAll
    End If
  End If
Next
