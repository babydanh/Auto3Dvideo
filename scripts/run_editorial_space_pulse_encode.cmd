@echo off
setlocal
cd /d "%~dp0.."
set FFMPEG=D:\MediaTools\ffmpeg\package\ffmpeg-9.0.1-essentials_build\bin\ffmpeg.exe
set ROOT=outputs\editorial-space-pulse-v3
if not exist "%ROOT%\editorial-space-pulse-silent.mp4" exit /b 2
if not exist ".auto3dvideo\tts\editorial-space-pulse-narration.wav" exit /b 3
if not exist "%ROOT%\editorial-space-pulse.srt" exit /b 4
"%FFMPEG%" -y -i "%ROOT%\editorial-space-pulse-silent.mp4" -i ".auto3dvideo\tts\editorial-space-pulse-narration.wav" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 128k -af apad -t 30 "%ROOT%\editorial-space-pulse-narrated.mp4"
if errorlevel 1 exit /b 5
copy /y "%ROOT%\editorial-space-pulse-narrated.mp4" "%ROOT%\editorial-space-pulse-final.mp4" >nul
if errorlevel 1 exit /b 6
rem Subtitle remains as a deterministic sidecar SRT for this test; burn-in is a separate approved compose step.
exit /b 0
