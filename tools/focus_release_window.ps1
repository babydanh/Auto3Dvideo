Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WindowFocus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
'@
$p = Get-Process -Name 'auto3dvideo-desktop' -ErrorAction Stop | Select-Object -First 1
$h = $p.MainWindowHandle
if ($h -eq 0) { throw 'Không tìm thấy handle cửa sổ Auto3Dvideo Studio.' }
[WindowFocus]::ShowWindowAsync($h, 9) | Out-Null
[WindowFocus]::SetForegroundWindow($h) | Out-Null
Write-Output "FOCUSED_PID=$($p.Id)"
Write-Output "WINDOW_TITLE=$($p.MainWindowTitle)"
