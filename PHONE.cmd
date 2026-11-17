@echo off
setlocal
cd /d "%~dp0"
title KROK - Android phone
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-phone-preview.ps1"
set "KROK_EXIT=%ERRORLEVEL%"
if not "%KROK_EXIT%"=="0" (
  echo.
  echo Phone preview could not start. Read the message above.
  pause
)
exit /b %KROK_EXIT%
