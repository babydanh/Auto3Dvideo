$ErrorActionPreference = 'Continue'
Get-CimInstance Win32_Process -Filter "Name='auto3dvideo-desktop.exe'" | Select-Object ProcessId,CommandLine,ExecutablePath | Format-List
Get-Process -Name 'auto3dvideo-desktop' -ErrorAction SilentlyContinue | Select-Object Id,MainWindowHandle,MainWindowTitle,Responding,HasExited,Path | Format-List
