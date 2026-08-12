@echo off
title Witness diagnostic
cd /d "%~dp0.."
echo Collecting diagnostics...
echo.
node "tools\diagnose.mjs"
echo.
echo Done. You can close this window.
timeout /t 8 >nul
