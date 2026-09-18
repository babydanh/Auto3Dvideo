$ErrorActionPreference = 'Stop'
$exe = 'D:\Duancanhan\Auto3Dvideo\desktop\src-tauri\target\release\auto3dvideo-desktop.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Không tìm thấy bản release: $exe" }
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Auto3Dvideo Studio.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = Split-Path -Parent $exe
$shortcut.Description = 'Auto3Dvideo Studio - bản release local'
$shortcut.IconLocation = "$exe,0"
$shortcut.Save()
Write-Output "SHORTCUT_CREATED=$shortcutPath"
Write-Output "TARGET=$exe"

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$startShortcutPath = Join-Path $startMenu 'Auto3Dvideo Studio.lnk'
$startShortcut = $shell.CreateShortcut($startShortcutPath)
$startShortcut.TargetPath = $exe
$startShortcut.WorkingDirectory = Split-Path -Parent $exe
$startShortcut.Description = 'Auto3Dvideo Studio - bản release local'
$startShortcut.IconLocation = "$exe,0"
$startShortcut.Save()
Write-Output "START_SHORTCUT_CREATED=$startShortcutPath"

Get-Process -Name 'auto3dvideo-desktop' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
Start-Sleep -Seconds 2
Get-Process -Name 'auto3dvideo-desktop' | Select-Object -First 1 Id,ProcessName,MainWindowTitle,Path
Write-Output 'RELEASE_APP_STARTED=1'
