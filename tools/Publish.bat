@echo off
REM Push to both repositories. Double-click, or run from a terminal.
REM
REM   origin -> sreeharisankar26/witness      full history
REM   kaya   -> sreeharisankar26/kaya_espada  one commit, the submission
REM
REM Git will ask for your GitHub credentials the first time. Nobody and nothing
REM else in this project ever needs them.

setlocal
cd /d "%~dp0.."

where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Git is not on PATH. Install it from https://git-scm.com and run this again.
  echo.
  pause
  exit /b 1
)

node tools\publish.mjs %*
set RC=%ERRORLEVEL%

echo.
if not "%RC%"=="0" (
  echo   Nothing was pushed. Read the message above.
)
pause
exit /b %RC%
