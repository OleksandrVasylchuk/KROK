@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\setup-google.ps1"
pause
