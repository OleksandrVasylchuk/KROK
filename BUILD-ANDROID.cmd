@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or later, then run this file again.
  pause
  exit /b 1
)
node scripts\build-android.mjs
if errorlevel 1 (
  echo.
  echo Android build failed. Read the message above.
  pause
  exit /b 1
)
echo.
echo APK is ready in the releases folder.
pause
