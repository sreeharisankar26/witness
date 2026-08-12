@echo off
REM ===========================================================================
REM  Restart the sync server on 8787.
REM
REM  Node keeps whatever code it was started with. After editing anything in
REM  server\, the running process still serves the OLD routes - so a brand new
REM  endpoint returns 404 while the file on disk plainly contains it.
REM
REM  The control panel does this for you now ("Start everything" replaces a
REM  stale server automatically). This file exists for when the panel is not
REM  open and you just want the dashboard working.
REM ===========================================================================
title Witness - restarting sync server
cd /d "%~dp0.."

echo.
echo   Stopping anything on port 8787...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":8787 .*LISTENING" 2^>nul') do (
  taskkill /PID %%p /T /F >nul 2>&1
)

timeout /t 1 >nul
echo   Starting the sync server...
echo.
start "Witness sync server" cmd /c "node server\index.mjs & pause"

timeout /t 3 >nul
echo   Checking it answers...
node "tools\checkserver.mjs"
echo.
timeout /t 10 >nul
