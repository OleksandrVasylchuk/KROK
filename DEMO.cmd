@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist dist\index.html (
  echo Build the web app first: npm ci, then npm run build.
  pause
  exit /b 1
)
node scripts\serve.mjs --open --demo
pause
