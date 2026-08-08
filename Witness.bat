@echo off
setlocal
title Witness Control Panel
cd /d "%~dp0"

echo.
echo   WITNESS
echo   starting the control panel...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   ---------------------------------------------------------------
  echo    Node.js is not installed.
  echo.
  echo    Install the LTS version from  https://nodejs.org
  echo    then CLOSE this window, open it again, and run this file.
  echo.
  echo    ^(The installer edits your PATH, and an already-open window
  echo     keeps the old one - that is why reopening matters.^)
  echo   ---------------------------------------------------------------
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v') do set NODEMAJOR=%%v
set NODEMAJOR=%NODEMAJOR:v=%
if %NODEMAJOR% LSS 22 (
  echo   ---------------------------------------------------------------
  echo    Node %NODEMAJOR% is too old - Witness needs Node 22 or newer.
  echo    Install the LTS from https://nodejs.org, then reopen this window.
  echo   ---------------------------------------------------------------
  echo.
  pause
  exit /b 1
)

echo   Your browser will open in a moment.
echo   Keep this window open - closing it stops everything.
echo.

node "tools\control\server.mjs"

echo.
echo   Control panel stopped.
pause
