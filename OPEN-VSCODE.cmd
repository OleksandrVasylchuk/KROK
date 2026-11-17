@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "KROK_CODE="
for /f "delims=" %%I in ('where code.cmd 2^>nul') do if not defined KROK_CODE set "KROK_CODE=%%I"
if not defined KROK_CODE if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd" set "KROK_CODE=%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"
if not defined KROK_CODE if exist "%ProgramFiles%\Microsoft VS Code\bin\code.cmd" set "KROK_CODE=%ProgramFiles%\Microsoft VS Code\bin\code.cmd"
if not defined KROK_CODE if exist "%ProgramFiles(x86)%\Microsoft VS Code\bin\code.cmd" set "KROK_CODE=%ProgramFiles(x86)%\Microsoft VS Code\bin\code.cmd"
if not defined KROK_CODE (
  echo Visual Studio Code was not found.
  echo Install VS Code from https://code.visualstudio.com/ and run this file again.
  pause
  exit /b 1
)
rem One CLI request opens both paths in the same new window. No --wait is used.
rem The folder's final dot avoids a quoted trailing backslash in native CLI arguments.
if exist "%~dp0README.md" (
  call "%KROK_CODE%" --new-window "%~dp0." "%~dp0README.md"
) else (
  echo README.md is not present yet. Opening the project folder.
  call "%KROK_CODE%" --new-window "%~dp0."
)
if errorlevel 1 (
  echo VS Code could not open the project. Check the message above.
  pause
  exit /b 1
)
exit /b 0
