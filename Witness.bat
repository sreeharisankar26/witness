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

REM ---------------------------------------------------------------------------
REM  Clear a control panel left over from last time.
REM
REM  Closing the console window does not reliably deliver SIGINT on Windows, so
REM  an earlier panel can still be holding 8790. Two ways that bites: the new
REM  panel cannot bind and dies instantly, or - worse - your browser reconnects
REM  to the OLD one, which is still running the code from before you edited it.
REM  Then you read a source file, see the fix, and watch it not happen.
REM ---------------------------------------------------------------------------
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":8790 .*LISTENING" 2^>nul') do (
  taskkill /PID %%p /T /F >nul 2>&1
)

echo   Your browser will open in a moment.
echo   Keep this window open - closing it stops everything.
echo.

node "tools\control\server.mjs"

echo.
echo   Control panel stopped.
pause
