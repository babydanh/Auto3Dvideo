$ErrorActionPreference = 'Stop'
$source = 'D:\Duancanhan\Auto3Dvideo\tools\Start_Auto3Dvideo_Full.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
$target = Join-Path $desktop 'Start Auto3Dvideo Full.cmd'
Copy-Item -LiteralPath $source -Destination $target -Force
Write-Output "LAUNCHER=$target"
& $target
Write-Output 'FULL_LAUNCHER_STARTED=1'
