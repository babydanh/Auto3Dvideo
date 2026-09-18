@echo off
setlocal
set "APP=D:\Duancanhan\Auto3Dvideo\desktop\src-tauri\target\release\auto3dvideo-desktop.exe"
set "LOG=%USERPROFILE%\Desktop\Auto3Dvideo-startup.log"
>>"%LOG%" echo [%date% %time%] Starting Auto3Dvideo Studio release
if not exist "%APP%" (
  echo KHONG TIM THAY FILE APP:
  echo %APP%
  >>"%LOG%" echo ERROR: release executable not found
  pause
  exit /b 1
)
taskkill /IM auto3dvideo-desktop.exe /F >nul 2>&1
start "Auto3Dvideo Studio" /D "D:\Duancanhan\Auto3Dvideo\desktop\src-tauri\target\release" "%APP%"
timeout /t 3 /nobreak >nul
tasklist /FI "IMAGENAME eq auto3dvideo-desktop.exe" | find /I "auto3dvideo-desktop.exe" >nul
if errorlevel 1 (
  echo APP KHONG KHOI DONG DUOC. Xem log: %LOG%
  >>"%LOG%" echo ERROR: process did not appear
  pause
  exit /b 1
)
>>"%LOG%" echo [%date% %time%] Release app started; Tauri backend is embedded in this process
exit /b 0
