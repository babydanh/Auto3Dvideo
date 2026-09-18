@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "FFMPEG=D:\MediaTools\ffmpeg\package\ffmpeg-9.0.1-essentials_build\bin\ffmpeg.exe"
if exist "outputs\moon-story-pilot\moon-story-final.mp4" del /q "outputs\moon-story-pilot\moon-story-final.mp4"
"%FFMPEG%" -y -i "outputs\moon-story-pilot\moon-story-narrated.mp4" -vf "subtitles=outputs/moon-story-pilot/moon-story-subtitles.srt:force_style=FontName=Arial\,FontSize=18\,Outline=2\,Shadow=1\,Alignment=2\,MarginV=60" -c:v libx264 -preset medium -crf 20 -c:a copy -movflags +faststart "outputs\moon-story-pilot\moon-story-final.mp4" > "outputs\moon-story-pilot\ffmpeg-final-v4.log" 2>&1
set "STATUS=%ERRORLEVEL%"
echo SUBTITLE_ENCODE_EXIT=%STATUS%
exit /b %STATUS%
