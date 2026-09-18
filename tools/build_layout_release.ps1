$log = 'D:\Duancanhan\Auto3Dvideo\tools\layout-build.log'
if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
$script = "Set-Location 'D:\Duancanhan\Auto3Dvideo\desktop'; pnpm tauri build *> '$log'"
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-Command',$script -WindowStyle Hidden
Write-Output 'BUILD_STARTED=1'
