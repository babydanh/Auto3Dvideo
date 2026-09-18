$roots = @('D:\Duancanhan\Auto3Dvideo\outputs\native-local-video-e2e-artifacts','D:\Duancanhan\Auto3Dvideo\desktop\outputs\native-local-video-e2e-artifacts')
$files = foreach ($root in $roots) { if (Test-Path -LiteralPath $root) { Get-ChildItem -LiteralPath $root -Recurse -File -Filter 'master.mp4' -ErrorAction SilentlyContinue } }
$latest = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latest) {
  Write-Output ("LATEST_MP4=" + $latest.FullName)
  Write-Output ("SIZE_BYTES=" + $latest.Length)
  Write-Output ("LAST_WRITE=" + $latest.LastWriteTime.ToString('s'))
} else { Write-Output 'NO_MP4_FOUND' }
