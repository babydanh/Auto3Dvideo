$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Auto3Dvideo Studio.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'D:\Duancanhan\Auto3Dvideo\desktop\src-tauri\target\release\auto3dvideo-desktop.exe'
$shortcut.WorkingDirectory = 'D:\Duancanhan\Auto3Dvideo\desktop\src-tauri\target\release'
$shortcut.Description = 'Auto3Dvideo Blender-to-Flow Studio'
$shortcut.Save()
Write-Output "SHORTCUT_CREATED=$shortcutPath"
